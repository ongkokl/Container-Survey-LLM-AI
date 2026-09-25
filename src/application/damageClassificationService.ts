import { CedexRepository } from "../infrastructure/d1/cedexRepository";

const MODEL="@cf/qwen/qwen3.8-27b";
type AiRunner={run(model:string,input:unknown):Promise<unknown>};
type Bucket={get(key:string):Promise<{arrayBuffer():Promise<ArrayBuffer>}|null>};

function dataUri(bytes:ArrayBuffer,type:string){let binary="";const data=new Uint8Array(bytes);for(let i=0;i<data.length;i+=0x8000)binary+=String.fromCharCode(...data.subarray(i,i+0x8000));return `data:${type||"image/jpeg"};base64,${btoa(binary)}`;}
function parseJson(raw:unknown):Record<string,unknown>{
  if(!raw||typeof raw!=="object")return {};const o=raw as Record<string,unknown>,choices=Array.isArray(o.choices)?o.choices:[],first=choices[0]&&typeof choices[0]==="object"?choices[0] as Record<string,unknown>:null,message=first?.message&&typeof first.message==="object"?first.message as Record<string,unknown>:null;
  for(const v of [message?.content,o.response,o.result,o.output_text]){if(typeof v!=="string")continue;const m=v.trim().replace(/^```(?:json)?\s*/i,"").replace(/\s*```$/,"").match(/\{[\s\S]*\}/);if(m)try{return JSON.parse(m[0]);}catch{}}
  return o;
}
function confidence(v:unknown){const n=Number(v);return Number.isFinite(n)?Math.max(0,Math.min(1,n>1?n/100:n)):null;}

export class DamageClassificationService{
  constructor(private readonly repo:CedexRepository,private readonly bucket:Bucket,private readonly ai:AiRunner){}
  async analyse(findingId:string){
    const context=await this.repo.findingContext(findingId);if(!context)throw new Error("Finding not found.");
    const allowed=await this.repo.damageCodesForFinding(findingId);
    if(!allowed.damages.length)throw new Error("No verified IICL damage rules are loaded for the confirmed component.");
    const photo=await this.repo.findingPhoto(findingId,"DAMAGE_CLOSEUP");if(!photo)throw new Error("Damage close-up photo is required.");
    const object=await this.bucket.get(photo.r2_key);if(!object)throw new Error("Damage close-up photo is unavailable.");
    const image=dataUri(await object.arrayBuffer(),photo.content_type),allowedText=allowed.damages.map(x=>`${x.damage_code} = ${x.damage_name}`).join("\n");
    const prompt=`You are assisting a shipping-container surveyor using the IICL ECS coding system.
Confirmed component: ${allowed.componentCode}. Container face: ${context.container_face}.
Classify ONLY the visible physical damage to the confirmed component. Choose ONLY from the allowed damage codes below. Never invent a code.
If the image is insufficient or the damage cannot be distinguished, return selected_code null and needs_review true.
Allowed damage codes for ${allowed.componentCode}:
${allowedText}
Return JSON only:
{"selected_code":"XX or null","confidence":0.0,"needs_review":true,"reason":"short visual reason","candidates":[{"code":"XX","confidence":0.0,"reason":"short reason"}]}
Do not explain your reasoning outside the JSON. Return at most 3 candidates, all from the allowed list.`;
    const raw=await this.ai.run(MODEL,{messages:[{role:"user",content:[{type:"text",text:prompt},{type:"image_url",image_url:{url:image}}]}],max_tokens:1000,temperature:0});
    const parsed=parseJson(raw),allowedSet=new Set(allowed.damages.map(x=>x.damage_code)),selected=typeof parsed.selected_code==="string"&&allowedSet.has(parsed.selected_code.toUpperCase())?parsed.selected_code.toUpperCase():null;
    const candidates=(Array.isArray(parsed.candidates)?parsed.candidates:[]).map((v:any)=>({code:String(v?.code??"").toUpperCase(),confidence:confidence(v?.confidence),reason:String(v?.reason??"")})).filter(x=>allowedSet.has(x.code)).slice(0,3);
    if(selected&&!candidates.some(x=>x.code===selected))candidates.unshift({code:selected,confidence:confidence(parsed.confidence),reason:String(parsed.reason??"")});
    const result={componentCode:allowed.componentCode,selectedCode:selected,confidence:confidence(parsed.confidence),needsReview:Boolean(parsed.needs_review)||!selected,reason:String(parsed.reason??""),candidates:candidates.slice(0,3),allowedDamages:allowed.damages,model:MODEL};
    await this.repo.saveDamagePrediction({findingId,surveyId:context.survey_id,modelName:MODEL,selectedCode:selected,confidence:result.confidence,candidates:result.candidates,response:raw});
    return result;
  }
}