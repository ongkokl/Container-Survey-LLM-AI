import { CedexRepository } from "../infrastructure/d1/cedexRepository";

const MODEL="@cf/qwen/qwen3.8-27b";
type AiRunner={run(model:string,input:unknown):Promise<unknown>};
type Bucket={get(key:string):Promise<{arrayBuffer():Promise<ArrayBuffer>}|null>};

function dataUri(bytes:ArrayBuffer,type:string){
  let binary="";const data=new Uint8Array(bytes);
  for(let i=0;i<data.length;i+=0x8000)binary+=String.fromCharCode(...data.subarray(i,i+0x8000));
  return `data:${type||"image/jpeg"};base64,${btoa(binary)}`;
}
function parseJson(raw:unknown):Record<string,unknown>{
  if(!raw||typeof raw!=="object")return {};
  const o=raw as Record<string,unknown>;
  const choices=Array.isArray(o.choices)?o.choices:[];
  const first=choices[0]&&typeof choices[0]==="object"?choices[0] as Record<string,unknown>:null;
  const message=first?.message&&typeof first.message==="object"?first.message as Record<string,unknown>:null;
  const candidates=[
    message?.content,
    o.response,
    o.result,
    o.output_text
  ];
  for(const candidate of candidates){
    if(typeof candidate!=="string")continue;
    const text=candidate.trim().replace(/^\`\`\`(?:json)?\s*/i,"").replace(/\s*\`\`\`$/,"");
    const m=text.match(/\{[\s\S]*\}/);
    if(m)try{return JSON.parse(m[0]);}catch{}
  }
  return o;
}
function confidence(v:unknown):number|null{
  const n=Number(v);if(!Number.isFinite(n))return null;return Math.max(0,Math.min(1,n>1?n/100:n));
}

export class CedexClassificationService{
  constructor(private readonly repo:CedexRepository,private readonly bucket:Bucket,private readonly ai:AiRunner){}

  async analyseComponent(findingId:string){
    const context=await this.repo.findingContext(findingId);
    if(!context)throw new Error("Finding not found.");
    const equipment=await this.repo.equipmentForFinding(findingId);
    const allowed=await this.repo.components(equipment);
    if(!allowed.length)throw new Error("No verified CEDEX component master is loaded for this equipment type.");
    const photo=await this.repo.findingPhoto(findingId,"DAMAGE_CLOSEUP");
    if(!photo)throw new Error("Save the damage close-up photo before AI classification.");
    const object=await this.bucket.get(photo.r2_key);if(!object)throw new Error("Damage close-up photo is unavailable.");
    const image=dataUri(await object.arrayBuffer(),photo.content_type);
    const allowedText=allowed.map(x=>`${x.component_code} = ${x.component_name}`).join("\n");
    const prompt=`You are assisting a shipping-container surveyor. Equipment type: ${equipment}. Container face: ${context.container_face}.
Classify ONLY the physical component containing the marked/visible damage. Choose ONLY from the allowed component codes below. Never invent a code.
If the image is insufficient, return selected_code null and needs_review true.
Allowed codes:
${allowedText}
Return JSON only:
{"selected_code":"ABC or null","confidence":0.0,"needs_review":true,"reason":"short visual reason","candidates":[{"code":"ABC","confidence":0.0,"reason":"short reason"}]}
Return at most 3 candidates, all from the allowed list.`;
    const raw=await this.ai.run(MODEL,{messages:[{role:"user",content:[{type:"text",text:prompt},{type:"image_url",image_url:{url:image}}]}],max_tokens:500,temperature:0});
    const parsed=parseJson(raw),allowedSet=new Set(allowed.map(x=>x.component_code));
    const selected=typeof parsed.selected_code==="string"&&allowedSet.has(parsed.selected_code.toUpperCase())?parsed.selected_code.toUpperCase():null;
    const rawCandidates=Array.isArray(parsed.candidates)?parsed.candidates:[];
    const candidates=rawCandidates.map((v:any)=>({code:String(v?.code??"").toUpperCase(),confidence:confidence(v?.confidence),reason:String(v?.reason??"")})).filter(x=>allowedSet.has(x.code)).slice(0,3);
    if(selected&&!candidates.some(x=>x.code===selected))candidates.unshift({code:selected,confidence:confidence(parsed.confidence),reason:String(parsed.reason??"")});
    const result={equipment,selectedCode:selected,confidence:confidence(parsed.confidence),needsReview:Boolean(parsed.needs_review)||!selected,reason:String(parsed.reason??""),candidates:candidates.slice(0,3),allowedComponents:allowed,allowedCount:allowed.length,model:MODEL};
    await this.repo.saveComponentPrediction({findingId,surveyId:context.survey_id,modelName:MODEL,selectedCode:selected,confidence:result.confidence,candidates:result.candidates,response:raw});
    return result;
  }
}
