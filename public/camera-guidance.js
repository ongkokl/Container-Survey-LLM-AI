const clamp=(value,min=0,max=1)=>Math.max(min,Math.min(max,value));
const qualityLabel=(score)=>score>=0.72?"GOOD":score>=0.48?"USABLE":"POOR";

function luminance(r,g,b){ return Math.round(0.2126*r+0.7152*g+0.0722*b); }

function geometryScore(gray,width,height,face){
  let horizontal=0,vertical=0,hCount=0,vCount=0;
  const sampleStep=2;
  for(let y=2;y<height-2;y+=sampleStep){
    const yRatio=y/height;
    for(let x=2;x<width-2;x+=sampleStep){
      const xRatio=x/width;
      const idx=y*width+x;
      const gx=Math.abs(gray[idx+1]-gray[idx-1]);
      const gy=Math.abs(gray[idx+width]-gray[idx-width]);
      if(face==="LEFT"||face==="RIGHT"){
        if((yRatio<0.32||yRatio>0.68)&&xRatio>0.05&&xRatio<0.95){horizontal+=gy;hCount++;}
        if(yRatio>0.16&&yRatio<0.84&&xRatio>0.08&&xRatio<0.92){vertical+=gx;vCount++;}
      }else if(face==="DOOR"||face==="FRONT"){
        if((xRatio<0.3||xRatio>0.7)&&yRatio>0.05&&yRatio<0.95){vertical+=gx;vCount++;}
        if((yRatio<0.3||yRatio>0.7)&&xRatio>0.08&&xRatio<0.92){horizontal+=gy;hCount++;}
      }else{
        if(yRatio>0.12&&yRatio<0.88&&xRatio>0.12&&xRatio<0.88){
          horizontal+=gy;vertical+=gx;hCount++;vCount++;
        }
      }
    }
  }
  const hAvg=hCount?horizontal/hCount:0;
  const vAvg=vCount?vertical/vCount:0;
  return clamp(((hAvg+vAvg)/2-5)/19);
}

function analyseImageData(imageData,face,mode,orientationGamma){
  const {data,width,height}=imageData;
  const gray=new Uint8Array(width*height);
  let sum=0,bright=0,dark=0;
  for(let i=0,p=0;i<data.length;i+=4,p++){
    const y=luminance(data[i],data[i+1],data[i+2]);
    gray[p]=y;sum+=y;
    if(y>245)bright++;
    if(y<12)dark++;
  }
  const pixels=gray.length||1;
  const mean=sum/pixels;
  const brightPct=bright/pixels;
  const darkPct=dark/pixels;

  let edge=0,edgeCount=0;
  for(let y=1;y<height-1;y+=2){
    for(let x=1;x<width-1;x+=2){
      const idx=y*width+x;
      edge+=Math.abs(gray[idx+1]-gray[idx-1])+Math.abs(gray[idx+width]-gray[idx-width]);
      edgeCount+=2;
    }
  }
  const edgeAverage=edge/(edgeCount||1);
  const sharpness=clamp((edgeAverage-4)/18);

  let exposure=1-Math.abs(mean-128)/128;
  exposure=clamp(exposure-(brightPct>0.08?(brightPct-0.08)*2.4:0)-(darkPct>0.28?(darkPct-0.28)*1.5:0));
  const glare=clamp(1-brightPct/0.16);
  const geometry=geometryScore(gray,width,height,face);
  const level=Number.isFinite(orientationGamma)?clamp(1-Math.max(0,Math.abs(orientationGamma)-3)/16):0.72;

  const identification=clamp(sharpness*0.45+exposure*0.35+glare*0.20);
  const measurement=mode==="overview"
    ? clamp(sharpness*0.22+exposure*0.20+glare*0.13+geometry*0.32+level*0.13)
    : clamp(sharpness*0.38+exposure*0.24+glare*0.16+geometry*0.12+level*0.10);

  return {
    meanLuminance:Number(mean.toFixed(1)),
    brightPixelRatio:Number(brightPct.toFixed(4)),
    darkPixelRatio:Number(darkPct.toFixed(4)),
    sharpnessScore:Number(sharpness.toFixed(3)),
    exposureScore:Number(exposure.toFixed(3)),
    glareScore:Number(glare.toFixed(3)),
    geometryScore:Number(geometry.toFixed(3)),
    levelScore:Number(level.toFixed(3)),
    identificationScore:Number(identification.toFixed(3)),
    measurementScore:Number(measurement.toFixed(3)),
    identificationQuality:qualityLabel(identification),
    measurementQuality:qualityLabel(measurement)
  };
}

function guidanceInstruction(metrics,face,mode){
  if(metrics.sharpnessScore<0.42)return "Hold steady — image is blurred";
  if(metrics.exposureScore<0.38)return metrics.meanLuminance<75?"More light needed":"Reduce bright reflection";
  if(metrics.glareScore<0.48)return "Change angle — glare detected";
  if(metrics.levelScore<0.46)return "Level the phone";
  if(mode==="overview"&&["LEFT","RIGHT","DOOR","FRONT"].includes(face)&&metrics.geometryScore<0.42){
    return face==="LEFT"||face==="RIGHT"
      ?"Move back until the top and bottom rails fit the guide"
      :"Move back until the corner posts and frame fit the guide";
  }
  if(mode==="closeup")return "Keep the complete damage inside the guide";
  if(face==="ROOF"||face==="FLOOR")return "Basic guide only — centre the damage and keep structural references visible";
  return "Good position — capture photo";
}

function guideStroke(quality){
  if(quality==="GOOD")return "#70e69b";
  if(quality==="USABLE")return "#ffd166";
  return "#ff7b7b";
}

function drawOverlay(canvas,face,equipmentType,mode,quality){
  const rect=canvas.getBoundingClientRect();
  const dpr=Math.min(window.devicePixelRatio||1,2);
  const width=Math.max(1,Math.round(rect.width*dpr));
  const height=Math.max(1,Math.round(rect.height*dpr));
  if(canvas.width!==width||canvas.height!==height){canvas.width=width;canvas.height=height;}
  const ctx=canvas.getContext("2d");
  ctx.clearRect(0,0,width,height);
  ctx.save();
  ctx.scale(dpr,dpr);
  const w=rect.width,h=rect.height;
  const stroke=guideStroke(quality);
  ctx.strokeStyle=stroke;
  ctx.fillStyle=stroke;
  ctx.lineWidth=3;
  ctx.setLineDash([10,7]);
  ctx.shadowColor="rgba(0,0,0,.7)";
  ctx.shadowBlur=3;

  if(mode==="closeup"){
    const x=w*0.18,y=h*0.20,bw=w*0.64,bh=h*0.56;
    ctx.strokeRect(x,y,bw,bh);
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.moveTo(w*.44,h*.48);ctx.lineTo(w*.56,h*.48);
    ctx.moveTo(w*.50,h*.42);ctx.lineTo(w*.50,h*.54);
    ctx.stroke();
  }else if(face==="LEFT"||face==="RIGHT"){
    const x=w*.06,y=h*.14,bw=w*.88,bh=h*.70;
    ctx.strokeRect(x,y,bw,bh);
    ctx.setLineDash([]);
    ctx.beginPath();ctx.moveTo(x,y+h*.08);ctx.lineTo(x+bw,y+h*.08);ctx.stroke();
    ctx.beginPath();ctx.moveTo(x,y+bh-h*.08);ctx.lineTo(x+bw,y+bh-h*.08);ctx.stroke();
    if(equipmentType==="GP"){
      ctx.lineWidth=1.5;ctx.globalAlpha=.75;
      for(let i=1;i<10;i++){const px=x+(bw*i/10);ctx.beginPath();ctx.moveTo(px,y+h*.10);ctx.lineTo(px,y+bh-h*.10);ctx.stroke();}
      ctx.globalAlpha=1;
    }
    ctx.lineWidth=3;
    ctx.beginPath();ctx.moveTo(w*.46,h*.49);ctx.lineTo(w*.54,h*.49);ctx.moveTo(w*.50,h*.45);ctx.lineTo(w*.50,h*.53);ctx.stroke();
  }else if(face==="DOOR"||face==="FRONT"){
    const x=w*.14,y=h*.08,bw=w*.72,bh=h*.84;
    ctx.strokeRect(x,y,bw,bh);
    ctx.setLineDash([]);
    ctx.lineWidth=2;
    ctx.beginPath();ctx.moveTo(x+bw*.5,y);ctx.lineTo(x+bw*.5,y+bh);ctx.stroke();
    if(face==="DOOR"){
      ctx.beginPath();ctx.moveTo(x+bw*.30,y+h*.06);ctx.lineTo(x+bw*.30,y+bh-h*.06);ctx.moveTo(x+bw*.70,y+h*.06);ctx.lineTo(x+bw*.70,y+bh-h*.06);ctx.stroke();
    }
    ctx.lineWidth=3;
    ctx.beginPath();ctx.moveTo(w*.46,h*.50);ctx.lineTo(w*.54,h*.50);ctx.moveTo(w*.50,h*.46);ctx.lineTo(w*.50,h*.54);ctx.stroke();
  }else{
    const x=w*.12,y=h*.14,bw=w*.76,bh=h*.68;
    ctx.strokeRect(x,y,bw,bh);
    ctx.setLineDash([]);
    ctx.beginPath();ctx.moveTo(w*.45,h*.50);ctx.lineTo(w*.55,h*.50);ctx.moveTo(w*.50,h*.45);ctx.lineTo(w*.50,h*.55);ctx.stroke();
  }

  ctx.font="700 12px system-ui,sans-serif";
  ctx.textAlign="left";
  ctx.shadowBlur=4;
  const label=(equipmentType||"")+" "+(face||"").replace("_"," ");
  if(label.trim())ctx.fillText(label.trim(),12,22);
  ctx.restore();
}

function blobFromCanvas(canvas,type="image/jpeg",quality=.92){
  return new Promise((resolve,reject)=>canvas.toBlob((blob)=>blob?resolve(blob):reject(new Error("Unable to capture image.")),type,quality));
}

export function createGuidedCamera(elements){
  const {
    modal,viewport,video,overlay,statusText,qualityBadge,
    captureButton,cancelButton,fallbackButton
  }=elements;
  if(!modal||!viewport||!video||!overlay||!statusText||!qualityBadge||!captureButton||!cancelButton||!fallbackButton){
    throw new Error("Guided camera UI is incomplete.");
  }

  const analysisCanvas=document.createElement("canvas");
  analysisCanvas.width=320;analysisCanvas.height=180;
  const analysisContext=analysisCanvas.getContext("2d",{willReadFrequently:true});
  const captureCanvas=document.createElement("canvas");
  const captureContext=captureCanvas.getContext("2d");
  let stream=null,timer=null,current=null,lastMetrics=null,orientationGamma=null,running=false,openToken=0;

  window.addEventListener("deviceorientation",(event)=>{
    if(typeof event.gamma==="number")orientationGamma=event.gamma;
  },{passive:true});

  function setModalOpen(open){
    modal.hidden=!open;
    modal.setAttribute("aria-hidden",open?"false":"true");
    document.body.classList.toggle("guided-camera-open",open);
  }

  function stop(){
    openToken++;
    running=false;
    if(timer){clearTimeout(timer);timer=null;}
    if(stream){for(const track of stream.getTracks())track.stop();}
    stream=null;
    current=null;
    video.srcObject=null;
    captureButton.disabled=true;
    setModalOpen(false);
  }

  function schedule(){
    if(!running)return;
    timer=setTimeout(analyseFrame,180);
  }

  function analyseFrame(){
    if(!running||!current||video.readyState<2){schedule();return;}
    try{
      const aw=analysisCanvas.width,ah=analysisCanvas.height;
      analysisContext.drawImage(video,0,0,aw,ah);
      const imageData=analysisContext.getImageData(0,0,aw,ah);
      lastMetrics=analyseImageData(imageData,current.face,current.mode,orientationGamma);
      const primaryQuality=current.mode==="overview"?lastMetrics.measurementQuality:lastMetrics.identificationQuality;
      qualityBadge.textContent=(current.mode==="overview"?"Measurement: ":"Photo: ")+primaryQuality.toLowerCase();
      qualityBadge.dataset.quality=primaryQuality;
      statusText.textContent=guidanceInstruction(lastMetrics,current.face,current.mode);
      drawOverlay(overlay,current.face,current.equipmentType,current.mode,primaryQuality);
    }catch{
      statusText.textContent="Keep the damage centred and structural references visible";
    }
    schedule();
  }

  async function capture(){
    if(!current||!video.videoWidth||!video.videoHeight)return;
    captureButton.disabled=true;
    try{
      captureCanvas.width=video.videoWidth;
      captureCanvas.height=video.videoHeight;
      captureContext.drawImage(video,0,0,captureCanvas.width,captureCanvas.height);
      const blob=await blobFromCanvas(captureCanvas);
      const file=new File([blob],current.mode+"-"+Date.now()+".jpg",{type:"image/jpeg",lastModified:Date.now()});
      const metrics=lastMetrics??{
        identificationQuality:"POOR",measurementQuality:"POOR",
        identificationScore:0,measurementScore:0,sharpnessScore:0,exposureScore:0,glareScore:0,geometryScore:0,levelScore:0
      };
      const metadata={
        version:"camera_guidance_v1",
        source:"guided_camera",
        photoType:current.mode,
        containerFace:current.face,
        equipmentType:current.equipmentType||null,
        capturedAt:new Date().toISOString(),
        frame:{width:video.videoWidth,height:video.videoHeight},
        identificationQuality:metrics.identificationQuality,
        measurementQuality:metrics.measurementQuality,
        scores:{
          sharpness:metrics.sharpnessScore,
          exposure:metrics.exposureScore,
          glare:metrics.glareScore,
          geometry:metrics.geometryScore,
          level:metrics.levelScore,
          identification:metrics.identificationScore,
          measurement:metrics.measurementScore
        }
      };
      const callback=current.onCapture;
      stop();
      await callback(file,metadata);
    }catch(error){
      statusText.textContent=error instanceof Error?error.message:"Unable to capture image.";
      captureButton.disabled=false;
    }
  }

  async function open(options){
    const token=++openToken;
    const request={
      mode:options.mode==="closeup"?"closeup":"overview",
      face:String(options.face||"").toUpperCase(),
      equipmentType:String(options.equipmentType||"").toUpperCase()||null,
      fallbackInput:options.fallbackInput||null,
      onCapture:options.onCapture
    };
    current=request;
    lastMetrics=null;
    qualityBadge.textContent="Checking photo…";
    qualityBadge.dataset.quality="POOR";
    statusText.textContent="Starting camera…";
    setModalOpen(true);
    drawOverlay(overlay,request.face,request.equipmentType,request.mode,"POOR");
    try{
      if(!navigator.mediaDevices?.getUserMedia)throw new Error("Live camera guidance is not supported on this browser.");
      const acquiredStream=await navigator.mediaDevices.getUserMedia({
        audio:false,
        video:{
          facingMode:{ideal:"environment"},
          width:{ideal:1920},
          height:{ideal:1080}
        }
      });
      if(token!==openToken||current!==request||modal.hidden){
        for(const track of acquiredStream.getTracks())track.stop();
        return;
      }
      stream=acquiredStream;
      video.srcObject=stream;
      await video.play();
      if(token!==openToken||current!==request||modal.hidden){
        for(const track of stream.getTracks())track.stop();
        stream=null;
        video.srcObject=null;
        return;
      }
      if(video.videoWidth&&video.videoHeight)viewport.style.aspectRatio=video.videoWidth+" / "+video.videoHeight;
      captureButton.disabled=false;
      running=true;
      analyseFrame();
    }catch(error){
      if(token!==openToken||current!==request)return;
      const fallbackInput=request.fallbackInput;
      stop();
      if(fallbackInput){
        fallbackInput.click();
        return;
      }
      throw error;
    }
  }

  captureButton.addEventListener("click",capture);
  cancelButton.addEventListener("click",stop);
  fallbackButton.addEventListener("click",()=>{
    const input=current?.fallbackInput;
    stop();
    if(input)input.click();
  });
  window.addEventListener("keydown",(event)=>{if(event.key==="Escape"&&!modal.hidden)stop();});
  window.addEventListener("resize",()=>{if(!modal.hidden&&current){const q=current.mode==="overview"?lastMetrics?.measurementQuality:lastMetrics?.identificationQuality;drawOverlay(overlay,current.face,current.equipmentType,current.mode,q||"POOR");}});

  return {open,close:stop};
}
