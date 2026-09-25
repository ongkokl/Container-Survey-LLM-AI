const MODEL="@cf/moondream/moondream3.1-9B-A2B";

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

export class MoondreamDamageMarker {
  constructor(private readonly ai:AiRunner){}

  async point(file:File){
    const image=dataUri(await file.arrayBuffer(),file.type||"image/jpeg");
    const raw=await this.ai.run(MODEL,{task:"point",image,target:"visible physical damage on the shipping container",max_objects:3});
    const points=arrayAt(raw,"points");
    if(!points.length)return {found:false,model:MODEL,geometry:null,raw};
    const p=points[0],x=finite(p.x),y=finite(p.y);
    if(x===null||y===null)return {found:false,model:MODEL,geometry:null,raw};
    return {found:true,model:MODEL,geometry:{x:normalize(x),y:normalize(y)},raw};
  }

  async detect(file:File){
    const image=dataUri(await file.arrayBuffer(),file.type||"image/jpeg");
    const raw=await this.ai.run(MODEL,{task:"detect",image,target:"visible damaged area on the shipping container component",max_objects:3});
    const objects=arrayAt(raw,"objects");
    if(!objects.length)return {found:false,model:MODEL,geometry:null,raw};
    const o=objects[0];
    let x1=finite(o.x_min??o.xmin??o.x1),y1=finite(o.y_min??o.ymin??o.y1);
    let x2=finite(o.x_max??o.xmax??o.x2),y2=finite(o.y_max??o.ymax??o.y2);
    if(x1===null||y1===null||x2===null||y2===null){
      const x=finite(o.x),y=finite(o.y),w=finite(o.width??o.w),h=finite(o.height??o.h);
      if(x===null||y===null||w===null||h===null)return {found:false,model:MODEL,geometry:null,raw};
      x1=x;y1=y;x2=x+w;y2=y+h;
    }
    x1=normalize(x1);y1=normalize(y1);x2=normalize(x2);y2=normalize(y2);
    return {found:true,model:MODEL,geometry:{x:Math.min(x1,x2),y:Math.min(y1,y2),width:Math.abs(x2-x1),height:Math.abs(y2-y1)},raw};
  }
}
