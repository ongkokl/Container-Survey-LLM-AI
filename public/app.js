const input = document.querySelector("#doorPhoto");
const galleryInput = document.querySelector("#doorGalleryPhoto");
const previewWrap = document.querySelector("#previewWrap");
const preview = document.querySelector("#preview");
const retake = document.querySelector("#retake");
const analyseBtn = document.querySelector("#analyseBtn");
const message = document.querySelector("#message");

const captureCard = document.querySelector("#captureCard");
const reviewCard = document.querySelector("#reviewCard");
const containerNoInput = document.querySelector("#containerNo");
const isoSizeTypeInput = document.querySelector("#isoSizeType");
const containerValidation = document.querySelector("#containerValidation");
const isoValidation = document.querySelector("#isoValidation");
const derivedCard = document.querySelector("#derivedCard");
const containerType = document.querySelector("#containerType");
const containerLength = document.querySelector("#containerLength");
const containerHeight = document.querySelector("#containerHeight");
const containerConfidence = document.querySelector("#containerConfidence");
const isoConfidence = document.querySelector("#isoConfidence");
const confirmBtn = document.querySelector("#confirmBtn");
const backBtn = document.querySelector("#backBtn");
const reviewMessage = document.querySelector("#reviewMessage");

const startedCard = document.querySelector("#startedCard");
const startedTitle = document.querySelector("#startedTitle");
const startedText = document.querySelector("#startedText");
const startedContainer = document.querySelector("#startedContainer");
const startedCycle = document.querySelector("#startedCycle");
const startedSurvey = document.querySelector("#startedSurvey");

let selectedFile = null;
let objectUrl = null;
let attemptId = null;
let originalDetected = {
  containerNo: "",
  isoSizeType: ""
};

function setBusy(button, busy, busyText, normalText) {
  button.disabled = busy;
  button.textContent = busy ? busyText : normalText;
}

function confidenceLabel(value) {
  if (typeof value !== "number") return "—";
  return Math.round(value * 100) + "%";
}

function normalizeContainerText(value) {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 11);
}

function normalizeIsoText(value) {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 4);
}

function clearPreview() {
  selectedFile = null;
  attemptId = null;
  originalDetected = { containerNo: "", isoSizeType: "" };

  if (objectUrl) URL.revokeObjectURL(objectUrl);
  objectUrl = null;

  preview.removeAttribute("src");
  previewWrap.hidden = true;
  analyseBtn.disabled = true;
  input.value = "";
  galleryInput.value = "";
  message.textContent = "";

  reviewCard.hidden = true;
  startedCard.hidden = true;
  captureCard.hidden = false;
}

async function compressForOcr(file) {
  const maxDimension = 2048;

  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(
      1,
      maxDimension / Math.max(bitmap.width, bitmap.height)
    );

    if (scale === 1 && file.size <= 7 * 1024 * 1024) {
      bitmap.close();
      return file;
    }

    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;

    const context = canvas.getContext("2d");
    context.drawImage(bitmap, 0, 0, width, height);
    bitmap.close();

    const blob = await new Promise((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", 0.88)
    );

    if (!blob) return file;

    return new File([blob], "door-ocr.jpg", {
      type: "image/jpeg",
      lastModified: Date.now()
    });
  } catch {
    return file;
  }
}

async function apiJson(url, options) {
  const response = await fetch(url, options);
  let payload;

  try {
    payload = await response.json();
  } catch {
    throw new Error("Server returned an unreadable response.");
  }

  if (!response.ok || !payload.ok) {
    throw new Error(payload.message || "Request failed.");
  }

  return payload.result;
}

function populateReview(result) {
  attemptId = result.attemptId;

  const detectedContainer = result.detected?.containerNo ?? "";
  const detectedIso = result.detected?.isoSizeType ?? "";
  originalDetected = {
    containerNo: detectedContainer,
    isoSizeType: detectedIso
  };

  containerNoInput.value = detectedContainer;
  isoSizeTypeInput.value = detectedIso;

  if (result.validation?.containerCheckDigitValid) {
    containerValidation.textContent = "✓ ISO 6346 check digit valid";
    containerValidation.dataset.state = "ok";
  } else if (result.validation?.containerFormatValid) {
    const expected = result.validation?.expectedCheckDigit;
    containerValidation.textContent =
      expected === null || expected === undefined
        ? "Check digit could not be validated"
        : "Check digit mismatch · expected " + expected;
    containerValidation.dataset.state = "warn";
  } else {
    containerValidation.textContent = "Review container number";
    containerValidation.dataset.state = "warn";
  }

  if (result.validation?.isoCodeFound) {
    isoValidation.textContent = "✓ ISO size/type recognised";
    isoValidation.dataset.state = "ok";
  } else {
    isoValidation.textContent = "Review ISO size/type code";
    isoValidation.dataset.state = "warn";
  }

  containerConfidence.textContent =
    "Container OCR " + confidenceLabel(result.detected?.containerConfidence);
  isoConfidence.textContent =
    "ISO OCR " + confidenceLabel(result.detected?.isoSizeTypeConfidence);

  if (result.derived) {
    derivedCard.hidden = false;
    containerType.textContent = result.derived.containerType;
    containerLength.textContent = result.derived.lengthFt + " ft";
    containerHeight.textContent = result.derived.height;
  } else {
    derivedCard.hidden = true;
  }

  reviewMessage.textContent =
    result.status === "NEEDS_REVIEW"
      ? "AI result needs surveyor review before the survey can start."
      : "Identity validated. Confirm to create or resume the gate-in cycle.";

  reviewCard.hidden = false;
  reviewCard.scrollIntoView({ behavior: "smooth", block: "start" });
}

function markEdited() {
  const currentContainer = normalizeContainerText(containerNoInput.value);
  const currentIso = normalizeIsoText(isoSizeTypeInput.value);

  containerNoInput.value = currentContainer;
  isoSizeTypeInput.value = currentIso;

  if (currentContainer !== originalDetected.containerNo) {
    containerValidation.textContent = "Edited by surveyor · validates on confirm";
    containerValidation.dataset.state = "neutral";
  }

  if (currentIso !== originalDetected.isoSizeType) {
    isoValidation.textContent = "Edited by surveyor · validates on confirm";
    isoValidation.dataset.state = "neutral";
    derivedCard.hidden = true;
  }
}

function selectDoorPhoto(file, source) {
  if (!file) return;

  selectedFile = file;

  if (objectUrl) URL.revokeObjectURL(objectUrl);
  objectUrl = URL.createObjectURL(file);
  preview.src = objectUrl;

  previewWrap.hidden = false;
  analyseBtn.disabled = false;
  reviewCard.hidden = true;
  startedCard.hidden = true;
  attemptId = null;

  message.textContent =
    source === "gallery"
      ? "Gallery photo ready. The app will optimise it before Vision OCR."
      : "Photo ready. The app will optimise it before Vision OCR.";
}

input.addEventListener("change", () => {
  const [file] = input.files ?? [];
  if (!file) return;
  galleryInput.value = "";
  selectDoorPhoto(file, "camera");
});

galleryInput.addEventListener("change", () => {
  const [file] = galleryInput.files ?? [];
  if (!file) return;
  input.value = "";
  selectDoorPhoto(file, "gallery");
});

retake.addEventListener("click", () => {
  clearPreview();
  input.click();
});

backBtn.addEventListener("click", () => {
  clearPreview();
  input.click();
});

containerNoInput.addEventListener("input", markEdited);
isoSizeTypeInput.addEventListener("input", markEdited);

analyseBtn.addEventListener("click", async () => {
  if (!selectedFile) return;

  setBusy(analyseBtn, true, "Analysing…", "Analyse door photo");
  message.textContent = "Optimising image and reading container markings…";

  try {
    const uploadFile = await compressForOcr(selectedFile);
    const form = new FormData();
    form.append("doorPhoto", uploadFile, uploadFile.name || "door.jpg");

    const result = await apiJson("/api/door/identify", {
      method: "POST",
      body: form
    });

    populateReview(result);
    message.textContent = "Door photo analysed.";
  } catch (error) {
    message.textContent =
      error instanceof Error ? error.message : "Door OCR failed.";
  } finally {
    setBusy(analyseBtn, false, "Analysing…", "Analyse door photo");
  }
});

confirmBtn.addEventListener("click", async () => {
  if (!attemptId) {
    reviewMessage.textContent = "Analyse a door photo first.";
    return;
  }

  const containerNo = normalizeContainerText(containerNoInput.value);
  const isoSizeType = normalizeIsoText(isoSizeTypeInput.value);

  setBusy(confirmBtn, true, "Starting survey…", "Confirm & start survey");
  reviewMessage.textContent = "Validating container identity…";

  try {
    const result = await apiJson("/api/door/confirm", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        attemptId,
        containerNo,
        isoSizeType,
        depotCode: "POC"
      })
    });

    captureCard.hidden = true;
    reviewCard.hidden = true;
    startedCard.hidden = false;

    startedTitle.textContent = result.survey.resumed
      ? "Existing survey resumed"
      : "New gate cycle created";

    startedText.textContent = result.survey.resumed
      ? "This container already had an active gate-in cycle, so the existing survey was resumed."
      : "A new gate-in cycle and survey were created for this container visit.";

    startedContainer.textContent =
      result.container.containerNo +
      " · " +
      result.container.isoSizeType +
      " · " +
      result.container.containerType;

    startedCycle.textContent = String(result.survey.cycleSequence);
    startedSurvey.textContent = result.survey.surveyId;

    startedCard.scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (error) {
    reviewMessage.textContent =
      error instanceof Error ? error.message : "Unable to start survey.";
  } finally {
    setBusy(confirmBtn, false, "Starting survey…", "Confirm & start survey");
  }
});


const addFindingBtn=document.querySelector("#addFindingBtn");
const findingCard=document.querySelector("#findingCard");
const findingFace=document.querySelector("#findingFace");
const createFindingBtn=document.querySelector("#createFindingBtn");
const findingCapture=document.querySelector("#findingCapture");
const findingLabel=document.querySelector("#findingLabel");
const overviewPhoto=document.querySelector("#overviewPhoto");
const overviewGalleryPhoto=document.querySelector("#overviewGalleryPhoto");
const overviewStage=document.querySelector("#overviewStage");
const overviewPreview=document.querySelector("#overviewPreview");
const overviewCanvas=document.querySelector("#overviewCanvas");
const tapHelp=document.querySelector("#tapHelp");
const closeupPhoto=document.querySelector("#closeupPhoto");
const closeupGalleryPhoto=document.querySelector("#closeupGalleryPhoto");
const closeupStage=document.querySelector("#closeupStage");
const closeupPreview=document.querySelector("#closeupPreview");
const closeupCanvas=document.querySelector("#closeupCanvas");
const boxHelp=document.querySelector("#boxHelp");
const saveFindingBtn=document.querySelector("#saveFindingBtn");
const findingMessage=document.querySelector("#findingMessage");
const analyseComponentBtn=document.querySelector("#analyseComponentBtn");
const cedexReview=document.querySelector("#cedexReview");
const cedexSuggestion=document.querySelector("#cedexSuggestion");
const cedexCandidates=document.querySelector("#cedexCandidates");
const componentDecision=document.querySelector("#componentDecision");
const componentSelect=document.querySelector("#componentSelect");
const confirmComponentBtn=document.querySelector("#confirmComponentBtn");
const componentDecisionMessage=document.querySelector("#componentDecisionMessage");
const analyseDamageBtn=document.querySelector("#analyseDamageBtn"),damageReview=document.querySelector("#damageReview"),damageSuggestion=document.querySelector("#damageSuggestion"),damageCandidates=document.querySelector("#damageCandidates"),damageDecision=document.querySelector("#damageDecision"),damageSelect=document.querySelector("#damageSelect"),confirmDamageBtn=document.querySelector("#confirmDamageBtn"),damageDecisionMessage=document.querySelector("#damageDecisionMessage");
let damageAiCode=null;
let componentAiCode=null;

let currentSurveyId=null,currentFinding=null,overviewFile=null,closeupFile=null,locationPoint=null,damageBox=null;
let aiLocationPoint=null,aiDamageBox=null;
let overviewAiRequest=0,closeupAiRequest=0,overviewEdited=false,closeupEdited=false;

addFindingBtn.addEventListener("click",()=>{
  currentSurveyId=startedSurvey.textContent.trim();
  findingCard.hidden=false;
  findingCard.scrollIntoView({behavior:"smooth",block:"start"});
});

createFindingBtn.addEventListener("click",async()=>{
  if(!findingFace.value){findingMessage.textContent="Select the container face first.";return;}
  setBusy(createFindingBtn,true,"Creating…","Create finding");
  try{
    currentFinding=await apiJson("/api/findings",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({surveyId:currentSurveyId,containerFace:findingFace.value})});
    findingLabel.textContent="Finding "+currentFinding.finding_sequence+" · "+findingFace.options[findingFace.selectedIndex].text;
    findingCapture.hidden=false; createFindingBtn.hidden=true; findingFace.disabled=true;
    findingMessage.textContent="Finding created. Capture the overview photo.";
  }catch(e){findingMessage.textContent=e instanceof Error?e.message:"Unable to create finding.";}
  finally{setBusy(createFindingBtn,false,"Creating…","Create finding");}
});

function showImage(file,img,stage,canvas,ready){
  const url=URL.createObjectURL(file);
  img.onload=()=>{stage.hidden=false;requestAnimationFrame(()=>{canvas.width=img.clientWidth;canvas.height=img.clientHeight;ready();});};
  img.src=url;
}

function selectOverviewPhoto(file,source){
  overviewFile=file??null; locationPoint=null;aiLocationPoint=null;overviewEdited=false;
  const requestId=++overviewAiRequest;
  if(!overviewFile)return;
  if(source==="gallery") overviewPhoto.value=""; else overviewGalleryPhoto.value="";
  showImage(overviewFile,overviewPreview,overviewStage,overviewCanvas,async()=>{
    tapHelp.hidden=false;tapHelp.textContent="AI is locating the visible damage…";
    try{
      const upload=await compressForOcr(overviewFile),form=new FormData();
      form.append("photo",upload,upload.name||"overview.jpg");form.append("mode","point");
      const result=await apiJson("/api/vision/mark-damage",{method:"POST",body:form});
      if(requestId!==overviewAiRequest||overviewEdited)return;
      if(result.found&&result.geometry){
        aiLocationPoint={...result.geometry};locationPoint={...result.geometry};drawTarget(overviewCanvas,locationPoint,true);
        tapHelp.textContent="AI proposed this position. Tap the photo to correct it if needed.";
      }else{
        tapHelp.textContent="AI could not locate damage confidently. Tap the damaged position.";
      }
    }catch{
      tapHelp.textContent="AI marking unavailable. Tap the damaged position.";
    }
    updateFindingReady();
  });
}
overviewPhoto.addEventListener("change",()=>selectOverviewPhoto(overviewPhoto.files?.[0]??null,"camera"));
overviewGalleryPhoto.addEventListener("change",()=>selectOverviewPhoto(overviewGalleryPhoto.files?.[0]??null,"gallery"));

function drawTarget(canvas,point,isAi=false){
  const ctx=canvas.getContext("2d"),x=point.x*canvas.width,y=point.y*canvas.height,r=14;
  ctx.clearRect(0,0,canvas.width,canvas.height);
  ctx.lineWidth=5;ctx.strokeStyle=isAi?"#ffd54a":"#6ee7ff";ctx.fillStyle=isAi?"#ffd54a":"#6ee7ff";
  ctx.beginPath();ctx.arc(x,y,r,0,Math.PI*2);ctx.stroke();
  ctx.beginPath();ctx.moveTo(x-r-10,y);ctx.lineTo(x+r+10,y);ctx.moveTo(x,y-r-10);ctx.lineTo(x,y+r+10);ctx.stroke();
  ctx.beginPath();ctx.arc(x,y,4,0,Math.PI*2);ctx.fill();
}
function drawBox(canvas,box,isAi=false){
  const ctx=canvas.getContext("2d");ctx.clearRect(0,0,canvas.width,canvas.height);
  ctx.save();
  ctx.lineWidth=6;ctx.strokeStyle=isAi?"#ffd54a":"#6ee7ff";
  ctx.shadowColor="rgba(0,0,0,.85)";ctx.shadowBlur=4;
  ctx.strokeRect(box.x*canvas.width,box.y*canvas.height,box.width*canvas.width,box.height*canvas.height);
  ctx.restore();
}
function syncAnnotationCanvas(img,canvas){
  const rect=img.getBoundingClientRect(),width=Math.max(1,Math.round(rect.width)),height=Math.max(1,Math.round(rect.height));
  if(canvas.width!==width||canvas.height!==height){canvas.width=width;canvas.height=height;}
}
function redrawAnnotations(){
  if(!overviewStage.hidden&&overviewPreview.complete&&locationPoint){
    syncAnnotationCanvas(overviewPreview,overviewCanvas);drawTarget(overviewCanvas,locationPoint,!overviewEdited);
  }
  if(!closeupStage.hidden&&closeupPreview.complete&&damageBox){
    syncAnnotationCanvas(closeupPreview,closeupCanvas);drawBox(closeupCanvas,damageBox,!closeupEdited);
  }
}
window.addEventListener("resize",()=>requestAnimationFrame(redrawAnnotations));
document.addEventListener("visibilitychange",()=>{if(!document.hidden)requestAnimationFrame(redrawAnnotations);});

overviewCanvas.addEventListener("pointerdown",(event)=>{
  overviewEdited=true;
  const rect=overviewCanvas.getBoundingClientRect();
  locationPoint={x:(event.clientX-rect.left)/rect.width,y:(event.clientY-rect.top)/rect.height};
  drawTarget(overviewCanvas,locationPoint,false);
  tapHelp.textContent="Damage position marked. Tap again to adjust.";
  updateFindingReady();
});

let dragStart=null;
function selectCloseupPhoto(file,source){
  closeupFile=file??null;damageBox=null;aiDamageBox=null;closeupEdited=false;
  const requestId=++closeupAiRequest;
  if(!closeupFile)return;
  if(source==="gallery") closeupPhoto.value=""; else closeupGalleryPhoto.value="";
  showImage(closeupFile,closeupPreview,closeupStage,closeupCanvas,async()=>{
    boxHelp.hidden=false;boxHelp.textContent="AI is locating the damaged area…";
    try{
      const upload=await compressForOcr(closeupFile),form=new FormData();
      form.append("photo",upload,upload.name||"closeup.jpg");form.append("mode","box");
      const result=await apiJson("/api/vision/mark-damage",{method:"POST",body:form});
      if(requestId!==closeupAiRequest||closeupEdited)return;
      if(result.found&&result.geometry){
        aiDamageBox={...result.geometry};damageBox={...result.geometry};drawBox(closeupCanvas,damageBox,true);
        boxHelp.textContent="AI proposed this damage box. Drag to redraw it if needed.";
      }else{
        boxHelp.textContent="AI could not locate damage confidently. Drag a box around the damage.";
      }
    }catch{
      boxHelp.textContent="AI marking unavailable. Drag a box around the damage.";
    }
    updateFindingReady();
  });
}
closeupPhoto.addEventListener("change",()=>selectCloseupPhoto(closeupPhoto.files?.[0]??null,"camera"));
closeupGalleryPhoto.addEventListener("change",()=>selectCloseupPhoto(closeupGalleryPhoto.files?.[0]??null,"gallery"));

closeupCanvas.addEventListener("pointerdown",(event)=>{
  closeupEdited=true;
  const r=closeupCanvas.getBoundingClientRect();dragStart={x:(event.clientX-r.left)/r.width,y:(event.clientY-r.top)/r.height};closeupCanvas.setPointerCapture(event.pointerId);
});
closeupCanvas.addEventListener("pointerup",(event)=>{
  if(!dragStart)return;
  const r=closeupCanvas.getBoundingClientRect(),end={x:(event.clientX-r.left)/r.width,y:(event.clientY-r.top)/r.height};
  damageBox={x:Math.min(dragStart.x,end.x),y:Math.min(dragStart.y,end.y),width:Math.abs(end.x-dragStart.x),height:Math.abs(end.y-dragStart.y)};
  dragStart=null;
  drawBox(closeupCanvas,damageBox,false);
  boxHelp.textContent="Damage area marked. Drag again to adjust.";updateFindingReady();
});

function updateFindingReady(){saveFindingBtn.disabled=!(overviewFile&&closeupFile&&locationPoint&&damageBox);}

async function uploadFindingPhoto(file,role,img){
  const upload=await compressForOcr(file),form=new FormData();
  form.append("surveyId",currentSurveyId);form.append("findingId",currentFinding.id);form.append("role",role);
  form.append("width",String(img.naturalWidth));form.append("height",String(img.naturalHeight));form.append("photo",upload,upload.name||"photo.jpg");
  return apiJson("/api/findings/photo",{method:"POST",body:form});
}

saveFindingBtn.addEventListener("click",async()=>{
  setBusy(saveFindingBtn,true,"Saving…","Save finding evidence");findingMessage.textContent="Uploading finding evidence…";
  try{
    const overview=await uploadFindingPhoto(overviewFile,"FACE_OVERVIEW",overviewPreview);
    if(aiLocationPoint) await apiJson("/api/annotations",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({photoId:overview.photoId,annotationType:"LOCATION_POINT",geometryType:"POINT",geometry:aiLocationPoint,createdBy:"AI"})});
    await apiJson("/api/annotations",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({photoId:overview.photoId,annotationType:"LOCATION_POINT",geometryType:"POINT",geometry:locationPoint,createdBy:"SURVEYOR"})});
    const closeup=await uploadFindingPhoto(closeupFile,"DAMAGE_CLOSEUP",closeupPreview);
    if(aiDamageBox) await apiJson("/api/annotations",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({photoId:closeup.photoId,annotationType:"DAMAGE",geometryType:"BOX",geometry:aiDamageBox,createdBy:"AI"})});
    await apiJson("/api/annotations",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({photoId:closeup.photoId,annotationType:"DAMAGE",geometryType:"BOX",geometry:damageBox,createdBy:"SURVEYOR"})});
    findingMessage.textContent="Finding "+currentFinding.finding_sequence+" evidence saved.";
    redrawAnnotations();
    saveFindingBtn.textContent="Finding saved ✓";saveFindingBtn.disabled=true;
    analyseComponentBtn.hidden=false;
  }catch(e){findingMessage.textContent=e instanceof Error?e.message:"Unable to save finding evidence.";setBusy(saveFindingBtn,false,"Saving…","Save finding evidence");}
});


analyseComponentBtn.addEventListener("click",async()=>{
  if(!currentFinding)return;
  setBusy(analyseComponentBtn,true,"Analysing component…","Analyse CEDEX component");
  cedexReview.hidden=false;cedexSuggestion.textContent="Checking the close-up against the verified GP/RF component master…";cedexCandidates.textContent="";
  try{
    const result=await apiJson("/api/cedex/component-suggest",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({findingId:currentFinding.id})});
    cedexSuggestion.textContent=result.selectedCode
      ? result.selectedCode+" · "+Math.round((result.confidence??0)*100)+"% confidence"+(result.needsReview?" · review required":"")
      : "No reliable component selected · surveyor review required";
    cedexCandidates.textContent=result.candidates?.length
      ? "Candidates: "+result.candidates.map(x=>x.code+" "+Math.round((x.confidence??0)*100)+"%").join(" · ")
      : "No valid CEDEX candidates returned.";
    componentAiCode=result.selectedCode??null;
    componentDecision.hidden=!result.selectedCode;
    componentDecisionMessage.textContent="";
    componentSelect.innerHTML="";
    for(const candidate of (result.allowedComponents??result.candidates??[])){
      const code=candidate.component_code??candidate.code,name=candidate.component_name??code;
      if(!code)continue;
      const option=document.createElement("option");option.value=code;option.textContent=code+" — "+name;
      if(code===result.selectedCode)option.selected=true;componentSelect.appendChild(option);
    }
    confirmComponentBtn.textContent="Accept "+(result.selectedCode??"component");
  }catch(e){
    cedexSuggestion.textContent=e instanceof Error?e.message:"Unable to analyse CEDEX component.";
  }finally{setBusy(analyseComponentBtn,false,"Analysing component…","Analyse CEDEX component");}
});


componentSelect.addEventListener("change",()=>{
  confirmComponentBtn.textContent=componentSelect.value===componentAiCode?"Accept "+componentAiCode:"Confirm correction";
});
confirmComponentBtn.addEventListener("click",async()=>{
  if(!currentFinding||!componentSelect.value)return;
  setBusy(confirmComponentBtn,true,"Saving…","Accept component");
  try{
    const result=await apiJson("/api/cedex/component-decision",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({findingId:currentFinding.id,finalCode:componentSelect.value})});
    componentDecisionMessage.textContent=result.decision==="APPROVED"
      ?"Component accepted: "+result.finalCode
      :"AI corrected from "+(result.aiCode??"none")+" to "+result.finalCode;
    componentSelect.disabled=true;confirmComponentBtn.disabled=true;confirmComponentBtn.textContent="Component confirmed ✓";
    analyseDamageBtn.hidden=!result.damageAnalysisAvailable;
    if(!result.damageAnalysisAvailable){
      componentDecisionMessage.textContent+=" · Damage-code analysis is not yet loaded for this component.";
    }
  }catch(e){
    componentDecisionMessage.textContent=e instanceof Error?e.message:"Unable to save component decision.";
    setBusy(confirmComponentBtn,false,"Saving…","Accept component");
  }
});


analyseDamageBtn.addEventListener("click",async()=>{
  if(!currentFinding)return;setBusy(analyseDamageBtn,true,"Analysing damage…","Analyse IICL damage");
  damageReview.hidden=false;damageSuggestion.textContent="Checking visible damage against valid IICL codes for the confirmed component…";damageCandidates.textContent="";
  try{
    const result=await apiJson("/api/cedex/damage-suggest",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({findingId:currentFinding.id})});
    damageSuggestion.textContent=result.selectedCode?result.selectedCode+" · "+Math.round((result.confidence??0)*100)+"% confidence"+(result.needsReview?" · review required":""):"No reliable damage selected · surveyor review required";
    damageCandidates.textContent=result.candidates?.length?"Candidates: "+result.candidates.map(x=>x.code+" "+Math.round((x.confidence??0)*100)+"%").join(" · "):"No valid damage candidates returned.";
    damageAiCode=result.selectedCode??null;damageSelect.innerHTML="";damageSelect.disabled=false;
    if(!result.selectedCode){
      const placeholder=document.createElement("option");placeholder.value="";placeholder.textContent="Select damage code";placeholder.disabled=true;placeholder.selected=true;damageSelect.appendChild(placeholder);
    }
    for(const x of result.allowedDamages??[]){const o=document.createElement("option");o.value=x.damage_code;o.textContent=x.damage_code+" — "+x.damage_name;if(x.damage_code===result.selectedCode)o.selected=true;damageSelect.appendChild(o);}
    damageDecision.hidden=!(result.allowedDamages?.length);damageDecisionMessage.textContent="";
    confirmDamageBtn.disabled=!damageSelect.value;
    confirmDamageBtn.textContent=result.selectedCode?"Accept "+result.selectedCode:"Select damage code";
  }catch(e){damageSuggestion.textContent=e instanceof Error?e.message:"Unable to analyse damage.";}
  finally{setBusy(analyseDamageBtn,false,"Analysing damage…","Analyse IICL damage");}
});
damageSelect.addEventListener("change",()=>{confirmDamageBtn.disabled=!damageSelect.value;confirmDamageBtn.textContent=damageSelect.value===damageAiCode?"Accept "+damageAiCode:"Confirm correction";});
confirmDamageBtn.addEventListener("click",async()=>{
  if(!currentFinding||!damageSelect.value)return;setBusy(confirmDamageBtn,true,"Saving…","Accept damage");
  try{
    const result=await apiJson("/api/cedex/damage-decision",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({findingId:currentFinding.id,finalCode:damageSelect.value})});
    damageDecisionMessage.textContent=result.decision==="APPROVED"?"Damage accepted: "+result.finalCode:"AI corrected from "+(result.aiCode??"none")+" to "+result.finalCode;
    damageSelect.disabled=true;confirmDamageBtn.disabled=true;confirmDamageBtn.textContent="Damage confirmed ✓";
  }catch(e){damageDecisionMessage.textContent=e instanceof Error?e.message:"Unable to save damage decision.";setBusy(confirmDamageBtn,false,"Saving…","Accept damage");}
});