import { CedexRepository, ComponentVisualRule, DamageVisualRule } from "../infrastructure/d1/cedexRepository";

const MODEL="@cf/qwen/qwen3.8-27b";
const MAX_COMPLETION_TOKENS=2200;
const COMPONENT_REVIEW_THRESHOLD=0.8;
const DAMAGE_REVIEW_THRESHOLD=0.8;
const CONSERVATIVE_PHOTO_DAMAGE_CODES=new Set(["BN","CK","CO","CU","DT","DY","GD","ML","PF"]);

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
function parseJson(raw:unknown){
  const envelope=record(raw);
  const first=Array.isArray(envelope?.choices)?record(envelope.choices[0]):null;
  const message=record(first?.message);
  const values=first?[message?.content]:[raw,envelope?.response,envelope?.result,envelope?.output_text];
  for(const value of values){
    if(typeof value!=="string")continue;
    const text=value.trim().replace(/^\`\`\`(?:json)?\s*/i,"").replace(/\s*\`\`\`$/,"");
    try{const parsed=record(JSON.parse(text));if(parsed)return parsed;}catch{}
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
  const edges:Array<[OverviewZone,number]>=[["TOP_EDGE",y],["BOTTOM_EDGE",1-y],["LEFT_EDGE",x],["RIGHT_EDGE",1-x]];
  edges.sort((a,b)=>a[1]-b[1]);
  return edges[0][1]<=0.2?edges[0][0]:"CENTRAL_FIELD";
}
function componentGuidance(rules:ComponentVisualRule[]){
  return rules.map(rule=>{
    const p=[`${rule.component_code}: ${rule.visual_definition}`];
    if(rule.positive_cues)p.push(`Cues=${rule.positive_cues}`);
    if(rule.negative_cues)p.push(`Avoid=${rule.negative_cues}`);
    return p.join(" | ");
  }).join("\n")||"Use visible physical structure; abstain when uncertain.";
}
function damageGuidance(rules:DamageVisualRule[]){
  return rules.map(rule=>{
    const p=[`${rule.damage_code}: ${rule.visual_definition}`];
    if(rule.positive_cues)p.push(`Cues=${rule.positive_cues}`);
    if(rule.negative_cues)p.push(`Avoid=${rule.negative_cues}`);
    if(rule.force_review===1)p.push("Review=required");
    return p.join(" | ");
  }).join("\n");
}
function candidates(value:unknown,allowed:Set<string>):Candidate[]{
  if(!Array.isArray(value))return [];
  const out:Candidate[]=[];
  for(const item of value){
    const c=record(item);
    if(!c||typeof c.code!=="string"||!validConfidence(c.confidence)||typeof c.reason!=="string")continue;
    const code=c.code.trim().toUpperCase();
    if(allowed.has(code)&&!out.some(x=>x.code===code))out.push({code,confidence:c.confidence as number|null,reason:c.reason.trim()});
  }
  return out.slice(0,3);
}

export class OverviewCombinedClassificationService{
  constructor(private readonly repo:CedexRepository,private readonly ai:AiRunner){}

  async analyse(input:{
    findingId:string;
    file:File;
    damageBox?:unknown;
    locationCode?:string|null;
    imageScope?:"CROP"|"FULL_OVERVIEW";
    completionTokenLimit?:number;
  }){
    const startedAt=Date.now();
    const context=await this.repo.findingContext(input.findingId);
    if(!context)throw new Error("Finding not found.");
    if(context.equipment_type!=="GP")throw new Error("Zero-touch combined POC currently supports GP containers.");
    if(!["LEFT","RIGHT","FRONT"].includes(context.container_face))throw new Error("Zero-touch combined POC currently supports GP side/front views.");
    const damageBox=normalizedBox(input.damageBox);
    if(!damageBox)throw new Error("A valid AI-detected damage box is required.");

    const allowedComponents=await this.repo.components("GP",context.container_face);
    const componentCodes=[...new Set(allowedComponents.map(x=>x.component_code))];
    const componentSet=new Set(componentCodes);
    const zone=zoneForBox(damageBox);
    const componentRules=(await this.repo.componentVisualRules("GP",context.container_face,zone)).filter(x=>componentSet.has(x.component_code));

    const damageEntries=await Promise.all(componentCodes.map(async componentCode=>{
      const allowed=await this.repo.damageCodesForComponent(input.findingId,componentCode);
      const allCodes=[...new Set(allowed.damages.map(x=>x.damage_code))];
      const allSet=new Set(allCodes);
      const rules=(await this.repo.damageVisualRules("GP",componentCode)).filter(x=>allSet.has(x.damage_code));
      const eligibleRules=rules.filter(rule=>rule.evidence_requirement==="VISUAL"||(rule.damage_code==="IR"&&rule.evidence_requirement==="HISTORY_CONTEXT"));
      const eligibleSet=new Set(eligibleRules.map(x=>x.damage_code));
      const eligible=eligibleRules.length
        ?allowed.damages.filter(x=>eligibleSet.has(x.damage_code))
        :allowed.damages.filter(x=>CONSERVATIVE_PHOTO_DAMAGE_CODES.has(x.damage_code));
      return {componentCode,allowed:allowed.damages,rules,eligible,eligibleRules};
    }));
    const byComponent=new Map(damageEntries.map(x=>[x.componentCode,x]));
    const unionDamageCodes=[...new Set(damageEntries.flatMap(x=>x.eligible.map(d=>d.damage_code)))];
    const location=(input.locationCode??"").trim().toUpperCase()||null;
    const imageScope=input.imageScope??"CROP";
    const requestedTokenLimit=Number(input.completionTokenLimit);
    const completionTokenLimit=Number.isFinite(requestedTokenLimit)
      ?Math.max(600,Math.min(MAX_COMPLETION_TOKENS,Math.trunc(requestedTokenLimit)))
      :MAX_COMPLETION_TOKENS;
    const componentText=allowedComponents.map(x=>`${x.component_code} = ${x.component_name}`).join("\n");
    const damageMap=damageEntries
      .filter(x=>x.eligible.length)
      .map(x=>`${x.componentCode}: ${x.eligible.map(d=>`${d.damage_code}=${d.damage_name}`).join(", ")}`)
      .join("\n");
    const relevantDamageRules=damageEntries.flatMap(x=>x.eligibleRules).slice(0,80);

    const prompt=`ZERO-TOUCH POC FAST PATH: classify BOTH the CEDEX component and its visible damage in ONE reasoning pass.
Container: GP. Face: ${context.container_face}. Overview zone: ${zone}.
${location?`Calculated CEDEX location: ${location}. Use only as geometry context.`:"CEDEX location unavailable."}
${imageScope==="FULL_OVERVIEW"
  ?`The supplied image is the FULL overview. The already-localized primary damage region is x=${damageBox.x.toFixed(4)}, y=${damageBox.y.toFixed(4)}, width=${damageBox.width.toFixed(4)}, height=${damageBox.height.toFixed(4)} in normalized image coordinates. Use that localized region as the target; ignore other defects elsewhere in the overview.`
  :"The image is already cropped around the automatically localized primary damage. Identify the physical component underneath the central defect first."}
Identify the physical component at the localized target first, then classify the damage ONLY from codes valid for that selected component.

Component rules:
${componentGuidance(componentRules)}

Face-valid components:
${componentText}

Component -> photo-eligible damage codes:
${damageMap}

Damage visual guidance:
${damageGuidance(relevantDamageRules)}

Morphology priority for panel damage: true crack/cut outranks dent; permanent displacement/buckle/bend/crease is DT when no crack/cut; surface scrape/gouge/paint damage must not outrank clear structural deformation.
If component or damage cannot be supported visually, return null for that field rather than guessing.
The damage code MUST belong to the selected component's mapping above.

Return only JSON with component_code, component_confidence, component_needs_review, component_reason, component_candidates (max 3), damage_code, damage_confidence, damage_needs_review, damage_reason, damage_candidates (max 3). Candidate items contain code, confidence, reason.`;

    const aiStartedAt=Date.now();
    const raw=await this.ai.run(MODEL,{
      messages:[{role:"user",content:[
        {type:"text",text:prompt},
        {type:"image_url",image_url:{url:dataUri(await input.file.arrayBuffer(),input.file.type||"image/jpeg")}}
      ]}],
      max_completion_tokens:completionTokenLimit,
      reasoning_effort:"low",
      temperature:0,
      response_format:{type:"json_schema",json_schema:{name:"overview_combined_classification",strict:true,schema:{
        type:"object",properties:{
          component_code:{type:["string","null"],enum:[...componentCodes,null]},
          component_confidence:{type:["number","null"],minimum:0,maximum:1},
          component_needs_review:{type:"boolean"},component_reason:{type:"string"},
          component_candidates:{type:"array",maxItems:3,items:{type:"object",properties:{
            code:{type:"string",enum:componentCodes},confidence:{type:["number","null"],minimum:0,maximum:1},reason:{type:"string"}
          },required:["code","confidence","reason"],additionalProperties:false}},
          damage_code:{type:["string","null"],enum:[...unionDamageCodes,null]},
          damage_confidence:{type:["number","null"],minimum:0,maximum:1},
          damage_needs_review:{type:"boolean"},damage_reason:{type:"string"},
          damage_candidates:{type:"array",maxItems:3,items:{type:"object",properties:{
            code:{type:"string",enum:unionDamageCodes},confidence:{type:["number","null"],minimum:0,maximum:1},reason:{type:"string"}
          },required:["code","confidence","reason"],additionalProperties:false}}
        },required:["component_code","component_confidence","component_needs_review","component_reason","component_candidates","damage_code","damage_confidence","damage_needs_review","damage_reason","damage_candidates"],additionalProperties:false
      }}}
    });
    const aiDurationMs=Date.now()-aiStartedAt;
    const envelope=record(raw),choice=Array.isArray(envelope?.choices)?record(envelope.choices[0]):null;
    const finishReason=typeof choice?.finish_reason==="string"?choice.finish_reason:null;
    const parsed=parseJson(raw);

    let analysisStatus:AnalysisStatus="INVALID_RESPONSE";
    let componentCode:string|null=null,damageCode:string|null=null;
    let componentConfidence:number|null=null,damageConfidence:number|null=null;
    let componentNeedsReview=true,damageNeedsReview=true;
    let componentReason="AI returned an unreadable combined answer.",damageReason="AI returned an unreadable combined answer.";
    let componentCandidates:Candidate[]=[],damageCandidates:Candidate[]=[];

    if(finishReason==="length"){
      analysisStatus="INCOMPLETE";
      componentReason=damageReason="AI combined response incomplete. Retry the zero-touch analysis.";
    }else if((!finishReason||finishReason==="stop")&&parsed){
      const cc=typeof parsed.component_code==="string"?parsed.component_code.trim().toUpperCase():null;
      const dc=typeof parsed.damage_code==="string"?parsed.damage_code.trim().toUpperCase():null;
      if((cc===null||componentSet.has(cc))&&validConfidence(parsed.component_confidence)&&validConfidence(parsed.damage_confidence)&&
        typeof parsed.component_needs_review==="boolean"&&typeof parsed.damage_needs_review==="boolean"&&
        typeof parsed.component_reason==="string"&&typeof parsed.damage_reason==="string"){
        componentCode=cc;componentConfidence=parsed.component_confidence as number|null;
        componentReason=parsed.component_reason.trim()||"Surveyor review required.";
        componentCandidates=candidates(parsed.component_candidates,componentSet);
        const componentRule=componentCode?componentRules.find(x=>x.component_code===componentCode):null;
        componentNeedsReview=Boolean(parsed.component_needs_review||!componentCode||componentConfidence===null||componentConfidence<COMPONENT_REVIEW_THRESHOLD||componentRule?.force_review===1);

        const damageEntry=componentCode?byComponent.get(componentCode):null;
        const validDamageSet=new Set(damageEntry?.eligible.map(x=>x.damage_code)??[]);
        if(dc&&validDamageSet.has(dc)){
          damageCode=dc;damageConfidence=parsed.damage_confidence as number|null;
          damageReason=parsed.damage_reason.trim()||"Surveyor review required.";
          damageCandidates=candidates(parsed.damage_candidates,validDamageSet);
          const damageRule=damageEntry?.rules.find(x=>x.damage_code===damageCode);
          damageNeedsReview=Boolean(parsed.damage_needs_review||damageConfidence===null||damageConfidence<DAMAGE_REVIEW_THRESHOLD||damageRule?.force_review===1);
          analysisStatus="SUGGESTED";
        }else{
          damageCode=null;damageConfidence=null;damageNeedsReview=true;
          damageReason=componentCode
            ?"AI damage answer was not valid for the selected component; surveyor review required."
            :"Damage classification requires a reliable component.";
          analysisStatus=componentCode?"ABSTAINED":"ABSTAINED";
        }
      }
    }

    const componentName=componentCode?allowedComponents.find(x=>x.component_code===componentCode)?.component_name??null:null;
    const damageEntry=componentCode?byComponent.get(componentCode):null;
    const damageName=damageCode?damageEntry?.allowed.find(x=>x.damage_code===damageCode)?.damage_name??null:null;
    const totalDurationMs=Date.now()-startedAt;
    return {
      pocMode:"ZERO_TOUCH_OVERVIEW",
      source:"AI_DETECTED_OVERVIEW_CROP",
      classificationMode:"SINGLE_QWEN_COMPONENT_DAMAGE",
      imageScope,
      damageBox,locationCode:location,
      componentCode,componentName,componentConfidence,componentNeedsReview,componentReason,componentCandidates,
      selectedCode:damageCode,selectedName:damageName,confidence:damageConfidence,damageNeedsReview,damageReason,candidates:damageCandidates,
      needsReview:Boolean(componentNeedsReview||damageNeedsReview||!location),
      analysisStatus,model:MODEL,finishReason,completionTokenLimit,
      timings:{classificationAiMs:aiDurationMs,totalClassificationMs:totalDurationMs}
    };
  }
}
