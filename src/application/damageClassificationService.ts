import { CedexRepository, DamageVisualRule } from "../infrastructure/d1/cedexRepository";

const MODEL="@cf/qwen/qwen3.8-27b";
const MAX_COMPLETION_TOKENS=600;
const DAMAGE_REVIEW_THRESHOLD=0.8;
type AiRunner={run(model:string,input:unknown):Promise<unknown>};
type Bucket={get(key:string):Promise<{arrayBuffer():Promise<ArrayBuffer>}|null>};
type AnalysisStatus="SUGGESTED"|"ABSTAINED"|"INCOMPLETE"|"INVALID_RESPONSE";
type Candidate={code:string;confidence:number|null;reason:string};

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
function confidence(value:number|null):number|null{
  return value===null?null:value;
}
function formatDamageVisualGuidance(rules:DamageVisualRule[]){
  if(!rules.length){
    return "No additional D1 damage visual guidance is loaded. Use only the verified allowed-code names and visible evidence.";
  }
  const lines=rules.map(rule=>{
    const parts=[`- ${rule.damage_code}: ${rule.visual_definition}`];
    if(rule.positive_cues)parts.push(`Positive cues: ${rule.positive_cues}`);
    if(rule.negative_cues)parts.push(`Do not use when: ${rule.negative_cues}`);
    if(rule.confusable_with)parts.push(`Common alternatives: ${rule.confusable_with}`);
    parts.push(`Evidence requirement: ${rule.evidence_requirement}`);
    if(rule.force_review===1)parts.push("If selected, surveyor review is mandatory.");
    return parts.join(" ");
  });
  return `D1 damage visual knowledge (operational QA guidance; the allowed code master remains authoritative):\n${lines.join("\n")}`;
}

function selectedDamageRule(rules:DamageVisualRule[],code:string|null){
  if(!code)return null;
  return rules.find(rule=>rule.damage_code===code)??null;
}


export class DamageClassificationService{
  constructor(private readonly repo:CedexRepository,private readonly bucket:Bucket,private readonly ai:AiRunner){}

  async analyse(findingId:string){
    const context=await this.repo.findingContext(findingId);
    if(!context)throw new Error("Finding not found.");

    const allowed=await this.repo.damageCodesForFinding(findingId);
    if(!allowed.damages.length)throw new Error("No verified IICL damage rules are loaded for the confirmed component.");

    const photo=await this.repo.findingPhoto(findingId,"DAMAGE_CLOSEUP");
    if(!photo)throw new Error("Damage close-up photo is required.");

    const object=await this.bucket.get(photo.r2_key);
    if(!object)throw new Error("Damage close-up photo is unavailable.");

    const roi=await this.repo.surveyorDamageBox(findingId,photo.id);
    const image=dataUri(await object.arrayBuffer(),photo.content_type);
    const allowedCodes=[...new Set(allowed.damages.map(x=>x.damage_code))];
    const allowedSet=new Set(allowedCodes);
    const allowedText=allowed.damages.map(x=>`${x.damage_code} = ${x.damage_name}`).join("\n");
    if(!["GP","RF"].includes(context.equipment_type))throw new Error("Unable to determine GP/RF equipment type.");
    const equipment=context.equipment_type as "GP"|"RF";
    const visualRules=(await this.repo.damageVisualRules(equipment,allowed.componentCode))
      .filter(rule=>allowedSet.has(rule.damage_code));
    const visualGuidance=formatDamageVisualGuidance(visualRules);

    const prompt=`You are assisting a shipping-container surveyor using the verified IICL damage-code list supplied by the application.
Confirmed component: ${allowed.componentCode}. Container face: ${context.container_face}.
${roi?`The surveyor marked the intended damage region on the close-up image using normalized coordinates from the top-left: x=${roi.x.toFixed(4)}, y=${roi.y.toFixed(4)}, width=${roi.width.toFixed(4)}, height=${roi.height.toFixed(4)}. Treat this region as the PRIMARY target. The coordinates are metadata only; no artificial box is drawn on the pixels.`:"No surveyor damage region is available; classify cautiously."}

Classify ONLY the visible physical damage affecting the confirmed component. Choose ONLY from the allowed codes below. Never invent a code.
Use the physical morphology in the marked region. Do not classify unrelated dirt, stains, corrosion, marks or defects outside the marked region.
Identify the PRIMARY damage represented by the marked region. Incidental paint chips, dirt, staining or discoloration caused by or adjacent to a clearer structural damage must not outrank the primary morphology.
Do not abstain merely because exact severity or repair measurement is unavailable: if the visible damage type itself is clear, return that damage code. Codes whose evidence requirement is MEASUREMENT or HISTORY_CONTEXT may be suggested only when visually plausible, but must set needs_review true because the photo alone cannot establish the required evidence. If the image truly does not distinguish the damage type, return selected_code null and needs_review true.

${visualGuidance}

Allowed damage codes for ${allowed.componentCode}:
${allowedText}

Return only the final JSON object with selected_code (an allowed code or JSON null), confidence (0 to 1 or null), needs_review (boolean), reason (one short visual sentence), and candidates (at most 3 objects with code, confidence and reason). Do not explain your reasoning outside the JSON.`;

    const raw=await this.ai.run(MODEL,{
      messages:[{role:"user",content:[{type:"text",text:prompt},{type:"image_url",image_url:{url:image}}]}],
      max_completion_tokens:MAX_COMPLETION_TOKENS,
      reasoning_effort:"low",
      temperature:0,
      response_format:{
        type:"json_schema",
        json_schema:{
          name:"damage_classification",
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
    let selectedConfidence:number|null=null;
    let needsReview=true;
    let reason="AI returned an unreadable damage answer. Retry analysis or select the damage manually.";
    let candidates:Candidate[]=[];

    if(finishReason==="length"){
      analysisStatus="INCOMPLETE";
      reason="AI response incomplete. Retry analysis or select the damage manually.";
    }else if((!finishReason||finishReason==="stop")&&!record(choice?.message)?.refusal&&parsed&&
      (parsed.selected_code===null||typeof parsed.selected_code==="string")&&
      validConfidence(parsed.confidence)&&typeof parsed.needs_review==="boolean"&&
      typeof parsed.reason==="string"&&Array.isArray(parsed.candidates)&&parsed.candidates.length<=3&&
      parsed.candidates.every(value=>{
        const candidate=record(value);
        return candidate&&typeof candidate.code==="string"&&validConfidence(candidate.confidence)&&typeof candidate.reason==="string";
      })){
      const code=typeof parsed.selected_code==="string"?parsed.selected_code.trim().toUpperCase():null;
      if(code===null||allowedSet.has(code)){
        selectedCode=code;
        selectedConfidence=confidence(parsed.confidence);
        const rule=selectedDamageRule(visualRules,code);
        needsReview=
          parsed.needs_review||
          !code||
          selectedConfidence===null||
          selectedConfidence<DAMAGE_REVIEW_THRESHOLD||
          rule?.force_review===1;
        analysisStatus=code?"SUGGESTED":"ABSTAINED";
        reason=parsed.reason.trim()||(code?"Surveyor confirmation required.":"AI could not distinguish the visible damage type reliably.");
        for(const value of parsed.candidates){
          const candidate=value as {code:string;confidence:number|null;reason:string};
          const candidateCode=candidate.code.trim().toUpperCase();
          if(allowedSet.has(candidateCode)&&!candidates.some(x=>x.code===candidateCode)){
            candidates.push({code:candidateCode,confidence:confidence(candidate.confidence),reason:candidate.reason.trim()});
          }
        }
        if(code&&!candidates.some(x=>x.code===code))candidates.unshift({code,confidence:selectedConfidence,reason});
        candidates=candidates.slice(0,3);
      }
    }

    const selectedRule=selectedDamageRule(visualRules,selectedCode);
    const result={
      componentCode:allowed.componentCode,
      analysisStatus,
      roiUsed:Boolean(roi),
      selectedCode,
      confidence:selectedConfidence,
      needsReview,
      reason,
      candidates,
      allowedDamages:allowed.damages,
      model:MODEL,
      damageVisualKnowledgeUsed:visualRules.length>0,
      damageVisualRuleCount:visualRules.length,
      evidenceRequirement:selectedRule?.evidence_requirement??null,
      evidenceReviewRequired:selectedRule?.force_review===1
    };

    await this.repo.saveDamagePrediction({
      findingId,
      surveyId:context.survey_id,
      modelName:MODEL,
      selectedCode,
      confidence:selectedConfidence,
      candidates,
      response:raw,
      status:analysisStatus==="INCOMPLETE"||analysisStatus==="INVALID_RESPONSE"?"FAILED":needsReview?"REVIEW_REQUIRED":"SUGGESTED",
      requestContext:{
        photoId:photo.id,
        roi,
        damageReviewThreshold:DAMAGE_REVIEW_THRESHOLD,
        damageVisualKnowledgeUsed:visualRules.length>0,
        damageVisualRuleCount:visualRules.length,
        damageVisualRuleCodes:[...new Set(visualRules.map(rule=>rule.damage_code))],
        selectedEvidenceRequirement:selectedRule?.evidence_requirement??null,
        evidenceReviewRequired:selectedRule?.force_review===1,
        max_completion_tokens:MAX_COMPLETION_TOKENS,
        reasoning_effort:"low",
        analysisStatus,
        finishReason
      }
    });

    return result;
  }
}
