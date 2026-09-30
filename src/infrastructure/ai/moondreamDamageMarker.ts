const MODEL="@cf/moondream/moondream3.1-9B-A2B";
const QWEN_MODEL="@cf/qwen/qwen3.8-27b";

type AiRunner={run(model:string,input:unknown):Promise<unknown>};

function dataUri(bytes:ArrayBuffer,contentType:string):string{
  let binary="";const data=new Uint8Array(bytes);
  for(let i=0;i<data.length;i+=0x8000) binary+=String.fromCharCode(...data.subarray(i,i+0x8000));
  return `data:${contentType};base64,${btoa(binary)}`;
}
function finite(v:unknown):number|null{
  const n=typeof v==="number"?v:Number(v);return Number.isFinite(n)?n:null;
}
function normalize(v:number):number{
  if(v>1&&v<=100) return v/100;
  if(v>100&&v<=1000) return v/1000;
  return Math.max(0,Math.min(1,v));
}
function arrayAt(raw:unknown,key:string):Record<string,unknown>[]{
  if(!raw||typeof raw!=="object")return[];
  const o=raw as Record<string,unknown>;
  const direct=o[key];
  if(Array.isArray(direct))return direct.filter(x=>x&&typeof x==="object") as Record<string,unknown>[];
  const result=o.result;
  if(result&&typeof result==="object"){
    const nested=(result as Record<string,unknown>)[key];
    if(Array.isArray(nested))return nested.filter(x=>x&&typeof x==="object") as Record<string,unknown>[];
  }
  return[];
}

function objectBox(o:Record<string,unknown>):{x:number;y:number;width:number;height:number}|null{
  let x1=finite(o.x_min??o.xmin??o.x1),y1=finite(o.y_min??o.ymin??o.y1);
  let x2=finite(o.x_max??o.xmax??o.x2),y2=finite(o.y_max??o.ymax??o.y2);
  if(x1===null||y1===null||x2===null||y2===null){
    const x=finite(o.x),y=finite(o.y),w=finite(o.width??o.w),h=finite(o.height??o.h);
    if(x===null||y===null||w===null||h===null)return null;
    x1=x;y1=y;x2=x+w;y2=y+h;
  }
  x1=normalize(x1);y1=normalize(y1);x2=normalize(x2);y2=normalize(y2);
  return {
    x:Math.min(x1,x2),
    y:Math.min(y1,y2),
    width:Math.abs(x2-x1),
    height:Math.abs(y2-y1)
  };
}

function largestBox(raw:unknown):{x:number;y:number;width:number;height:number}|null{
  const boxes=arrayAt(raw,"objects").map(objectBox).filter((x):x is {x:number;y:number;width:number;height:number}=>Boolean(x));
  if(!boxes.length)return null;
  return boxes.sort((a,b)=>b.width*b.height-a.width*a.height)[0];
}

function record(value:unknown):Record<string,unknown>|null{
  return value!==null&&typeof value==="object"&&!Array.isArray(value)
    ?value as Record<string,unknown>
    :null;
}

function parseQwenJson(raw:unknown):Record<string,unknown>|null{
  const envelope=record(raw);
  const first=Array.isArray(envelope?.choices)?record(envelope.choices[0]):null;
  const message=record(first?.message);
  const values=first?[message?.content]:[raw,envelope?.response,envelope?.result,envelope?.output_text];
  for(const value of values){
    const object=record(value);
    if(object&&Object.hasOwn(object,"found"))return object;
    if(typeof value!=="string")continue;
    const text=value.trim().replace(/^```(?:json)?\s*/i,"").replace(/\s*```$/,"");
    try{
      const parsed=record(JSON.parse(text));
      if(parsed)return parsed;
    }catch{}
  }
  return null;
}

export class MoondreamDamageMarker {
  constructor(private readonly ai:AiRunner){}

  private async imageData(file:File):Promise<string>{
    return dataUri(await file.arrayBuffer(),file.type||"image/jpeg");
  }

  async point(file:File){
    const image=await this.imageData(file);
    const raw=await this.ai.run(MODEL,{task:"point",image,target:"visible physical damage on the shipping container",max_objects:3});
    const points=arrayAt(raw,"points");
    if(!points.length)return {found:false,model:MODEL,geometry:null,raw};
    const p=points[0],x=finite(p.x),y=finite(p.y);
    if(x===null||y===null)return {found:false,model:MODEL,geometry:null,raw};
    return {found:true,model:MODEL,geometry:{x:normalize(x),y:normalize(y)},raw};
  }

  async pointOverview(file:File,face:string){
    const image=await this.imageData(file);
    const faceName=String(face||"container").toLowerCase();
    const target=
      "single most visually abnormal physical damage or repair area on the shipping container "+
      faceName+" face, including dent, deformation, buckle, crease, bent profile, crack, cut, puncture, tear, repair patch or distorted rail/panel; "+
      "ignore logos, lettering, paint variation, dirt, stains, shadows, timestamps, reflections and normal corrugations";
    const raw=await this.ai.run(MODEL,{task:"point",image,target,max_objects:3});
    const points=arrayAt(raw,"points");
    if(!points.length)return {found:false,model:MODEL,geometry:null,raw,target};
    const p=points[0],x=finite(p.x),y=finite(p.y);
    if(x===null||y===null)return {found:false,model:MODEL,geometry:null,raw,target};
    return {found:true,model:MODEL,geometry:{x:normalize(x),y:normalize(y)},raw,target};
  }

  async detect(file:File){
    const image=await this.imageData(file);
    const raw=await this.ai.run(MODEL,{task:"detect",image,target:"visible damaged area on the shipping container component",max_objects:3});
    const geometry=largestBox(raw);
    return geometry
      ? {found:true,model:MODEL,geometry,raw}
      : {found:false,model:MODEL,geometry:null,raw};
  }

  async reasonedPointOverview(file:File,face:string){
    const image=await this.imageData(file);
    const faceName=String(face||"container").toLowerCase();
    const prompt=`ZERO-TOUCH DAMAGE LOCALIZATION FALLBACK.
This is a fixed-camera overview of the shipping container ${faceName} face.
Moondream object detection and pinpoint both failed, so inspect the full image carefully.

Find the SINGLE most obvious physical damage or previous repair area on the container itself.
Look for dent, deformation, buckle, crease, bent profile, crack, cut, puncture, tear, repair patch, distorted rail or distorted panel.
Ignore normal corrugations, perspective, logos, lettering, paint shade variation, reflections, shadows, dirt, timestamps and background objects.

Return the CENTER of the damage as normalized image coordinates x and y from 0 to 1.
If no physical defect is visually supportable, return found=false rather than guessing.
Confidence is confidence that the returned point is on a real physical defect, not confidence in the CEDEX code.
Return only JSON.`;

    const raw=await this.ai.run(QWEN_MODEL,{
      messages:[{role:"user",content:[
        {type:"text",text:prompt},
        {type:"image_url",image_url:{url:image}}
      ]}],
      max_completion_tokens:900,
      reasoning_effort:"low",
      temperature:0,
      response_format:{
        type:"json_schema",
        json_schema:{
          name:"overview_damage_point_fallback",
          strict:true,
          schema:{
            type:"object",
            properties:{
              found:{type:"boolean"},
              x:{type:["number","null"],minimum:0,maximum:1},
              y:{type:["number","null"],minimum:0,maximum:1},
              confidence:{type:["number","null"],minimum:0,maximum:1},
              reason:{type:"string"}
            },
            required:["found","x","y","confidence","reason"],
            additionalProperties:false
          }
        }
      }
    });

    const parsed=parseQwenJson(raw);
    const x=finite(parsed?.x),y=finite(parsed?.y),confidence=finite(parsed?.confidence);
    const supported=Boolean(
      parsed?.found===true&&
      x!==null&&y!==null&&x>=0&&x<=1&&y>=0&&y<=1&&
      confidence!==null&&confidence>=0.45
    );
    const geometry:{x:number;y:number}|null=
      supported&&x!==null&&y!==null?{x,y}:null;
    return {
      found:supported,
      model:QWEN_MODEL,
      geometry,
      confidence:confidence!==null?Math.max(0,Math.min(1,confidence)):null,
      reason:typeof parsed?.reason==="string"?parsed.reason.trim():"",
      raw
    };
  }

  async locateOverview(
    file:File,
    face:string,
    knownReferenceBox?:{x:number;y:number;width:number;height:number}|null,
    options?:{skipDoorDetection?:boolean;skipReferenceDetection?:boolean}
  ){
    const image=await this.imageData(file);
    const faceName=String(face||"container").toLowerCase();
    const damageTarget=
      "dent, buckle, deformation, crease, puncture, tear, crack or other visible structural damage on the shipping container "+
      faceName+" face; ignore logos, paint, dirt, stains, shadows, timestamps and normal corrugations";
    const doorTarget=
      "shipping container cargo door end as one complete door-end plane, identified by paired doors, locking rods, hinges and rear frame; "+
      "do not select an isolated hinge, locking bar, side panel or another background container";

    if(options?.skipReferenceDetection&&!knownReferenceBox){
      const damageRaw=await this.ai.run(MODEL,{task:"detect",image,target:damageTarget,max_objects:3});
      const damageBox=largestBox(damageRaw);
      return {
        found:Boolean(damageBox),
        model:MODEL,
        damageBox,
        referenceBox:null,
        doorBox:null,
        raw:{damage:damageRaw,reference:null,door:null}
      };
    }

    if(knownReferenceBox){
      const damageRaw=await this.ai.run(MODEL,{task:"detect",image,target:damageTarget,max_objects:3});
      const doorRaw=options?.skipDoorDetection
        ? null
        : await this.ai.run(MODEL,{task:"detect",image,target:doorTarget,max_objects:2});
      const damageBox=largestBox(damageRaw),doorBox=doorRaw?largestBox(doorRaw):null;
      return {
        found:Boolean(damageBox),
        model:MODEL,
        damageBox,
        referenceBox:knownReferenceBox,
        doorBox,
        raw:{damage:damageRaw,reference:null,door:doorRaw}
      };
    }

    const faceKey=String(face||"").toUpperCase();
    const referenceTarget=faceKey==="DOOR"
      ?"entire visible shipping container cargo door-end plane including the complete outer frame; exclude side panels and background containers"
      :faceKey==="FRONT"
        ?"entire visible shipping container front-end plane including the complete outer frame; exclude side panels and background containers"
        :faceKey==="ROOF"
          ?"entire visible shipping container roof/top plane including the top side rails and both end rails; exclude side walls and background containers"
          :faceKey==="FLOOR"
            ?"entire visible shipping container floor/bottom plane including the bottom side rails and both end rails; exclude side walls and background containers"
            :"entire visible "+faceName+" side face of the shipping container including its outer structural frame; exclude the door-end plane, front-end plane and background containers";
    const [damageRaw,referenceRaw]=await Promise.all([
      this.ai.run(MODEL,{task:"detect",image,target:damageTarget,max_objects:3}),
      this.ai.run(MODEL,{task:"detect",image,target:referenceTarget,max_objects:3})
    ]);
    const doorRaw=options?.skipDoorDetection
      ? null
      : await this.ai.run(MODEL,{task:"detect",image,target:doorTarget,max_objects:2});
    const damageBox=largestBox(damageRaw);
    const referenceBox=largestBox(referenceRaw);
    const doorBox=doorRaw?largestBox(doorRaw):null;
    return {
      found:Boolean(damageBox),
      model:MODEL,
      damageBox,
      referenceBox,
      doorBox,
      raw:{damage:damageRaw,reference:referenceRaw,door:doorRaw}
    };
  }
}
