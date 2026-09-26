import { createGuidedCamera } from "./camera-guidance.js";

const input = document.querySelector("#doorPhoto");
const galleryInput = document.querySelector("#doorGalleryPhoto");
const previewWrap = document.querySelector("#previewWrap");
const preview = document.querySelector("#preview");
const retake = document.querySelector("#retake");
const analyseBtn = document.querySelector("#analyseBtn");
const message = document.querySelector("#message");
const manualIdentityBtn = document.querySelector("#manualIdentityBtn");
const defaultGpBtn = document.querySelector("#defaultGpBtn");

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
const reviewIntro = document.querySelector("#reviewIntro");

const startedCard = document.querySelector("#startedCard");
const startedTitle = document.querySelector("#startedTitle");
const startedText = document.querySelector("#startedText");
const startedContainer = document.querySelector("#startedContainer");
const startedCycle = document.querySelector("#startedCycle");
const startedSurvey = document.querySelector("#startedSurvey");

const DEFAULT_GP_TEST = {
  containerNo: "CSQU3054383",
  isoSizeType: "45G1",
  containerType: "GP",
  lengthFt: 40,
  height: "High Cube"
};

let selectedFile = null;
let objectUrl = null;
let attemptId = null;
let identityMode = "photo";
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
  identityMode = "photo";
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
    const error = new Error(payload.message || "Request failed.");
    error.code = payload.error;
    error.result = payload.result;
    throw error;
  }

  return payload.result;
}

function populateReview(result) {
  identityMode = "photo";
  attemptId = result.attemptId;
  reviewIntro.textContent = "Review the OCR result. Edit only if the marking was read incorrectly.";

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

function showNoPhotoReview(useDefault) {
  identityMode = useDefault ? "default" : "manual";
  attemptId = null;
  selectedFile = null;
  originalDetected = {
    containerNo: useDefault ? DEFAULT_GP_TEST.containerNo : "",
    isoSizeType: useDefault ? DEFAULT_GP_TEST.isoSizeType : ""
  };

  containerNoInput.value = originalDetected.containerNo;
  isoSizeTypeInput.value = originalDetected.isoSizeType;
  reviewIntro.textContent = useDefault
    ? "Door photo skipped. The default GP test identity is ready; edit it if required."
    : "Door photo skipped. Enter a valid container number and ISO size/type code.";

  containerValidation.textContent = useDefault
    ? "Test value · validated when survey starts"
    : "Enter a valid ISO 6346 container number";
  containerValidation.dataset.state = useDefault ? "ok" : "neutral";
  isoValidation.textContent = useDefault
    ? "45G1 · GP · validated when survey starts"
    : "Enter an active ISO size/type code";
  isoValidation.dataset.state = useDefault ? "ok" : "neutral";

  containerConfidence.textContent = "Door OCR skipped";
  isoConfidence.textContent = useDefault ? "Default GP test data" : "Manual test entry";

  if (useDefault) {
    derivedCard.hidden = false;
    containerType.textContent = DEFAULT_GP_TEST.containerType;
    containerLength.textContent = DEFAULT_GP_TEST.lengthFt + " ft";
    containerHeight.textContent = DEFAULT_GP_TEST.height;
  } else {
    derivedCard.hidden = true;
  }

  reviewMessage.textContent = "Front-end test mode. Confirm to validate the identity and start or resume the survey.";
  reviewCard.hidden = false;
  startedCard.hidden = true;
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
  const wasPhotoMode = identityMode === "photo";
  clearPreview();
  if (wasPhotoMode) input.click();
});

manualIdentityBtn.addEventListener("click", () => {
  showNoPhotoReview(false);
});

defaultGpBtn.addEventListener("click", () => {
  showNoPhotoReview(true);
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
  if (identityMode === "photo" && !attemptId) {
    reviewMessage.textContent = "Analyse a door photo first.";
    return;
  }

  const containerNo = normalizeContainerText(containerNoInput.value);
  const isoSizeType = normalizeIsoText(isoSizeTypeInput.value);

  if (!containerNo || !isoSizeType) {
    reviewMessage.textContent = "Enter both the container number and ISO size/type code.";
    return;
  }

  setBusy(confirmBtn, true, "Starting survey…", "Confirm & start survey");
  reviewMessage.textContent = identityMode === "photo"
    ? "Validating container identity…"
    : "Validating test identity without a door photo…";

  try {
    const skipDoorPhoto = identityMode !== "photo";
    const result = await apiJson(skipDoorPhoto ? "/api/surveys/start" : "/api/door/confirm", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(skipDoorPhoto
        ? { containerNo, isoSizeType, depotCode: "POC" }
        : { attemptId, containerNo, isoSizeType, depotCode: "POC" })
    });

    captureCard.hidden = true;
    reviewCard.hidden = true;
    startedCard.hidden = false;

    startedTitle.textContent = result.survey.resumed
      ? "Existing survey resumed"
      : "New gate cycle created";

    const noPhotoNote = skipDoorPhoto
      ? " Door photo was skipped for front-end testing."
      : "";
    startedText.textContent = (result.survey.resumed
      ? "This container already had an active gate-in cycle, so the existing survey was resumed."
      : "A new gate-in cycle and survey were created for this container visit.") + noPhotoNote;

    const resultContainerNo = result.container.containerNo ?? result.container.normalized ?? containerNo;
    const resultIso = result.container.isoSizeType ?? result.isoSizeType ?? isoSizeType;
    const resultType = result.container.containerType ?? result.iso?.app_container_type ?? "—";

    startedContainer.textContent =
      resultContainerNo +
      " · " +
      resultIso +
      " · " +
      resultType;

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
const overviewCameraBtn=document.querySelector("#overviewCameraBtn");
const overviewPhoto=document.querySelector("#overviewPhoto");
const overviewGalleryPhoto=document.querySelector("#overviewGalleryPhoto");
const overviewStage=document.querySelector("#overviewStage");
const overviewPreview=document.querySelector("#overviewPreview");
const overviewCanvas=document.querySelector("#overviewCanvas");
const tapHelp=document.querySelector("#tapHelp");
const closeupCameraBtn=document.querySelector("#closeupCameraBtn");
const closeupPhoto=document.querySelector("#closeupPhoto");
const closeupGalleryPhoto=document.querySelector("#closeupGalleryPhoto");
const closeupStage=document.querySelector("#closeupStage");
const closeupPreview=document.querySelector("#closeupPreview");
const closeupCanvas=document.querySelector("#closeupCanvas");
const boxHelp=document.querySelector("#boxHelp");
const saveFindingBtn=document.querySelector("#saveFindingBtn");
const findingMessage=document.querySelector("#findingMessage");
const geometryReference=document.querySelector("#geometryReference");
const geometryReferenceText=document.querySelector("#geometryReferenceText");
const cameraGuideModal=document.querySelector("#cameraGuideModal");
const guidedCameraViewport=document.querySelector("#guidedCameraViewport");
const guidedCameraVideo=document.querySelector("#guidedCameraVideo");
const guidedCameraOverlay=document.querySelector("#guidedCameraOverlay");
const guidedCameraStatus=document.querySelector("#guidedCameraStatus");
const guidedCameraQuality=document.querySelector("#guidedCameraQuality");
const guidedCameraCapture=document.querySelector("#guidedCameraCapture");
const guidedCameraCancel=document.querySelector("#guidedCameraCancel");
const guidedCameraFallback=document.querySelector("#guidedCameraFallback");
const analyseComponentBtn=document.querySelector("#analyseComponentBtn");
const cedexReview=document.querySelector("#cedexReview");
const cedexSuggestion=document.querySelector("#cedexSuggestion");
const cedexCandidates=document.querySelector("#cedexCandidates");
const componentDecision=document.querySelector("#componentDecision");
const componentSelect=document.querySelector("#componentSelect");
const confirmComponentBtn=document.querySelector("#confirmComponentBtn");
const componentDecisionMessage=document.querySelector("#componentDecisionMessage");
const analyseDamageBtn=document.querySelector("#analyseDamageBtn"),damageReview=document.querySelector("#damageReview"),damageSuggestion=document.querySelector("#damageSuggestion"),damageCandidates=document.querySelector("#damageCandidates"),damageDecision=document.querySelector("#damageDecision"),damageSelect=document.querySelector("#damageSelect"),confirmDamageBtn=document.querySelector("#confirmDamageBtn"),damageDecisionMessage=document.querySelector("#damageDecisionMessage");
const analyseRepairBtn=document.querySelector("#analyseRepairBtn"),repairReview=document.querySelector("#repairReview"),repairSuggestion=document.querySelector("#repairSuggestion"),repairCandidates=document.querySelector("#repairCandidates"),repairDecision=document.querySelector("#repairDecision"),repairSelect=document.querySelector("#repairSelect"),confirmRepairBtn=document.querySelector("#confirmRepairBtn"),repairDecisionMessage=document.querySelector("#repairDecisionMessage"),repairLengthCm=document.querySelector("#repairLengthCm"),repairWidthCm=document.querySelector("#repairWidthCm"),repairDepthCm=document.querySelector("#repairDepthCm"),repairCorrugations=document.querySelector("#repairCorrugations"),repairNotes=document.querySelector("#repairNotes");
let damageAiCode=null;
let componentAiCode=null;
let repairAiCode=null;

let currentSurveyId=null,currentFinding=null,overviewFile=null,closeupFile=null,locationPoint=null,damageBox=null;
let aiLocationPoint=null,aiDamageBox=null;
let overviewAiRequest=0,closeupAiRequest=0,overviewEdited=false,closeupEdited=false;
let currentGeometry=null,overviewCaptureMeta=null,closeupCaptureMeta=null;

const cameraGuidanceV1=new URLSearchParams(window.location.search).get("cameraGuidance")!=="0";
const guidedCamera=createGuidedCamera({
  modal:cameraGuideModal,
  viewport:guidedCameraViewport,
  video:guidedCameraVideo,
  overlay:guidedCameraOverlay,
  statusText:guidedCameraStatus,
  qualityBadge:guidedCameraQuality,
  captureButton:guidedCameraCapture,
  cancelButton:guidedCameraCancel,
  fallbackButton:guidedCameraFallback
});

function unscoredCaptureMetadata(source,photoType){
  return {
    version:"camera_guidance_v1",
    source,
    photoType,
    containerFace:findingFace.value||null,
    equipmentType:currentGeometry?.equipmentType||containerType.textContent.trim()||null,
    identificationQuality:"UNKNOWN",
    measurementQuality:"UNKNOWN"
  };
}

function openGuidedCapture(mode){
  const isOverview=mode==="overview";
  const fallbackInput=isOverview?overviewPhoto:closeupPhoto;
  if(!cameraGuidanceV1){fallbackInput.click();return;}
  guidedCamera.open({
    mode,
    face:findingFace.value,
    equipmentType:currentGeometry?.equipmentType||containerType.textContent.trim(),
    fallbackInput,
    onCapture:async(file,metadata)=>{
      if(isOverview)selectOverviewPhoto(file,"guided",metadata);
      else selectCloseupPhoto(file,"guided",metadata);
    }
  }).catch((error)=>{
    findingMessage.textContent=error instanceof Error?error.message:"Unable to start guided camera.";
  });
}

overviewCameraBtn.addEventListener("click",()=>openGuidedCapture("overview"));
closeupCameraBtn.addEventListener("click",()=>openGuidedCapture("closeup"));

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
    findingMessage.textContent="Finding created. Capture the overview / measurement photo.";
    geometryReference.hidden=true;
    geometryReferenceText.textContent="";
    currentGeometry=null;overviewCaptureMeta=null;closeupCaptureMeta=null;
    try{
      const geometry=await apiJson("/api/findings/geometry",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({findingId:currentFinding.id})});
      currentGeometry=geometry;
      if(geometry?.lengthMm&&geometry?.heightMm){
        geometryReferenceText.textContent=geometry.isoCode+" · "+geometry.equipmentType+" · "+geometry.lengthMm+" × "+geometry.heightMm+" mm external reference";
        geometryReference.hidden=false;
      }
    }catch{}
    repairReview.hidden=true;analyseRepairBtn.hidden=true;repairAiCode=null;
  }catch(e){findingMessage.textContent=e instanceof Error?e.message:"Unable to create finding.";}
  finally{setBusy(createFindingBtn,false,"Creating…","Create finding");}
});

function showImage(file,img,stage,canvas,ready){
  const url=URL.createObjectURL(file);
  img.onload=()=>{stage.hidden=false;requestAnimationFrame(()=>{canvas.width=img.clientWidth;canvas.height=img.clientHeight;ready();});};
  img.src=url;
}

function selectOverviewPhoto(file,source,captureMetadata=null){
  overviewFile=file??null; locationPoint=null;aiLocationPoint=null;overviewEdited=false;
  overviewCaptureMeta=captureMetadata??unscoredCaptureMetadata(source,"overview");
  const requestId=++overviewAiRequest;
  if(!overviewFile)return;
  if(source==="gallery") overviewPhoto.value=""; else overviewGalleryPhoto.value="";
  findingMessage.textContent=source==="gallery"
    ?"Overview loaded from Gallery. Verify that rails/structural references are visible before using it for measurement."
    :source==="guided"
      ?"Guided overview captured. Verify the AI damage position before saving."
      :"Overview captured. Verify damage is centred and known container geometry is visible.";
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
overviewPhoto.addEventListener("change",()=>selectOverviewPhoto(overviewPhoto.files?.[0]??null,"system_camera"));
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
function selectCloseupPhoto(file,source,captureMetadata=null){
  closeupFile=file??null;damageBox=null;aiDamageBox=null;closeupEdited=false;
  closeupCaptureMeta=captureMetadata??unscoredCaptureMetadata(source,"closeup");
  const requestId=++closeupAiRequest;
  if(!closeupFile)return;
  if(source==="gallery") closeupPhoto.value=""; else closeupGalleryPhoto.value="";
  findingMessage.textContent=source==="gallery"
    ?"Close-up loaded from Gallery. It can support classification; measurement will rely on overview geometry."
    :source==="guided"
      ?"Guided close-up captured. Verify the AI damage box before saving."
      :"Close-up captured. Keep the complete damage and surrounding component detail visible.";
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
closeupPhoto.addEventListener("change",()=>selectCloseupPhoto(closeupPhoto.files?.[0]??null,"system_camera"));
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

async function uploadFindingPhoto(file,role,img,captureMetadata){
  const upload=await compressForOcr(file),form=new FormData();
  form.append("surveyId",currentSurveyId);form.append("findingId",currentFinding.id);form.append("role",role);
  form.append("width",String(img.naturalWidth));form.append("height",String(img.naturalHeight));form.append("photo",upload,upload.name||"photo.jpg");
  if(captureMetadata)form.append("captureMetadata",JSON.stringify(captureMetadata));
  return apiJson("/api/findings/photo",{method:"POST",body:form});
}

saveFindingBtn.addEventListener("click",async()=>{
  setBusy(saveFindingBtn,true,"Saving…","Save finding evidence");findingMessage.textContent="Uploading finding evidence…";
  try{
    const overview=await uploadFindingPhoto(overviewFile,"FACE_OVERVIEW",overviewPreview,overviewCaptureMeta);
    if(aiLocationPoint) await apiJson("/api/annotations",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({photoId:overview.photoId,annotationType:"LOCATION_POINT",geometryType:"POINT",geometry:aiLocationPoint,createdBy:"AI"})});
    await apiJson("/api/annotations",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({photoId:overview.photoId,annotationType:"LOCATION_POINT",geometryType:"POINT",geometry:locationPoint,createdBy:"SURVEYOR"})});
    const closeup=await uploadFindingPhoto(closeupFile,"DAMAGE_CLOSEUP",closeupPreview,closeupCaptureMeta);
    if(aiDamageBox) await apiJson("/api/annotations",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({photoId:closeup.photoId,annotationType:"DAMAGE",geometryType:"BOX",geometry:aiDamageBox,createdBy:"AI"})});
    await apiJson("/api/annotations",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({photoId:closeup.photoId,annotationType:"DAMAGE",geometryType:"BOX",geometry:damageBox,createdBy:"SURVEYOR"})});
    findingMessage.textContent="Finding "+currentFinding.finding_sequence+" evidence saved.";
    redrawAnnotations();
    saveFindingBtn.textContent="Finding saved ✓";saveFindingBtn.disabled=true;
    analyseComponentBtn.hidden=false;
  }catch(e){findingMessage.textContent=e instanceof Error?e.message:"Unable to save finding evidence.";setBusy(saveFindingBtn,false,"Saving…","Save finding evidence");}
});


function componentConfidence(value){
  return typeof value==="number" && Number.isFinite(value) ? " · "+Math.round(value*100)+"% confidence" : "";
}

function renderComponentResult(result){
  componentAiCode=result.selectedCode??null;
  const failed=["INCOMPLETE","INVALID_RESPONSE"].includes(result.analysisStatus);
  cedexSuggestion.textContent=failed
    ? result.reason
    : result.selectedCode
      ? result.selectedCode+componentConfidence(result.confidence)+(result.needsReview?" · review required":"")
      : "No reliable component selected · select manually or retry";
  cedexCandidates.textContent=result.candidates?.length
    ? "Candidates: "+result.candidates.map(x=>x.code+componentConfidence(x.confidence)).join(" · ")
    : failed ? "No completed AI suggestion is available." : result.reason || "Select the component from the verified list below.";
  componentDecisionMessage.textContent="";
  componentSelect.innerHTML="";
  const placeholder=document.createElement("option");
  placeholder.value="";placeholder.textContent="Select a component…";
  componentSelect.appendChild(placeholder);
  for(const candidate of (result.allowedComponents??[])){
    const code=candidate.component_code;
    if(!code)continue;
    const option=document.createElement("option");option.value=code;option.textContent=code+" — "+(candidate.component_name??code);
    componentSelect.appendChild(option);
  }
  componentSelect.value=result.selectedCode??"";
  componentSelect.disabled=false;
  componentDecision.hidden=componentSelect.options.length<=1;
  confirmComponentBtn.disabled=!componentSelect.value;
  confirmComponentBtn.textContent=componentAiCode?"Accept "+componentAiCode:"Confirm component";
}

analyseComponentBtn.addEventListener("click",async()=>{
  if(!currentFinding)return;
  setBusy(analyseComponentBtn,true,"Analysing component…","Analyse CEDEX component");
  componentDecision.hidden=true;componentSelect.disabled=true;confirmComponentBtn.disabled=true;componentAiCode=null;
  cedexReview.hidden=false;cedexSuggestion.textContent="Checking the marked region against the verified GP/RF component master…";cedexCandidates.textContent="";
  try{
    const result=await apiJson("/api/cedex/component-suggest",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({findingId:currentFinding.id})});
    renderComponentResult(result);
  }catch(e){
    if(["CEDEX_COMPONENT_INCOMPLETE","CEDEX_COMPONENT_INVALID_RESPONSE"].includes(e?.code) && e.result){
      renderComponentResult(e.result);
    }else{
      cedexSuggestion.textContent=e instanceof Error?e.message:"Unable to analyse CEDEX component.";
    }
  }finally{setBusy(analyseComponentBtn,false,"Analysing component…","Analyse CEDEX component");}
});

componentSelect.addEventListener("change",()=>{
  confirmComponentBtn.disabled=!componentSelect.value;
  confirmComponentBtn.textContent=componentAiCode && componentSelect.value===componentAiCode
    ? "Accept "+componentAiCode : componentAiCode ? "Confirm correction" : "Confirm component";
});
confirmComponentBtn.addEventListener("click",async()=>{
  if(!currentFinding||!componentSelect.value)return;
  setBusy(confirmComponentBtn,true,"Saving…","Accept component");
  try{
    const result=await apiJson("/api/cedex/component-decision",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({findingId:currentFinding.id,finalCode:componentSelect.value})});
    componentDecisionMessage.textContent=result.decision==="APPROVED"
      ?"Component accepted: "+result.finalCode
      :result.aiCode?"AI corrected from "+result.aiCode+" to "+result.finalCode:"Component selected manually: "+result.finalCode;
    componentSelect.disabled=true;confirmComponentBtn.disabled=true;confirmComponentBtn.textContent="Component confirmed ✓";
    analyseComponentBtn.disabled=true;
    analyseDamageBtn.hidden=false;
  }catch(e){
    componentDecisionMessage.textContent=e instanceof Error?e.message:"Unable to save component decision.";
    setBusy(confirmComponentBtn,false,"Saving…","Accept component");
  }
});


function renderDamageResult(result){
  const failed=["INCOMPLETE","INVALID_RESPONSE"].includes(result.analysisStatus);
  damageAiCode=result.selectedCode??null;
  damageSuggestion.textContent=failed
    ? result.reason
    : result.selectedCode
      ? result.selectedCode+" · "+Math.round((result.confidence??0)*100)+"% confidence"+(result.needsReview?" · review required":"")
      : "No reliable damage selected · surveyor review required";
  damageCandidates.textContent=result.candidates?.length
    ? "Candidates: "+result.candidates.map(x=>x.code+" "+(typeof x.confidence==="number"?Math.round(x.confidence*100)+"%":"—")+(x.reason?" · "+x.reason:"")).join(" | ")
    : failed ? "No completed AI damage suggestion is available." : result.reason || "Select the damage manually from the verified list below.";

  damageSelect.innerHTML="";
  const placeholder=document.createElement("option");
  placeholder.value="";placeholder.textContent="Select a damage code…";
  damageSelect.appendChild(placeholder);
  for(const x of (result.allowedDamages??[])){
    const o=document.createElement("option");
    o.value=x.damage_code;o.textContent=x.damage_code+" — "+x.damage_name;
    damageSelect.appendChild(o);
  }
  damageSelect.value=result.selectedCode??"";
  damageSelect.disabled=false;
  damageDecision.hidden=damageSelect.options.length<=1;
  damageDecisionMessage.textContent="";
  confirmDamageBtn.disabled=!damageSelect.value;
  confirmDamageBtn.textContent=damageAiCode&&damageSelect.value===damageAiCode
    ?"Accept "+damageAiCode
    :damageAiCode?"Confirm correction":"Confirm damage";
}

analyseDamageBtn.addEventListener("click",async()=>{
  if(!currentFinding)return;
  setBusy(analyseDamageBtn,true,"Analysing damage…","Analyse IICL damage");
  damageReview.hidden=false;
  damageDecision.hidden=true;
  damageSelect.disabled=true;
  confirmDamageBtn.disabled=true;
  damageAiCode=null;
  damageSuggestion.textContent="Checking visible damage against valid IICL codes for the confirmed component…";
  damageCandidates.textContent="";
  try{
    const result=await apiJson("/api/cedex/damage-suggest",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({findingId:currentFinding.id})});
    renderDamageResult(result);
  }catch(e){
    if(["CEDEX_DAMAGE_INCOMPLETE","CEDEX_DAMAGE_INVALID_RESPONSE"].includes(e?.code)&&e.result){
      renderDamageResult(e.result);
    }else{
      damageSuggestion.textContent=e instanceof Error?e.message:"Unable to analyse damage.";
    }
  }finally{
    setBusy(analyseDamageBtn,false,"Analysing damage…","Analyse IICL damage");
  }
});
damageSelect.addEventListener("change",()=>{confirmDamageBtn.textContent=damageSelect.value===damageAiCode?"Accept "+damageAiCode:"Confirm correction";});
confirmDamageBtn.addEventListener("click",async()=>{
  if(!currentFinding||!damageSelect.value)return;setBusy(confirmDamageBtn,true,"Saving…","Accept damage");
  try{
    const result=await apiJson("/api/cedex/damage-decision",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({findingId:currentFinding.id,finalCode:damageSelect.value})});
    damageDecisionMessage.textContent=result.decision==="APPROVED"?"Damage accepted: "+result.finalCode:"AI corrected from "+(result.aiCode??"none")+" to "+result.finalCode;
    damageSelect.disabled=true;confirmDamageBtn.disabled=true;confirmDamageBtn.textContent="Damage confirmed ✓";
    analyseRepairBtn.hidden=false;
  }catch(e){damageDecisionMessage.textContent=e instanceof Error?e.message:"Unable to save damage decision.";setBusy(confirmDamageBtn,false,"Saving…","Accept damage");}
});


function renderRepairResult(result){
  const failed=["INCOMPLETE","INVALID_RESPONSE"].includes(result.analysisStatus);
  repairAiCode=result.selectedCode??null;
  repairSuggestion.textContent=failed
    ? result.reason
    : result.recommendationMode==="RULES_ONLY_UNTIL_MEASUREMENTS"
      ? "Repair method requires measurement · surveyor selection required"
      : result.selectedCode
        ? result.selectedCode+" · "+(typeof result.confidence==="number"?Math.round(result.confidence*100)+"% model score":"score unavailable")+" · surveyor review required"
        : "No reliable repair method selected · surveyor review required";
  repairCandidates.textContent=result.recommendationMode==="RULES_ONLY_UNTIL_MEASUREMENTS"
    ? "Allowed by GP.xlsx: "+(result.allowedRepairs??[]).map(x=>x.repair_code+" — "+x.repair_name).join(" | ")+" · "+result.reason
    : result.candidates?.length
      ? "Alternatives: "+result.candidates.map(x=>x.code+" "+(typeof x.confidence==="number"?Math.round(x.confidence*100)+"% score":"—")+(x.reason?" · "+x.reason:"")).join(" | ")
      : failed ? "No completed AI repair recommendation is available." : result.reason || "Select a verified repair method manually.";

  repairSelect.innerHTML="";
  const placeholder=document.createElement("option");
  placeholder.value="";placeholder.textContent="Select a repair method…";
  repairSelect.appendChild(placeholder);
  for(const x of (result.allowedRepairs??[])){
    const option=document.createElement("option");
    option.value=x.repair_code;
    option.textContent=x.repair_code+" — "+x.repair_name;
    repairSelect.appendChild(option);
  }
  repairSelect.value=result.selectedCode??"";
  repairLengthCm.value="";
  repairWidthCm.value="";
  repairDepthCm.value="";
  repairCorrugations.value="";
  repairNotes.value="";
  repairSelect.disabled=false;
  repairDecision.hidden=repairSelect.options.length<=1;
  repairDecisionMessage.textContent="";
  confirmRepairBtn.disabled=!repairSelect.value;
  confirmRepairBtn.textContent=repairAiCode&&repairSelect.value===repairAiCode
    ?"Accept "+repairAiCode
    :repairAiCode?"Confirm correction":"Confirm repair method";
}

analyseRepairBtn.addEventListener("click",async()=>{
  if(!currentFinding)return;
  setBusy(analyseRepairBtn,true,"Loading methods…","Load verified repair methods");
  repairReview.hidden=false;
  repairDecision.hidden=true;
  repairSelect.disabled=true;
  confirmRepairBtn.disabled=true;
  repairAiCode=null;
  repairSuggestion.textContent="Loading verified repair methods from GP.xlsx…";
  repairCandidates.textContent="";
  try{
    const result=await apiJson("/api/cedex/repair-suggest",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({findingId:currentFinding.id})});
    renderRepairResult(result);
  }catch(e){
    if(["CEDEX_REPAIR_INCOMPLETE","CEDEX_REPAIR_INVALID_RESPONSE"].includes(e?.code)&&e.result){
      renderRepairResult(e.result);
    }else{
      repairSuggestion.textContent=e instanceof Error?e.message:"Unable to recommend repair method.";
    }
  }finally{
    setBusy(analyseRepairBtn,false,"Loading methods…","Load verified repair methods");
  }
});

repairSelect.addEventListener("change",()=>{
  confirmRepairBtn.disabled=!repairSelect.value;
  confirmRepairBtn.textContent=repairAiCode&&repairSelect.value===repairAiCode
    ?"Accept "+repairAiCode
    :repairAiCode?"Confirm correction":"Confirm repair method";
});

confirmRepairBtn.addEventListener("click",async()=>{
  if(!currentFinding||!repairSelect.value)return;
  setBusy(confirmRepairBtn,true,"Saving…","Confirm repair method");
  try{
    const numberOrNull=value=>value===""?null:Number(value);
    const result=await apiJson("/api/cedex/repair-decision",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({
      findingId:currentFinding.id,
      finalCode:repairSelect.value,
      measurements:{
        damageLengthCm:numberOrNull(repairLengthCm.value),
        damageWidthCm:numberOrNull(repairWidthCm.value),
        damageDepthCm:numberOrNull(repairDepthCm.value),
        corrugationsAffected:repairCorrugations.value===""?null:Number(repairCorrugations.value),
        notes:repairNotes.value.trim()||null
      }
    })});
    repairDecisionMessage.textContent="Repair method confirmed: "+result.finalCode+(result.measurementCaptured?" · measurements saved":"");
    repairSelect.disabled=true;
    confirmRepairBtn.disabled=true;
    confirmRepairBtn.textContent="Repair method confirmed ✓";
    analyseRepairBtn.disabled=true;
  }catch(e){
    repairDecisionMessage.textContent=e instanceof Error?e.message:"Unable to save repair decision.";
    setBusy(confirmRepairBtn,false,"Saving…","Confirm repair method");
  }
});

