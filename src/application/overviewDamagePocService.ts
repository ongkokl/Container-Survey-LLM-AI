import { CedexRepository, DamageVisualRule } from "../infrastructure/d1/cedexRepository";

const MODEL="@cf/qwen/qwen3.8-27b";
const MAX_COMPLETION_TOKENS=2000;
const DAMAGE_REVIEW_THRESHOLD=0.8;

type AiRunner={run(model:string,input:unknown):Promise<unknown>};
type Candidate={code:string;confidence:number|null;reason:string};
type DamageBox={x:number;y:number;width:number;height:number};
type AnalysisStatus="SUGGESTED"|"ABSTAINED"|"INCOMPLETE"|"INVALID_RESPONSE";

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

function photoEligibleRules(rules:DamageVisualRule[]){
  return rules.filter(rule=>
    rule.evidence_requirement==="VISUAL"||
    (rule.damage_code==="IR"&&rule.evidence_requirement==="HISTORY_CONTEXT")
  );
}

function selectedDamageRule(rules:DamageVisualRule[],code:string|null){
  if(!code)return null;
  return rules.find(rule=>rule.damage_code===code)??null;
}

function visualGuidance(rules:DamageVisualRule[]){
  return rules.map(rule=>{
    const parts=[`${rule.damage_code}: ${rule.visual_definition}`];
    if(rule.positive_cues)parts.push(`Cues=${rule.positive_cues}`);
    if(rule.negative_cues)parts.push(`Avoid=${rule.negative_cues}`);
    if(rule.force_review===1)parts.push("Review=required");
    return parts.join(" | ");
  }).join("\n");
}

export class OverviewDamagePocService{
  constructor(private readonly repo:CedexRepository,private readonly ai:AiRunner){}

  async analyse(input:{
    findingId:string;
    file:File;
    damageBox?:unknown;
    locationCode?:string|null;
  }){
    const context=await this.repo.findingContext(input.findingId);
    if(!context)throw new Error("Finding not found.");
    if(context.equipment_type!=="GP")throw new Error("Overview-only damage POC currently supports GP containers.");
    if(!["LEFT","RIGHT","FRONT"].includes(context.container_face)){
      throw new Error("Overview-only panel-damage POC currently supports GP side/front panel views.");
    }

    const damageBox=normalizedBox(input.damageBox);
    if(!damageBox)throw new Error("A valid AI-detected damage box is required.");
    const allowed=await this.repo.damageCodesForComponent(input.findingId,"PAA");
    if(!allowed.damages.length)throw new Error("No verified PAA damage rules are loaded.");

    const allCodes=[...new Set(allowed.damages.map(x=>x.damage_code))];
    const allSet=new Set(allCodes);
    const rules=(await this.repo.damageVisualRules("GP","PAA")).filter(rule=>allSet.has(rule.damage_code));
    const eligibleRules=photoEligibleRules(rules);
    const eligibleCodes=new Set(eligibleRules.map(rule=>rule.damage_code));
    const eligibleDamages=eligibleRules.length
      ?allowed.damages.filter(x=>eligibleCodes.has(x.damage_code))
      :allowed.damages;
    const aiCodes=[...new Set(eligibleDamages.map(x=>x.damage_code))];
    const aiSet=new Set(aiCodes);
    const allowedText=eligibleDamages.map(x=>`${x.damage_code} = ${x.damage_name}`).join("\n");
    const location=(input.locationCode??"").trim().toUpperCase()||null;

    const prompt=`POC TEST: classify one automatically detected visible damage on a GP container panel from an overview-photo crop.
For this experiment the component is intentionally assumed to be PAA (Panel Assembly). Do not reclassify the component.
The browser cropped the image around the AI-detected damage box, so the visible central defect is the PRIMARY target.
Detected overview box: x=${damageBox.x.toFixed(4)}, y=${damageBox.y.toFixed(4)}, width=${damageBox.width.toFixed(4)}, height=${damageBox.height.toFixed(4)}.
${location?`Calculated CEDEX location: ${location}. This is supporting position context only.`:"No calculated CEDEX location is available."}

Classify the PRIMARY visible physical damage only. Ignore unrelated marks, paint, rust, dirt or other defects outside the central detected damage.
For GP/PAA use this morphology priority:
1. CK for a true fracture/split/crack line. CU for a sharp cut, severed edge or cut penetration. A true material discontinuity outranks a dent.
2. DT for permanent panel displacement, depression, buckle, bend, crease or deformation when there is no crack/cut.
3. PF, CO, DY or GD only when that surface condition is the dominant damage and no stronger structural break/deformation is present.
4. IR may be suggested when the target visibly appears to be a previous repair (patch, weld, inserted piece or repair workmanship), but IR must set needs_review=true because a photo alone cannot prove IICL conformity.
If the crop is too weak to distinguish the damage type, return selected_code=null and needs_review=true rather than guessing.

Visual rules:
${visualGuidance(eligibleRules)}

Photo-eligible codes:
${allowedText}

Return only JSON with selected_code, confidence, needs_review, reason (max 20 words), and candidates (max 3; each code, confidence, reason max 15 words).`;

    const image=dataUri(await input.file.arrayBuffer(),input.file.type||"image/jpeg");
    const raw=await this.ai.run(MODEL,{
      messages:[{role:"user",content:[
        {type:"text",text:prompt},
        {type:"text",text:"AI-detected damage crop from the overview photo. Focus on the central detected defect."},
        {type:"image_url",image_url:{url:image}}
      ]}],
      max_completion_tokens:MAX_COMPLETION_TOKENS,
      reasoning_effort:"low",
      temperature:0,
      response_format:{
        type:"json_schema",
        json_schema:{
          name:"overview_damage_poc",
          strict:true,
          schema:{
            type:"object",
            properties:{
              selected_code:{type:["string","null"],enum:[...aiCodes,null]},
              confidence:{type:["number","null"],minimum:0,maximum:1},
              needs_review:{type:"boolean"},
              reason:{type:"string"},
              candidates:{
                type:"array",maxItems:3,
                items:{
                  type:"object",
                  properties:{
                    code:{type:"string",enum:aiCodes},
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
    let selectedConfidence:number|null=null;
    let needsReview=true;
    let reason="AI returned an unreadable overview-damage answer.";
    let candidates:Candidate[]=[];

    if(finishReason==="length"){
      analysisStatus="INCOMPLETE";
      reason="AI response incomplete. Retry the overview-damage POC.";
    }else if((!finishReason||finishReason==="stop")&&parsed&&
      (parsed.selected_code===null||typeof parsed.selected_code==="string")&&
      validConfidence(parsed.confidence)&&typeof parsed.needs_review==="boolean"&&
      typeof parsed.reason==="string"&&Array.isArray(parsed.candidates)&&parsed.candidates.length<=3){
      const code=typeof parsed.selected_code==="string"?parsed.selected_code.trim().toUpperCase():null;
      if(code===null||aiSet.has(code)){
        selectedCode=code;
        selectedConfidence=parsed.confidence as number|null;
        const rule=selectedDamageRule(rules,code);
        needsReview=Boolean(
          parsed.needs_review||
          !code||
          selectedConfidence===null||
          selectedConfidence<DAMAGE_REVIEW_THRESHOLD||
          rule?.force_review===1
        );
        analysisStatus=code?"SUGGESTED":"ABSTAINED";
        reason=parsed.reason.trim()||"Surveyor review required.";
        for(const value of parsed.candidates){
          const c=record(value);
          if(!c||typeof c.code!=="string"||!validConfidence(c.confidence)||typeof c.reason!=="string")continue;
          const candidateCode=c.code.trim().toUpperCase();
          if(aiSet.has(candidateCode)&&!candidates.some(x=>x.code===candidateCode)){
            candidates.push({code:candidateCode,confidence:c.confidence as number|null,reason:c.reason.trim()});
          }
        }
        if(code&&!candidates.some(x=>x.code===code)){
          candidates.unshift({code,confidence:selectedConfidence,reason});
        }
        candidates=candidates.slice(0,3);
      }
    }

    const selectedRule=selectedDamageRule(rules,selectedCode);
    return {
      pocMode:"OVERVIEW_SINGLE_PAA_DAMAGE",
      source:"AI_DETECTED_OVERVIEW_CROP",
      componentCode:"PAA",
      componentAssumed:true,
      damageBox,
      locationCode:location,
      analysisStatus,
      selectedCode,
      confidence:selectedConfidence,
      needsReview,
      reason,
      candidates,
      allowedDamages:allowed.damages,
      aiEligibleDamageCodes:aiCodes,
      excludedFromPhotoOnlyAi:allCodes.filter(code=>!aiSet.has(code)),
      evidenceRequirement:selectedRule?.evidence_requirement??null,
      evidenceReviewRequired:selectedRule?.force_review===1,
      model:MODEL,
      finishReason,
      completionTokenLimit:MAX_COMPLETION_TOKENS
    };
  }
}
