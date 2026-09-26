import { CedexRepository } from "../infrastructure/d1/cedexRepository";

const MODEL="@cf/qwen/qwen3.8-27b";
const MAX_COMPLETION_TOKENS=900;
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
    const text=value.trim().replace(/^```(?:json)?\s*/i,"").replace(/\s*```$/,"");
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

export class RepairRecommendationService{
  constructor(private readonly repo:CedexRepository,private readonly bucket:Bucket,private readonly ai:AiRunner){}

  async analyse(findingId:string){
    const context=await this.repo.findingContext(findingId);
    if(!context)throw new Error("Finding not found.");

    const allowed=await this.repo.repairCodesForFinding(findingId);
    if(!allowed.repairs.length)throw new Error("No verified repair methods are loaded for the confirmed component.");

    const photo=await this.repo.findingPhoto(findingId,"DAMAGE_CLOSEUP");
    if(!photo)throw new Error("Damage close-up photo is required.");

    const object=await this.bucket.get(photo.r2_key);
    if(!object)throw new Error("Damage close-up photo is unavailable.");

    const roi=await this.repo.surveyorDamageBox(findingId,photo.id);
    const image=dataUri(await object.arrayBuffer(),photo.content_type);
    const allowedCodes=[...new Set(allowed.repairs.map(x=>x.repair_code))];
    const allowedSet=new Set(allowedCodes);
    const allowedText=allowed.repairs.map(x=>`${x.repair_code} = ${x.repair_name}`).join("\n");

    const prompt=`You are assisting a shipping-container surveyor with an ADVISORY repair-method recommendation.
Equipment: ${allowed.equipment}. Container face: ${context.container_face}.
Confirmed component: ${allowed.componentCode}.
Confirmed damage: ${allowed.damageCode}.
${roi?`The surveyor marked the target region on the close-up image using normalized coordinates from the top-left: x=${roi.x.toFixed(4)}, y=${roi.y.toFixed(4)}, width=${roi.width.toFixed(4)}, height=${roi.height.toFixed(4)}. Treat this region as the PRIMARY target. The coordinates are metadata only; no artificial box is drawn on the pixels.`:"No surveyor damage region is available; recommend cautiously."}

Recommend only the repair METHOD FAMILY that is most plausible from the confirmed component, confirmed damage and visible evidence.
Choose ONLY from the allowed repair codes below. Never invent a repair code.
Do NOT estimate repair dimensions, man-hours, material cost, acceptance limits or structural suitability from the photo.
If choosing between straightening, welding, patching, section/replacement-style work or painting requires measurements or inspection evidence not visible here, return selected_code null rather than pretending certainty.
This is advisory only. A qualified surveyor must confirm the final repair method.

Allowed repair methods for ${allowed.componentCode}:
${allowedText}

Return only the final JSON object with selected_code (an allowed code or JSON null), confidence (0 to 1 or null), reason (maximum 20 words), and candidates (at most 3 objects with code, confidence and a maximum 15-word reason). Keep the answer concise.`;

    const raw=await this.ai.run(MODEL,{
      messages:[{role:"user",content:[{type:"text",text:prompt},{type:"image_url",image_url:{url:image}}]}],
      max_completion_tokens:MAX_COMPLETION_TOKENS,
      reasoning_effort:"low",
      temperature:0,
      response_format:{
        type:"json_schema",
        json_schema:{
          name:"repair_recommendation",
          strict:true,
          schema:{
            type:"object",
            properties:{
              selected_code:{type:["string","null"],enum:[...allowedCodes,null]},
              confidence:{type:["number","null"],minimum:0,maximum:1},
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
            required:["selected_code","confidence","reason","candidates"],
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
    let reason="AI returned an unreadable repair recommendation. Select the repair method manually or retry.";
    let candidates:Candidate[]=[];

    if(finishReason==="length"){
      analysisStatus="INCOMPLETE";
      reason="AI repair response incomplete. Retry analysis or select the repair method manually.";
    }else if((!finishReason||finishReason==="stop")&&!record(choice?.message)?.refusal&&parsed&&
      (parsed.selected_code===null||typeof parsed.selected_code==="string")&&
      validConfidence(parsed.confidence)&&typeof parsed.reason==="string"&&
      Array.isArray(parsed.candidates)&&parsed.candidates.length<=3&&
      parsed.candidates.every(value=>{
        const candidate=record(value);
        return candidate&&typeof candidate.code==="string"&&validConfidence(candidate.confidence)&&typeof candidate.reason==="string";
      })){
      const code=typeof parsed.selected_code==="string"?parsed.selected_code.trim().toUpperCase():null;
      if(code===null||allowedSet.has(code)){
        selectedCode=code;
        selectedConfidence=parsed.confidence as number|null;
        analysisStatus=code?"SUGGESTED":"ABSTAINED";
        reason=parsed.reason.trim()||(code?"Surveyor confirmation required.":"Image evidence is insufficient to recommend a repair method reliably.");
        for(const value of parsed.candidates){
          const candidate=value as {code:string;confidence:number|null;reason:string};
          const candidateCode=candidate.code.trim().toUpperCase();
          if(allowedSet.has(candidateCode)&&!candidates.some(x=>x.code===candidateCode)){
            candidates.push({code:candidateCode,confidence:candidate.confidence,reason:candidate.reason.trim()});
          }
        }
        if(code&&!candidates.some(x=>x.code===code))candidates.unshift({code,confidence:selectedConfidence,reason});
        candidates=candidates.slice(0,3);
      }
    }

    // Repair is advisory in this POC. Never auto-accept from model confidence.
    const needsReview=true;
    const result={
      equipment:allowed.equipment,
      componentCode:allowed.componentCode,
      damageCode:allowed.damageCode,
      analysisStatus,
      roiUsed:Boolean(roi),
      selectedCode,
      confidence:selectedConfidence,
      needsReview,
      reviewPolicy:"SURVEYOR_CONFIRMATION_REQUIRED",
      reason,
      candidates,
      allowedRepairs:allowed.repairs,
      model:MODEL,
      finishReason,
      completionTokenLimit:MAX_COMPLETION_TOKENS
    };

    await this.repo.saveRepairPrediction({
      findingId,
      surveyId:context.survey_id,
      modelName:MODEL,
      selectedCode,
      confidence:selectedConfidence,
      candidates,
      response:raw,
      status:analysisStatus==="INCOMPLETE"||analysisStatus==="INVALID_RESPONSE"?"FAILED":"REVIEW_REQUIRED",
      requestContext:{
        photoId:photo.id,
        roi,
        equipment:allowed.equipment,
        componentCode:allowed.componentCode,
        damageCode:allowed.damageCode,
        allowedRepairCodes:allowedCodes,
        reviewPolicy:"SURVEYOR_CONFIRMATION_REQUIRED",
        max_completion_tokens:MAX_COMPLETION_TOKENS,
        reasoning_effort:"low",
        analysisStatus,
        finishReason
      }
    });

    return result;
  }
}
