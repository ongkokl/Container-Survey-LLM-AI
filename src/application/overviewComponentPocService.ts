import { CedexRepository, ComponentVisualRule } from "../infrastructure/d1/cedexRepository";

const MODEL="@cf/qwen/qwen3.8-27b";
const MAX_COMPLETION_TOKENS=1800;
const COMPONENT_REVIEW_THRESHOLD=0.8;

type AiRunner={run(model:string,input:unknown):Promise<unknown>};
type DamageBox={x:number;y:number;width:number;height:number};
type Candidate={code:string;confidence:number|null;reason:string};
type AnalysisStatus="SUGGESTED"|"ABSTAINED"|"INCOMPLETE"|"INVALID_RESPONSE";
type OverviewZone="TOP_EDGE"|"BOTTOM_EDGE"|"LEFT_EDGE"|"RIGHT_EDGE"|"CENTRAL_FIELD";

function dataUri(bytes:ArrayBuffer,type:string){
  let binary="";const data=new Uint8Array(bytes);
  for(let i=0;i<data.length;i+=0x8000)binary+=String.fromCharCode(...data.subarray(i,i+0x8000));
  return `data:${type||"image/jpeg"};base64,${btoa(binary)}`;
}

function record(value:unknown):Record<string,unknown>|null{
  return value!==null&&typeof value==="object"&&!Array.isArray(value)?value as Record<string,unknown>:null;
}

function parseJson(raw:unknown):Record<string,unknown>|null{
  const envelope=record(raw);
  const first=Array.isArray(envelope?.choices)?record(envelope.choices[0]):null;
  const message=record(first?.message);
  const values=first?[message?.content]:[raw,envelope?.response,envelope?.result,envelope?.output_text];
  for(const value of values){
    const object=record(value);
    if(object&&Object.hasOwn(object,"selected_code"))return object;
    if(typeof value!=="string")continue;
    const text=value.trim().replace(/^\`\`\`(?:json)?\s*/i,"").replace(/\s*\`\`\`$/,"");
    try{
      const parsed=record(JSON.parse(text));
      if(parsed)return parsed;
    }catch{}
  }
  return null;
}

function validConfidence(value:unknown):value is number|null{
  return value===null||(typeof value==="number"&&Number.isFinite(value)&&value>=0&&value<=1);
}

function normalizedBox(value:unknown):DamageBox|null{
  if(!value||typeof value!=="object"||Array.isArray(value))return null;
  const v=value as Record<string,unknown>;
  const box={x:Number(v.x),y:Number(v.y),width:Number(v.width),height:Number(v.height)};
  if(![box.x,box.y,box.width,box.height].every(Number.isFinite))return null;
  if(box.x<0||box.y<0||box.width<=0||box.height<=0||box.x+box.width>1.000001||box.y+box.height>1.000001)return null;
  return box;
}

function zoneForBox(box:DamageBox):OverviewZone{
  const x=box.x+box.width/2,y=box.y+box.height/2;
  const edges:Array<[OverviewZone,number]>=[
    ["TOP_EDGE",y],["BOTTOM_EDGE",1-y],["LEFT_EDGE",x],["RIGHT_EDGE",1-x]
  ];
  edges.sort((a,b)=>a[1]-b[1]);
  return edges[0][1]<=0.2?edges[0][0]:"CENTRAL_FIELD";
}

function visualGuidance(rules:ComponentVisualRule[]){
  if(!rules.length)return "No D1 visual rule is available; use visible physical structure and set review when uncertain.";
  return rules.map(rule=>{
    const parts=[`${rule.component_code}: ${rule.visual_definition}`];
    if(rule.positive_cues)parts.push(`Cues=${rule.positive_cues}`);
    if(rule.negative_cues)parts.push(`Avoid=${rule.negative_cues}`);
    if(rule.confusable_with)parts.push(`Alternatives=${rule.confusable_with}`);
    if(rule.force_review===1)parts.push("Review=required");
    return parts.join(" | ");
  }).join("\n");
}

export class OverviewComponentPocService{
  constructor(private readonly repo:CedexRepository,private readonly ai:AiRunner){}

  async analyse(input:{findingId:string;file:File;damageBox?:unknown;locationCode?:string|null;}){
    const context=await this.repo.findingContext(input.findingId);
    if(!context)throw new Error("Finding not found.");
    if(context.equipment_type!=="GP")throw new Error("Zero-touch component POC currently supports GP containers.");
    if(!["LEFT","RIGHT","FRONT"].includes(context.container_face)){
      throw new Error("Zero-touch component POC currently supports GP side/front views.");
    }
    const damageBox=normalizedBox(input.damageBox);
    if(!damageBox)throw new Error("A valid AI-detected damage box is required.");

    const allowed=await this.repo.components("GP",context.container_face);
    if(!allowed.length)throw new Error("No verified CEDEX components are loaded for this face.");
    const allowedCodes=[...new Set(allowed.map(x=>x.component_code))];
    const allowedSet=new Set(allowedCodes);
    const zone=zoneForBox(damageBox);
    const rules=(await this.repo.componentVisualRules("GP",context.container_face,zone))
      .filter(rule=>allowedSet.has(rule.component_code));
    const candidatesText=allowed.map(x=>`${x.component_code} = ${x.component_name}`).join("\n");
    const location=(input.locationCode??"").trim().toUpperCase()||null;

    const prompt=`ZERO-TOUCH POC: identify the GP dry-container CEDEX COMPONENT underneath one automatically detected damage region.
Container face: ${context.container_face}. Overview zone: ${zone}.
${location?`Calculated CEDEX location: ${location}. Use only as supporting geometry context.`:"CEDEX location is not available."}
The supplied image is a crop around the AI-detected damage box. The central damaged structure is the target. No surveyor crosshair or pinpoint exists.

Identify the UNDERLYING PHYSICAL COMPONENT, not the damage type, paint, rust, patch, label or shadow.
Important visual distinctions:
- broad corrugated wall/panel field normally indicates PAA.
- corner casting/block indicates CFG.
- vertical corner-post structure indicates CPO/CPA-family candidates according to visible member.
- forklift-entry opening or dedicated pocket member indicates FLA/FLT/FLP/FLS, not a general rail.
- longitudinal/top/bottom structural rail must use the matching rail candidate when visibly targeted.
- fitted hardware such as a ventilator must use its exact fitted-component code when clearly visible.
Do not use the damage shape itself to decide the component. If the crop cannot distinguish the component, return null and request review.

D1 visual guidance:
${visualGuidance(rules)}

Face-valid component codes:
${candidatesText}

Return only JSON with selected_code, confidence, needs_review, reason (max 20 words), and candidates (max 3; each code, confidence, reason max 15 words).`;

    const raw=await this.ai.run(MODEL,{
      messages:[{role:"user",content:[
        {type:"text",text:prompt},
        {type:"image_url",image_url:{url:dataUri(await input.file.arrayBuffer(),input.file.type||"image/jpeg")}}
      ]}],
      max_completion_tokens:MAX_COMPLETION_TOKENS,
      reasoning_effort:"low",
      temperature:0,
      response_format:{
        type:"json_schema",
        json_schema:{
          name:"overview_component_poc",
          strict:true,
          schema:{
            type:"object",
            properties:{
              selected_code:{type:["string","null"],enum:[...allowedCodes,null]},
              confidence:{type:["number","null"],minimum:0,maximum:1},
              needs_review:{type:"boolean"},
              reason:{type:"string"},
              candidates:{
                type:"array",maxItems:3,
                items:{
                  type:"object",
                  properties:{
                    code:{type:"string",enum:allowedCodes},
                    confidence:{type:["number","null"],minimum:0,maximum:1},
                    reason:{type:"string"}
                  },
                  required:["code","confidence","reason"],
                  additionalProperties:false
                }
              }
            },
            required:["selected_code","confidence","needs_review","reason","candidates"],
            additionalProperties:false
          }
        }
      }
    });

    const envelope=record(raw);
    const choice=Array.isArray(envelope?.choices)?record(envelope.choices[0]):null;
    const finishReason=typeof choice?.finish_reason==="string"?choice.finish_reason:null;
    const parsed=parseJson(raw);

    let analysisStatus:AnalysisStatus="INVALID_RESPONSE";
    let selectedCode:string|null=null;
    let confidence:number|null=null;
    let needsReview=true;
    let reason="AI returned an unreadable component answer.";
    let resultCandidates:Candidate[]=[];

    if(finishReason==="length"){
      analysisStatus="INCOMPLETE";
      reason="AI component response incomplete. Retry the zero-touch analysis.";
    }else if((!finishReason||finishReason==="stop")&&parsed&&
      (parsed.selected_code===null||typeof parsed.selected_code==="string")&&
      validConfidence(parsed.confidence)&&typeof parsed.needs_review==="boolean"&&
      typeof parsed.reason==="string"&&Array.isArray(parsed.candidates)&&parsed.candidates.length<=3){
      const code=typeof parsed.selected_code==="string"?parsed.selected_code.trim().toUpperCase():null;
      if(code===null||allowedSet.has(code)){
        selectedCode=code;
        confidence=parsed.confidence as number|null;
        const forceReview=Boolean(code&&rules.some(rule=>rule.component_code===code&&rule.force_review===1));
        needsReview=Boolean(parsed.needs_review||!code||confidence===null||confidence<COMPONENT_REVIEW_THRESHOLD||forceReview);
        reason=parsed.reason.trim()||"Surveyor review required.";
        analysisStatus=code?"SUGGESTED":"ABSTAINED";
        for(const value of parsed.candidates){
          const c=record(value);
          if(!c||typeof c.code!=="string"||!validConfidence(c.confidence)||typeof c.reason!=="string")continue;
          const candidateCode=c.code.trim().toUpperCase();
          if(allowedSet.has(candidateCode)&&!resultCandidates.some(x=>x.code===candidateCode)){
            resultCandidates.push({code:candidateCode,confidence:c.confidence as number|null,reason:c.reason.trim()});
          }
        }
        if(code&&!resultCandidates.some(x=>x.code===code)){
          resultCandidates.unshift({code,confidence,reason});
        }
        resultCandidates=resultCandidates.slice(0,3);
      }
    }

    const selectedName=selectedCode
      ?allowed.find(x=>x.component_code===selectedCode)?.component_name??null
      :null;
    return {
      source:"AI_DETECTED_OVERVIEW_CROP",
      analysisStatus,
      selectedCode,
      selectedName,
      confidence,
      needsReview,
      reason,
      candidates:resultCandidates,
      damageBox,
      locationCode:location,
      overviewZone:zone,
      allowedComponentCount:allowedCodes.length,
      visualRuleCount:rules.length,
      model:MODEL,
      finishReason,
      completionTokenLimit:MAX_COMPLETION_TOKENS
    };
  }
}
