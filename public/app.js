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

async function imageDimensions(file, fallbackImage) {
  try {
    const bitmap = await createImageBitmap(file);
    const dimensions = { width: bitmap.width, height: bitmap.height };
    bitmap.close();
    return dimensions;
  } catch {
    return {
      width: fallbackImage?.naturalWidth || 0,
      height: fallbackImage?.naturalHeight || 0
    };
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
const findingCamera=document.querySelector("#findingCamera");
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
const overviewMarkTools=document.querySelector("#overviewMarkTools");
const markAreaBtn=document.querySelector("#markAreaBtn");
const markPointBtn=document.querySelector("#markPointBtn");
const tapHelp=document.querySelector("#tapHelp");
const locationReview=document.querySelector("#locationReview");
const locationSuggestion=document.querySelector("#locationSuggestion");
const locationGeometryMessage=document.querySelector("#locationGeometryMessage");
const faceReferenceTools=document.querySelector("#faceReferenceTools");
const faceVerificationStatus=document.querySelector("#faceVerificationStatus");
const correctFaceBtn=document.querySelector("#correctFaceBtn");
const doorDetectionStatus=document.querySelector("#doorDetectionStatus");
const doorEndSide=document.querySelector("#doorEndSide");
const confirmDoorOrientationBtn=document.querySelector("#confirmDoorOrientationBtn");
const markFaceBtn=document.querySelector("#markFaceBtn");
const faceMarkHelp=document.querySelector("#faceMarkHelp");
const markEndStructureBtn=document.querySelector("#markEndStructureBtn");
const endStructureHelp=document.querySelector("#endStructureHelp");
const locationCodeInput=document.querySelector("#locationCodeInput");
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
const analyseRepairBtn=document.querySelector("#analyseRepairBtn"),repairReview=document.querySelector("#repairReview"),repairSuggestion=document.querySelector("#repairSuggestion"),repairCandidates=document.querySelector("#repairCandidates"),repairDecision=document.querySelector("#repairDecision"),repairSelect=document.querySelector("#repairSelect"),confirmRepairBtn=document.querySelector("#confirmRepairBtn"),repairDecisionMessage=document.querySelector("#repairDecisionMessage"),repairLengthCm=document.querySelector("#repairLengthCm"),repairWidthCm=document.querySelector("#repairWidthCm"),repairDepthCm=document.querySelector("#repairDepthCm"),repairDentDirectionWrap=document.querySelector("#repairDentDirectionWrap"),repairDirection=document.querySelector("#repairDirection"),repairDepthCriterion=document.querySelector("#repairDepthCriterion"),repairCorrugations=document.querySelector("#repairCorrugations"),repairNotes=document.querySelector("#repairNotes");
let damageAiCode=null;
let componentAiCode=null;
let repairAiCode=null;

let currentSurveyId=null,currentFinding=null,overviewFile=null,closeupFile=null,locationPoint=null,locationArea=null,damageBox=null;
let aiLocationPoint=null,aiLocationArea=null,aiDamageBox=null;
let overviewAiRequest=0,closeupAiRequest=0,overviewEdited=false,closeupEdited=false;
let overviewMarkMode="AREA",overviewDragStart=null;
let currentGeometry=null,overviewCaptureMeta=null,closeupCaptureMeta=null;
let locationReferenceBox=null,locationAutoUsable=false,aiLocationCode=null,locationRecalcRequest=0;
let locationReferenceQuad=null,faceMarkMode=false,faceMarkPoints=[],faceMarkResumeMode="AREA";
let currentFixedCalibration=null,endStructureMarkMode=false,endStructurePoints=[];
let aiDoorEndBox=null,detectedDoorSide=null,doorOrientationConfirmed=false;
let aiDetectedFace=null,aiFaceConfidence=0;

const FIXED_CAMERA_PROFILES={
  R:{id:"R",label:"Right side camera",face:"RIGHT",doorEnd:"LEFT",zoomMode:"OPTICAL"},
  L:{id:"L",label:"Left side camera",face:"LEFT",doorEnd:"RIGHT",zoomMode:"OPTICAL"},
  D:{id:"D",label:"Door-end camera",face:"DOOR",doorEnd:null,zoomMode:"OPTICAL"},
  F:{id:"F",label:"Front-end camera",face:"FRONT",doorEnd:null,zoomMode:"OPTICAL"},
  T:{id:"T",label:"Roof / top camera",face:"ROOF",doorEnd:"LEFT",zoomMode:"OPTICAL"},
  B:{id:"B",label:"Floor / bottom camera",face:"FLOOR",doorEnd:"LEFT",zoomMode:"OPTICAL"}
};
const fixedCameraDebug=new URLSearchParams(window.location.search).get("debugGeometry")==="1";
function selectedFixedCamera(){
  return FIXED_CAMERA_PROFILES[findingCamera?.value]??null;
}

function isEndFaceCamera(camera=selectedFixedCamera()){
  return Boolean(camera&&["D","F"].includes(camera.id));
}

function updateLocationPlaceholder(){
  const examples={
    RIGHT:"RT5N",LEFT:"LT5N",DOOR:"DH2N",FRONT:"FB3N",ROOF:"TL3N",FLOOR:"BL1N"
  };
  locationCodeInput.placeholder="e.g. "+(examples[findingFace.value]??"RT5N");
}
findingCamera?.addEventListener("change",()=>{
  const camera=selectedFixedCamera();
  findingFace.value=camera?.face??"";
  updateLocationPlaceholder();
  findingMessage.textContent=camera
    ?"Camera "+camera.id+" selected · "+camera.label+" · face "+camera.face+" · optical zoom available."
    :"";
});

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

function fixedCameraMetadata(base,photoType){
  const camera=selectedFixedCamera();
  const overviewRoi=overviewMarkMode==="AREA"&&validNormalizedBox(locationArea)
    ?{type:"BOX",geometry:{...locationArea}}
    :locationPoint
      ?{type:"POINT",geometry:{...locationPoint}}
      :null;
  return {
    ...(base??{}),
    fixedCameraMode:true,
    fixedCameraId:camera?.id??null,
    fixedCameraLabel:camera?.label??null,
    fixedCameraFace:camera?.face??(findingFace.value||null),
    fixedDoorEndInImage:camera?.doorEnd??null,
    zoomMode:photoType==="closeup"?"OPTICAL":"NONE",
    overviewDamageRoi:photoType==="closeup"?overviewRoi:null
  };
}

function unscoredCaptureMetadata(source,photoType){
  return fixedCameraMetadata({
    version:"camera_guidance_v1",
    source,
    photoType,
    containerFace:findingFace.value||null,
    equipmentType:currentGeometry?.equipmentType||containerType.textContent.trim()||null,
    identificationQuality:"UNKNOWN",
    measurementQuality:"UNKNOWN"
  },photoType);
}

function openGuidedCapture(mode){
  const isOverview=mode==="overview";
  const fallbackInput=isOverview?overviewPhoto:closeupPhoto;
  if(!cameraGuidanceV1){fallbackInput.click();return;}
  guidedCamera.open({
    mode,
    face:findingFace.value,
    equipmentType:currentGeometry?.equipmentType||containerType.textContent.trim(),
    geometry:currentGeometry,
    fallbackInput,
    onCapture:async(file,metadata)=>{
      const enriched=fixedCameraMetadata(metadata,isOverview?"overview":"closeup");
      if(isOverview)selectOverviewPhoto(file,"guided",enriched);
      else selectCloseupPhoto(file,"guided",enriched);
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
  const camera=selectedFixedCamera();
  if(!camera){findingMessage.textContent="Select fixed camera R, L, D, F, T or B first.";return;}
  findingFace.value=camera.face;
  setBusy(createFindingBtn,true,"Creating…","Create finding");
  try{
    currentFinding=await apiJson("/api/findings",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({surveyId:currentSurveyId,cameraId:camera.id})});
    findingFace.value=currentFinding.container_face??camera.face;
    findingLabel.textContent="Finding "+currentFinding.finding_sequence+" · Camera "+camera.id+" · "+camera.label+" · "+findingFace.value;
    findingCapture.hidden=false; createFindingBtn.hidden=true; findingCamera.disabled=true;
    findingMessage.textContent="Finding created from fixed Camera "+camera.id+". Capture the overview reference image.";
    geometryReference.hidden=true;
    geometryReferenceText.textContent="";
    currentGeometry=null;overviewCaptureMeta=null;closeupCaptureMeta=null;
    locationReferenceBox=null;locationAutoUsable=false;aiLocationCode=null;locationRecalcRequest++;
    locationReferenceQuad=null;faceMarkMode=false;faceMarkPoints=[];faceMarkResumeMode="AREA";
    locationPoint=null;locationArea=null;aiLocationPoint=null;aiLocationArea=null;overviewEdited=false;overviewMarkMode="AREA";overviewDragStart=null;
    overviewMarkTools.hidden=true;overviewStage.dataset.markMode="AREA";
    markAreaBtn.classList.add("active");markAreaBtn.setAttribute("aria-pressed","true");
    markPointBtn.classList.remove("active");markPointBtn.setAttribute("aria-pressed","false");
    faceReferenceTools.hidden=!fixedCameraDebug;
    faceMarkHelp.textContent="Admin only: calibrate this fixed camera once for the current container length/height profile.";
    faceVerificationStatus.textContent="Fixed camera profile supplies face and orientation; AI face verification is not required.";
    correctFaceBtn.hidden=true;correctFaceBtn.disabled=true;correctFaceBtn.textContent="Correct surveyed face";
    aiDoorEndBox=null;detectedDoorSide=null;doorOrientationConfirmed=true;aiDetectedFace=findingFace.value;aiFaceConfidence=1;
    doorDetectionStatus.textContent="Orientation supplied by fixed Camera "+camera.id+". Calibration is reused for subsequent containers of the same size profile.";
    confirmDoorOrientationBtn.disabled=true;confirmDoorOrientationBtn.textContent="Fixed by camera profile";
    doorEndSide.value=camera.doorEnd??"";
    locationReview.hidden=true;locationCodeInput.value="";locationCodeInput.removeAttribute("aria-invalid");
    locationSuggestion.textContent="Waiting for overview analysis…";locationGeometryMessage.textContent="";
    try{
      const geometry=await apiJson("/api/findings/geometry",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({findingId:currentFinding.id})});
      currentGeometry=geometry;
      if(geometry?.lengthMm&&geometry?.heightMm){
        geometryReferenceText.textContent="Camera "+camera.id+" · "+camera.label+" · "+geometry.isoCode+" · "+geometry.equipmentType+" · "+geometry.lengthMm+" × "+geometry.heightMm+" mm external reference";
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

const LOCATION_CODE_PATTERN=/^[BDEFILMNRTUX][BHLGRTX][0-9NX][0-9NX]$/;

function normalizedLocationCode(value){
  return String(value||"").trim().toUpperCase();
}

function validLocationCode(){
  const code=normalizedLocationCode(locationCodeInput.value);
  if(!LOCATION_CODE_PATTERN.test(code))return false;
  const expectedPrefix={
    LEFT:"L",RIGHT:"R",DOOR:"D",FRONT:"F",ROOF:"T",FLOOR:"B"
  }[findingFace.value];
  if(expectedPrefix&&code[0]!==expectedPrefix)return false;
  return true;
}

function centreOfBox(box){
  return {x:box.x+box.width/2,y:box.y+box.height/2};
}

function validNormalizedBox(box){
  return Boolean(box)&&[box.x,box.y,box.width,box.height].every(Number.isFinite)&&
    box.x>=0&&box.y>=0&&box.width>0&&box.height>0&&box.x+box.width<=1.000001&&box.y+box.height<=1.000001;
}

function setOverviewMarkMode(mode){
  if(faceMarkMode){
    faceMarkMode=false;
    faceMarkPoints=[];
  }
  if(endStructureMarkMode){
    endStructureMarkMode=false;
    endStructurePoints=[];
  }
  overviewMarkMode=mode==="POINT"?"POINT":"AREA";
  overviewStage.dataset.markMode=overviewMarkMode;
  const area=overviewMarkMode==="AREA";
  markAreaBtn.classList.toggle("active",area);
  markAreaBtn.setAttribute("aria-pressed",String(area));
  markPointBtn.classList.toggle("active",!area);
  markPointBtn.setAttribute("aria-pressed",String(!area));
  if(area){
    if(!locationArea&&validNormalizedBox(aiLocationArea))locationArea={...aiLocationArea};
    if(locationArea){
      locationPoint=centreOfBox(locationArea);
      drawOverviewComposite();
      tapHelp.textContent="Damage area selected. Drag on the photo to redraw the full damaged area.";
      recalculateLocationFromMark();
    }else{
      drawOverviewComposite();
      tapHelp.textContent="Drag a box around the full damaged area. Use Pinpoint damage for a small local defect.";
      updateFindingReady();
    }
  }else{
    if(!locationPoint&&locationArea)locationPoint=centreOfBox(locationArea);
    if(locationPoint){
      drawOverviewComposite();
      tapHelp.textContent="Damage point selected. Tap the damaged position to adjust.";
      recalculateLocationFromMark();
    }else{
      drawOverviewComposite();
      tapHelp.textContent="Tap the damaged position.";
      updateFindingReady();
    }
  }
}

markAreaBtn.addEventListener("click",()=>setOverviewMarkMode("AREA"));
markPointBtn.addEventListener("click",()=>setOverviewMarkMode("POINT"));

function resetOverviewLocation(){
  locationReferenceBox=null;
  locationReferenceQuad=null;
  faceReferenceTools.hidden=!fixedCameraDebug;
  faceVerificationStatus.textContent="Fixed camera profile supplies face and orientation.";
  correctFaceBtn.hidden=true;correctFaceBtn.disabled=true;correctFaceBtn.textContent="Correct surveyed face";
  aiDoorEndBox=null;
  detectedDoorSide=null;
  aiDetectedFace=findingFace.value||null;
  aiFaceConfidence=1;
  doorOrientationConfirmed=true;
  const fixedCamera=selectedFixedCamera();
  doorDetectionStatus.textContent=fixedCamera?"Orientation supplied by fixed Camera "+fixedCamera.id+".":"Fixed camera not selected.";
  confirmDoorOrientationBtn.disabled=true;
  confirmDoorOrientationBtn.textContent="Fixed by camera profile";
  doorEndSide.value=fixedCamera?.doorEnd??"";
  faceMarkMode=false;
  faceMarkPoints=[];
  endStructureMarkMode=false;
  endStructurePoints=[];
  currentFixedCalibration=null;
  markEndStructureBtn.hidden=true;
  endStructureHelp.hidden=true;
  locationAutoUsable=false;
  aiLocationCode=null;
  locationPoint=null;
  locationArea=null;
  aiLocationPoint=null;
  aiLocationArea=null;
  overviewEdited=false;
  overviewDragStart=null;
  overviewMarkMode="AREA";
  locationRecalcRequest++;
  locationCodeInput.value="";
  updateLocationPlaceholder();
  locationCodeInput.removeAttribute("aria-invalid");
  locationReview.hidden=false;
  overviewMarkTools.hidden=false;
  overviewStage.dataset.markMode="AREA";
  markAreaBtn.classList.add("active");markAreaBtn.setAttribute("aria-pressed","true");
  markPointBtn.classList.remove("active");markPointBtn.setAttribute("aria-pressed","false");
  locationSuggestion.textContent="Analysing overview for CEDEX location…";
  locationGeometryMessage.textContent="";
}

function renderLocationResult(result){
  locationReferenceBox=result?.referenceBox??null;
  locationAutoUsable=Boolean(result?.autoUsable);
  aiDoorEndBox=null;
  const camera=selectedFixedCamera();
  const calibratedFinding=["LEFT","RIGHT","DOOR","FRONT","ROOF","FLOOR"].includes(findingFace.value);
  aiDetectedFace=findingFace.value||null;
  aiFaceConfidence=1;
  detectedDoorSide=camera?.doorEnd??null;
  doorOrientationConfirmed=true;
  doorEndSide.value=camera?.doorEnd??"";
  faceReferenceTools.hidden=!fixedCameraDebug;
  faceVerificationStatus.textContent=camera
    ?"Fixed Camera "+camera.id+" is the face/orientation source · face "+camera.face+
      (camera.doorEnd?" · door end image "+camera.doorEnd.toLowerCase():"")+"."
    :"Fixed camera profile unavailable.";
  correctFaceBtn.hidden=true;
  correctFaceBtn.disabled=true;
  confirmDoorOrientationBtn.disabled=true;
  confirmDoorOrientationBtn.textContent="Fixed by camera profile";
  doorDetectionStatus.textContent=camera
    ?"No manual door orientation required for Camera "+camera.id+"."
    :"Fixed camera profile unavailable.";

  const calibration=result?.calibration??null;
  currentFixedCalibration=calibration;
  if(fixedCameraDebug){
    const reused=calibration?.reusedAcrossLength
      ?" · reused from "+calibration.calibrationSourceLengthFt+" ft end-face calibration"
      :"";
    faceMarkHelp.textContent=calibratedFinding
      ?calibration?.available
        ?"Calibration loaded: Camera "+camera.id+" · "+calibration.heightMm+" mm · version "+calibration.calibrationVersion+reused+". Recalibrate only if the physical camera/stop position changes."
        :"No stored calibration for Camera "+camera.id+" and this container size. Mark the 4 face corners once to create it."
      :"Fixed-camera calibration is unavailable for this face.";
    markFaceBtn.hidden=!calibratedFinding;
    markFaceBtn.textContent=calibration?.available?"Recalibrate fixed camera":"Calibrate fixed camera with 4 corners";

    const endFace=isEndFaceCamera(camera);
    markEndStructureBtn.hidden=!(endFace&&calibration?.available);
    endStructureHelp.hidden=!(endFace&&calibration?.available);
    if(endFace&&calibration?.available){
      const structure=calibration.endFaceStructure;
      endStructureHelp.textContent=structure?.available
        ?"Physical CEDEX structure loaded · "+structure.equipmentType+" · "+structure.heightMm+" mm · version "+structure.calibrationVersion+". Recalibrate only if the end-frame structural references change."
        :"Stage 2 required: mark the real 1|2, 2|3, 3|4 and H|T, T|B, B|G boundaries. Automatic Door/Front location stays disabled until this is saved.";
      markEndStructureBtn.textContent=structure?.available
        ?"Recalibrate Door/Front CEDEX structure"
        :"Calibrate Door/Front CEDEX structure";
    }
  }

  const location=result?.location??null;
  aiLocationCode=location?.code??null;

  if(aiLocationCode){
    locationCodeInput.value=aiLocationCode;
    locationSuggestion.textContent=
      "Suggested location: "+aiLocationCode+
      (location.reviewRequired?" · surveyor confirmation required":" · geometry check passed");
  }else{
    locationCodeInput.value="";
    locationSuggestion.textContent=location?.reason||"Automatic location unavailable. Enter the CEDEX location manually.";
  }

  const sideOrientation=camera?.doorEnd
    ?" · fixed Camera "+camera.id+" orientation: door end image "+camera.doorEnd.toLowerCase()
    :camera?" · fixed Camera "+camera.id+" face "+camera.face:"";
  if(result?.referenceSource==="FIXED_CAMERA_CALIBRATION"){
    const calibration=result?.calibration??null;
    locationGeometryMessage.textContent=calibration?.available
      ?isEndFaceCamera(camera)&&!calibration.endFaceStructure?.available
        ?"Camera "+(camera?.id??"—")+" perspective calibration is loaded, but physical Door/Front CEDEX structure calibration is still required."
        :"Camera "+(camera?.id??"—")+" calibration loaded · "+calibration.heightMm+" mm · version "+calibration.calibrationVersion+
          " · damage coordinates are mapped through stored physical calibration."
      :"Camera "+(camera?.id??"—")+" face/orientation is known, but no stored calibration exists for this container size."+
        (fixedCameraDebug?" Use Calibrate fixed camera with 4 corners once.":" Admin calibration is required.");
  }else if(result?.referenceSource==="FIXED_CAMERA_PROFILE"){
    locationGeometryMessage.textContent=
      "Fixed Camera "+(camera?.id??"—")+" supplies face "+(camera?.face??findingFace.value)+". Stored calibration is required before automatic CEDEX location.";
  }else if(result?.referenceSource==="GUIDED_FRAME"){
    locationGeometryMessage.textContent=
      "Reference: guided known-geometry frame"+
      (locationAutoUsable?" · suitable for automatic side-location calculation":" · not suitable for automatic location")+
      sideOrientation;
  }else if(result?.referenceSource==="AI_FACE"&&locationReferenceBox){
    const score=typeof result.geometryScore==="number"?Math.round(result.geometryScore*100):null;
    locationGeometryMessage.textContent=
      "Reference: container side face detected from uploaded overview"+
      (score!==null?" · geometry match "+score+"%":"")+
      (locationAutoUsable?"":" · manual location review required")+
      sideOrientation;
  }else if(result?.referenceSource==="AI_FACE"&&!locationReferenceBox){
    locationGeometryMessage.textContent=
      "Fixed Camera "+(camera?.id??"—")+" supplies face/orientation, but usable container geometry was not established from this overview."+
      (fixedCameraDebug?" Use the debug 4-corner calibration if needed.":"");
  }else{
    locationGeometryMessage.textContent=
      "Fixed Camera "+(camera?.id??"—")+" supplies face/orientation; a stored calibration is required for automatic CEDEX location.";
  }
  locationCodeInput.setAttribute("aria-invalid",validLocationCode()?"false":locationCodeInput.value?"true":"false");
}

async function recalculateLocationFromMark(){
  if(!currentFinding)return;
  const usingArea=overviewMarkMode==="AREA";
  if(usingArea&&!validNormalizedBox(locationArea))return;
  if(!usingArea&&!locationPoint)return;
  const hasFaceQuad=Array.isArray(locationReferenceQuad)&&locationReferenceQuad.length===4;
  const fixedCamera=selectedFixedCamera();
  const fixedCalibratedCamera=Boolean(fixedCamera&&["R","L","D","F","T","B"].includes(fixedCamera.id));
  if(!fixedCalibratedCamera&&hasFaceQuad&&!["LEFT","RIGHT"].includes(doorEndSide.value)){
    locationSuggestion.textContent="Fixed camera orientation is unavailable for this debug calculation.";
    updateFindingReady();
    return;
  }
  if(!fixedCalibratedCamera&&!hasFaceQuad&&(!locationReferenceBox||!locationAutoUsable)){
    locationSuggestion.textContent=(usingArea?"Damage area":"Damage point")+" updated. A usable container reference is required for automatic CEDEX location.";
    updateFindingReady();
    return;
  }
  const requestId=++locationRecalcRequest;
  locationSuggestion.textContent="Recalculating CEDEX location from the marked "+(usingArea?"area":"point")+"…";
  try{
    const result=fixedCalibratedCamera
      ? await apiJson("/api/cedex/location-from-fixed-camera",{
          method:"POST",
          headers:{"Content-Type":"application/json"},
          body:JSON.stringify({
            findingId:currentFinding.id,
            cameraId:fixedCamera.id,
            damageBox:usingArea?locationArea:null,
            damagePoint:usingArea?null:locationPoint
          })
        })
      :hasFaceQuad
      ? await apiJson("/api/cedex/location-from-face-quad",{
          method:"POST",
          headers:{"Content-Type":"application/json"},
          body:JSON.stringify({
            findingId:currentFinding.id,
            corners:locationReferenceQuad,
            doorEnd:doorEndSide.value,
            damageBox:usingArea?locationArea:null,
            damagePoint:usingArea?null:locationPoint
          })
        })
      : await apiJson(usingArea?"/api/cedex/location-from-box":"/api/cedex/location-from-point",{
          method:"POST",
          headers:{"Content-Type":"application/json"},
          body:JSON.stringify(usingArea?{
            findingId:currentFinding.id,
            damageBox:locationArea,
            referenceBox:locationReferenceBox
          }:{
            findingId:currentFinding.id,
            point:locationPoint,
            referenceBox:locationReferenceBox
          })
        });
    if(requestId!==locationRecalcRequest)return;
    if(result?.code){
      locationCodeInput.value=result.code;
      locationSuggestion.textContent=(usingArea?"Marked area":"Marked point")+" location: "+result.code+
        (result.reviewRequired?" · close to a CEDEX zone boundary; verify before saving":"");
      if(fixedCalibratedCamera&&result?.calibration?.available){
        locationGeometryMessage.textContent="Reference: stored fixed Camera "+fixedCamera.id+" calibration · "+result.calibration.lengthFt+" ft · "+result.calibration.heightMm+" mm · version "+result.calibration.calibrationVersion+".";
      }else if(hasFaceQuad){
        locationGeometryMessage.textContent="Reference: surveyor-marked 4-corner perspective · door end at image "+doorEndSide.value.toLowerCase();
      }
    }else{
      locationCodeInput.value="";
      locationSuggestion.textContent=result?.reason||"Unable to calculate a location code from this mark. Enter it manually.";
    }
  }catch(e){
    if(requestId!==locationRecalcRequest)return;
    locationCodeInput.value="";
    locationSuggestion.textContent=e instanceof Error?e.message:"Unable to recalculate location. Enter it manually.";
  }
  updateFindingReady();
}

function drawFaceReference(canvas,points,complete=false,clear=false){
  const ctx=canvas.getContext("2d");
  if(clear)ctx.clearRect(0,0,canvas.width,canvas.height);
  if(!points?.length)return;
  ctx.save();
  ctx.lineWidth=4;
  ctx.strokeStyle="#9c8cff";
  ctx.fillStyle="#9c8cff";
  ctx.shadowColor="rgba(0,0,0,.8)";
  ctx.shadowBlur=4;
  ctx.beginPath();
  points.forEach((point,index)=>{
    const x=point.x*canvas.width,y=point.y*canvas.height;
    if(index===0)ctx.moveTo(x,y);else ctx.lineTo(x,y);
  });
  if(complete&&points.length===4)ctx.closePath();
  ctx.stroke();
  ctx.font="700 13px system-ui,sans-serif";
  ctx.textAlign="center";
  ctx.textBaseline="middle";
  points.forEach((point,index)=>{
    const x=point.x*canvas.width,y=point.y*canvas.height;
    ctx.beginPath();ctx.arc(x,y,11,0,Math.PI*2);ctx.fill();
    ctx.fillStyle="#08131f";ctx.fillText(String(index+1),x,y);ctx.fillStyle="#9c8cff";
  });
  ctx.restore();
}

function drawDoorEndBox(canvas,box){
  if(!validNormalizedBox(box))return;
  const ctx=canvas.getContext("2d");
  const x=box.x*canvas.width,y=box.y*canvas.height,w=box.width*canvas.width,h=box.height*canvas.height;
  ctx.save();
  ctx.setLineDash([10,7]);
  ctx.lineWidth=4;
  ctx.strokeStyle="#ff8bd8";
  ctx.fillStyle="#ff8bd8";
  ctx.shadowColor="rgba(0,0,0,.8)";
  ctx.shadowBlur=4;
  ctx.strokeRect(x,y,w,h);
  ctx.setLineDash([]);
  ctx.font="700 12px system-ui,sans-serif";
  ctx.textAlign="left";
  ctx.textBaseline="bottom";
  ctx.fillText("DOOR",x+5,Math.max(14,y-4));
  ctx.restore();
}

function drawEndStructureGuidePoints(canvas,points){
  if(!points?.length)return;
  const labels=["1|2","2|3","3|4","H|T","T|B","B|G"];
  const ctx=canvas.getContext("2d");
  ctx.save();
  ctx.lineWidth=4;
  ctx.strokeStyle="#5eead4";
  ctx.fillStyle="#5eead4";
  ctx.shadowColor="rgba(0,0,0,.8)";
  ctx.shadowBlur=4;
  ctx.font="700 12px system-ui,sans-serif";
  ctx.textAlign="left";
  ctx.textBaseline="middle";
  points.forEach((point,index)=>{
    const x=point.x*canvas.width,y=point.y*canvas.height;
    ctx.beginPath();ctx.arc(x,y,10,0,Math.PI*2);ctx.stroke();
    ctx.fillText(labels[index]??String(index+1),x+14,y);
  });
  ctx.restore();
}

function drawOverviewComposite(){
  if(overviewStage.hidden||!overviewPreview.complete)return;
  syncAnnotationCanvas(overviewPreview,overviewCanvas);
  const ctx=overviewCanvas.getContext("2d");
  ctx.clearRect(0,0,overviewCanvas.width,overviewCanvas.height);
  if(aiDoorEndBox)drawDoorEndBox(overviewCanvas,aiDoorEndBox);
  const quad=faceMarkMode?faceMarkPoints:locationReferenceQuad;
  if(quad?.length)drawFaceReference(overviewCanvas,quad,quad.length===4,false);
  if(endStructureMarkMode&&endStructurePoints.length)drawEndStructureGuidePoints(overviewCanvas,endStructurePoints);
  if(overviewMarkMode==="AREA"&&validNormalizedBox(locationArea))drawBox(overviewCanvas,locationArea,!overviewEdited,false);
  else if(locationPoint)drawTarget(overviewCanvas,locationPoint,!overviewEdited,false);
}

function beginFaceMarking(){
  const camera=selectedFixedCamera();
  if(!camera||!["R","L","D","F","T","B"].includes(camera.id)){
    faceMarkHelp.textContent="Select a fixed camera before calibration.";
    return;
  }
  faceMarkResumeMode=overviewMarkMode;
  faceMarkMode=true;
  faceMarkPoints=[];
  overviewStage.dataset.markMode="FACE";
  locationReferenceQuad=null;
  locationReferenceBox=null;
  locationAutoUsable=false;
  locationCodeInput.value="";
  markFaceBtn.textContent="Restart 4-corner marking";
  faceMarkHelp.textContent="One-time camera calibration: tap 1 top-left, 2 top-right, 3 bottom-right, 4 bottom-left of the complete visible "+findingFace.value.toLowerCase()+" face.";
  drawOverviewComposite();
  updateFindingReady();
}

async function saveFixedCameraCalibration(corners){
  const camera=selectedFixedCamera();
  if(!fixedCameraDebug||!currentFinding||!camera||!["R","L","D","F","T","B"].includes(camera.id))return null;
  const calibration=await apiJson("/api/fixed-camera/calibration",{
    method:"POST",
    headers:{"Content-Type":"application/json"},
    body:JSON.stringify({findingId:currentFinding.id,cameraId:camera.id,corners})
  });
  currentFixedCalibration=calibration;
  faceMarkHelp.textContent="Calibration saved: Camera "+camera.id+" · "+calibration.heightMm+" mm · version "+calibration.calibrationVersion+".";
  markFaceBtn.textContent="Recalibrate fixed camera";
  if(isEndFaceCamera(camera)){
    markEndStructureBtn.hidden=false;
    endStructureHelp.hidden=false;
    endStructureHelp.textContent=calibration.endFaceStructure?.available
      ?"Physical CEDEX structure is already calibrated · version "+calibration.endFaceStructure.calibrationVersion+"."
      :"Stage 2 required: calibrate the physical Door/Front CEDEX structure before automatic location can be used.";
  }
  return calibration;
}

function beginEndStructureMarking(){
  const camera=selectedFixedCamera();
  if(!fixedCameraDebug||!isEndFaceCamera(camera)){
    endStructureHelp.textContent="Physical structure calibration is only used for fixed Cameras D and F.";
    return;
  }
  if(!currentFixedCalibration?.available){
    endStructureHelp.textContent="Complete the four-corner camera calibration first.";
    return;
  }
  faceMarkMode=false;
  faceMarkPoints=[];
  endStructureMarkMode=true;
  endStructurePoints=[];
  overviewStage.dataset.markMode="STRUCTURE";
  const first=camera.id==="F"
    ?"Tap the image-left physical boundary between CEDEX positions 4 and 3 at mid-height."
    :"Tap the physical boundary between CEDEX positions 1 and 2 at mid-height.";
  endStructureHelp.textContent="Stage 2 · 1 of 6: "+first;
  drawOverviewComposite();
  updateFindingReady();
}

async function saveEndStructureCalibration(points){
  const camera=selectedFixedCamera();
  if(!fixedCameraDebug||!currentFinding||!isEndFaceCamera(camera))return null;
  endStructureHelp.textContent="Saving physical Door/Front CEDEX structure calibration…";
  const calibration=await apiJson("/api/fixed-camera/end-structure-calibration",{
    method:"POST",
    headers:{"Content-Type":"application/json"},
    body:JSON.stringify({
      findingId:currentFinding.id,
      cameraId:camera.id,
      positionGuides:points.slice(0,3),
      verticalGuides:points.slice(3,6)
    })
  });
  currentFixedCalibration=calibration;
  const structure=calibration.endFaceStructure;
  endStructureHelp.textContent="Physical CEDEX structure saved · "+structure.equipmentType+" · "+structure.heightMm+" mm · version "+structure.calibrationVersion+".";
  markEndStructureBtn.textContent="Recalibrate Door/Front CEDEX structure";
  return calibration;
}

markFaceBtn.addEventListener("click",beginFaceMarking);
markEndStructureBtn.addEventListener("click",beginEndStructureMarking);

correctFaceBtn.addEventListener("click",()=>{});

confirmDoorOrientationBtn.addEventListener("click",()=>{});

doorEndSide.addEventListener("change",()=>{
  if(!fixedCameraDebug)return;
  if(locationReferenceQuad?.length===4)recalculateLocationFromMark();
});

locationCodeInput.addEventListener("input",()=>{
  const normalized=normalizedLocationCode(locationCodeInput.value).replace(/[^A-Z0-9]/g,"").slice(0,4);
  if(locationCodeInput.value!==normalized)locationCodeInput.value=normalized;
  locationCodeInput.setAttribute("aria-invalid",normalized.length>0&&!validLocationCode()?"true":"false");
  updateFindingReady();
});

function selectOverviewPhoto(file,source,captureMetadata=null){
  overviewFile=file??null;
  overviewCaptureMeta=fixedCameraMetadata(captureMetadata??unscoredCaptureMetadata(source,"overview"),"overview");
  resetOverviewLocation();
  const requestId=++overviewAiRequest;
  if(!overviewFile){locationReview.hidden=true;overviewMarkTools.hidden=true;faceReferenceTools.hidden=true;updateFindingReady();return;}
  if(source==="gallery") overviewPhoto.value=""; else overviewGalleryPhoto.value="";
  findingMessage.textContent="Fixed Camera "+(selectedFixedCamera()?.id??"—")+" overview loaded. Face/orientation and perspective come from the stored camera profile/calibration; AI will locate the damage area.";
  showImage(overviewFile,overviewPreview,overviewStage,overviewCanvas,async()=>{
    overviewMarkTools.hidden=false;
    setOverviewMarkMode("AREA");
    tapHelp.hidden=false;tapHelp.textContent="AI is locating the visible structural damage area…";
    try{
      const upload=await compressForOcr(overviewFile);
      const dimensions=await imageDimensions(upload,overviewPreview);
      const form=new FormData();
      form.append("photo",upload,upload.name||"overview.jpg");
      form.append("findingId",currentFinding.id);
      form.append("width",String(dimensions.width));
      form.append("height",String(dimensions.height));
      form.append("captureMetadata",JSON.stringify(overviewCaptureMeta??{}));
      const result=await apiJson("/api/vision/locate-overview-damage",{method:"POST",body:form});
      if(requestId!==overviewAiRequest)return;
      renderLocationResult(result);
      aiLocationArea=validNormalizedBox(result?.damageBox)?{...result.damageBox}:null;
      aiLocationPoint=result?.point?{...result.point}:aiLocationArea?centreOfBox(aiLocationArea):null;
      drawOverviewComposite();

      if(!overviewEdited&&aiLocationArea){
        locationArea={...aiLocationArea};
        locationPoint=centreOfBox(locationArea);
        overviewMarkMode="AREA";
        markAreaBtn.classList.add("active");markAreaBtn.setAttribute("aria-pressed","true");
        markPointBtn.classList.remove("active");markPointBtn.setAttribute("aria-pressed","false");
        overviewStage.dataset.markMode="AREA";
        drawOverviewComposite();
        tapHelp.textContent="AI proposed this damage area. Drag on the photo to redraw it, or switch to Pinpoint damage for a small defect.";
      }else if(!overviewEdited&&aiLocationPoint){
        locationPoint={...aiLocationPoint};
        overviewMarkMode="POINT";
        markPointBtn.classList.add("active");markPointBtn.setAttribute("aria-pressed","true");
        markAreaBtn.classList.remove("active");markAreaBtn.setAttribute("aria-pressed","false");
        overviewStage.dataset.markMode="POINT";
        drawOverviewComposite();
        tapHelp.textContent="AI proposed this damage point. Tap the photo to correct it, or switch to Draw damage area.";
      }else if(overviewEdited){
        await recalculateLocationFromMark();
      }else{
        drawOverviewComposite();
        tapHelp.textContent="AI could not identify the damage area. Drag a box around the damage, or switch to Pinpoint damage for a small defect.";
      }
    }catch(e){
      if(requestId!==overviewAiRequest)return;
      locationAutoUsable=false;
      locationSuggestion.textContent="Automatic CEDEX location unavailable. Enter the location manually.";
      locationGeometryMessage.textContent=e instanceof Error?e.message:"Overview analysis unavailable.";
      tapHelp.textContent="AI marking unavailable. Draw the damage area or switch to pinpoint.";
    }
    updateFindingReady();
  });
}
overviewPhoto.addEventListener("change",()=>selectOverviewPhoto(overviewPhoto.files?.[0]??null,"system_camera"));
overviewGalleryPhoto.addEventListener("change",()=>selectOverviewPhoto(overviewGalleryPhoto.files?.[0]??null,"gallery"));

function drawTarget(canvas,point,isAi=false,clear=true){
  const ctx=canvas.getContext("2d"),x=point.x*canvas.width,y=point.y*canvas.height,r=14;
  if(clear)ctx.clearRect(0,0,canvas.width,canvas.height);
  ctx.lineWidth=5;ctx.strokeStyle=isAi?"#ffd54a":"#6ee7ff";ctx.fillStyle=isAi?"#ffd54a":"#6ee7ff";
  ctx.beginPath();ctx.arc(x,y,r,0,Math.PI*2);ctx.stroke();
  ctx.beginPath();ctx.moveTo(x-r-10,y);ctx.lineTo(x+r+10,y);ctx.moveTo(x,y-r-10);ctx.lineTo(x,y+r+10);ctx.stroke();
  ctx.beginPath();ctx.arc(x,y,4,0,Math.PI*2);ctx.fill();
}
function drawBox(canvas,box,isAi=false,clear=true){
  const ctx=canvas.getContext("2d");if(clear)ctx.clearRect(0,0,canvas.width,canvas.height);
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
  if(!overviewStage.hidden&&overviewPreview.complete)drawOverviewComposite();
  if(!closeupStage.hidden&&closeupPreview.complete&&damageBox){
    syncAnnotationCanvas(closeupPreview,closeupCanvas);drawBox(closeupCanvas,damageBox,!closeupEdited);
  }
}
window.addEventListener("resize",()=>requestAnimationFrame(redrawAnnotations));
document.addEventListener("visibilitychange",()=>{if(!document.hidden)requestAnimationFrame(redrawAnnotations);});

function overviewPointer(event){
  const rect=overviewCanvas.getBoundingClientRect();
  return {
    x:Math.max(0,Math.min(1,(event.clientX-rect.left)/rect.width)),
    y:Math.max(0,Math.min(1,(event.clientY-rect.top)/rect.height))
  };
}

overviewCanvas.addEventListener("pointerdown",(event)=>{
  const point=overviewPointer(event);
  if(endStructureMarkMode){
    if(endStructurePoints.length>=6)endStructurePoints=[];
    endStructurePoints.push(point);
    const camera=selectedFixedCamera();
    const doorLabels=[
      "boundary 1|2 at mid-height",
      "boundary 2|3 at mid-height",
      "boundary 3|4 at mid-height",
      "H|T boundary near face centre",
      "T|B boundary near face centre",
      "B|G boundary near face centre"
    ];
    const frontLabels=[
      "image-left boundary 4|3 at mid-height",
      "centre boundary 3|2 at mid-height",
      "image-right boundary 2|1 at mid-height",
      "H|T boundary near face centre",
      "T|B boundary near face centre",
      "B|G boundary near face centre"
    ];
    const labels=camera?.id==="F"?frontLabels:doorLabels;
    if(endStructurePoints.length<6){
      endStructureHelp.textContent="Stage 2 · "+(endStructurePoints.length+1)+" of 6: tap "+labels[endStructurePoints.length]+".";
      drawOverviewComposite();
      return;
    }
    endStructureMarkMode=false;
    overviewStage.dataset.markMode=faceMarkResumeMode;
    drawOverviewComposite();
    saveEndStructureCalibration(endStructurePoints.map(p=>({...p}))).then(()=>{
      const hasDamageMark=overviewMarkMode==="AREA"?validNormalizedBox(locationArea):Boolean(locationPoint);
      if(hasDamageMark)recalculateLocationFromMark();
      else updateFindingReady();
    }).catch((e)=>{
      endStructureHelp.textContent=e instanceof Error?e.message:"Unable to save physical CEDEX structure calibration.";
      updateFindingReady();
    });
    return;
  }
  if(faceMarkMode){
    if(faceMarkPoints.length>=4)faceMarkPoints=[];
    faceMarkPoints.push(point);
    const labels=["top-left","top-right","bottom-right","bottom-left"];
    if(faceMarkPoints.length<4){
      faceMarkHelp.textContent="Corner "+faceMarkPoints.length+" marked. Tap "+(faceMarkPoints.length+1)+" "+labels[faceMarkPoints.length]+".";
      drawOverviewComposite();
      return;
    }
    locationReferenceQuad=faceMarkPoints.map(p=>({...p}));
    faceMarkMode=false;
    overviewStage.dataset.markMode=faceMarkResumeMode;
    markFaceBtn.textContent="Remap 4 container-face corners";
    drawOverviewComposite();
    const hasDamageMark=overviewMarkMode==="AREA"?validNormalizedBox(locationArea):Boolean(locationPoint);
    if(fixedCameraDebug&&["R","L","D","F","T","B"].includes(selectedFixedCamera()?.id??"")){
      faceMarkHelp.textContent="Saving fixed-camera calibration…";
      saveFixedCameraCalibration(locationReferenceQuad).then(()=>{
        if(hasDamageMark){
          faceMarkHelp.textContent+=" Recalculating CEDEX location.";
          recalculateLocationFromMark();
        }else{
          faceMarkHelp.textContent+=" Now draw the damage area or select Pinpoint damage.";
          updateFindingReady();
        }
      }).catch((e)=>{
        faceMarkHelp.textContent=e instanceof Error?e.message:"Unable to save fixed-camera calibration.";
        updateFindingReady();
      });
    }else if(hasDamageMark){
      faceMarkHelp.textContent="4-corner perspective reference saved. Recalculating the CEDEX location.";
      recalculateLocationFromMark();
    }else{
      faceMarkHelp.textContent="4-corner perspective reference saved. Now draw the damage area or select Pinpoint damage.";
      updateFindingReady();
    }
    return;
  }
  overviewEdited=true;
  if(overviewMarkMode==="AREA"){
    overviewDragStart=point;
    overviewCanvas.setPointerCapture(event.pointerId);
    return;
  }
  locationPoint=point;
  drawOverviewComposite();
  tapHelp.textContent="Damage position marked. Tap again to adjust.";
  recalculateLocationFromMark();
});

overviewCanvas.addEventListener("pointermove",(event)=>{
  if(faceMarkMode||endStructureMarkMode||overviewMarkMode!=="AREA"||!overviewDragStart||!overviewCanvas.hasPointerCapture(event.pointerId))return;
  const end=overviewPointer(event);
  const preview={
    x:Math.min(overviewDragStart.x,end.x),
    y:Math.min(overviewDragStart.y,end.y),
    width:Math.abs(end.x-overviewDragStart.x),
    height:Math.abs(end.y-overviewDragStart.y)
  };
  if(preview.width>0&&preview.height>0){
    drawOverviewComposite();
    drawBox(overviewCanvas,preview,false,false);
  }
});

overviewCanvas.addEventListener("pointerup",(event)=>{
  if(faceMarkMode||endStructureMarkMode||overviewMarkMode!=="AREA"||!overviewDragStart)return;
  const end=overviewPointer(event);
  const area={
    x:Math.min(overviewDragStart.x,end.x),
    y:Math.min(overviewDragStart.y,end.y),
    width:Math.abs(end.x-overviewDragStart.x),
    height:Math.abs(end.y-overviewDragStart.y)
  };
  overviewDragStart=null;
  if(overviewCanvas.hasPointerCapture(event.pointerId))overviewCanvas.releasePointerCapture(event.pointerId);
  if(area.width<0.01||area.height<0.01){
    tapHelp.textContent="Draw a larger box around the damaged area, or switch to Pinpoint damage.";
    redrawAnnotations();
    return;
  }
  locationArea=area;
  locationPoint=centreOfBox(area);
  drawOverviewComposite();
  tapHelp.textContent="Damage area marked. Drag again to adjust the full damaged extent.";
  recalculateLocationFromMark();
});

overviewCanvas.addEventListener("pointercancel",(event)=>{
  overviewDragStart=null;
  if(overviewCanvas.hasPointerCapture(event.pointerId))overviewCanvas.releasePointerCapture(event.pointerId);
  redrawAnnotations();
});

let dragStart=null;
function selectCloseupPhoto(file,source,captureMetadata=null){
  closeupFile=file??null;damageBox=null;aiDamageBox=null;closeupEdited=false;
  closeupCaptureMeta=fixedCameraMetadata(captureMetadata??unscoredCaptureMetadata(source,"closeup"),"closeup");
  const requestId=++closeupAiRequest;
  if(!closeupFile)return;
  if(source==="gallery") closeupPhoto.value=""; else closeupGalleryPhoto.value="";
  findingMessage.textContent="Optical-zoom close-up loaded from fixed Camera "+(selectedFixedCamera()?.id??"—")+". The overview damage mark remains the CEDEX location reference.";
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

function updateFindingReady(){
  const code=normalizedLocationCode(locationCodeInput.value);
  const locationValid=validLocationCode();
  const overviewMarkReady=overviewMarkMode==="AREA"?validNormalizedBox(locationArea):Boolean(locationPoint);
  if(locationCodeInput.value)locationCodeInput.setAttribute("aria-invalid",locationValid?"false":"true");
  saveFindingBtn.disabled=!(overviewFile&&closeupFile&&overviewMarkReady&&locationPoint&&damageBox&&locationValid);
}

async function uploadFindingPhoto(file,role,img,captureMetadata){
  const upload=await compressForOcr(file),dimensions=await imageDimensions(upload,img),form=new FormData();
  form.append("surveyId",currentSurveyId);form.append("findingId",currentFinding.id);form.append("role",role);
  form.append("width",String(dimensions.width));form.append("height",String(dimensions.height));form.append("photo",upload,upload.name||"photo.jpg");
  if(captureMetadata){
    captureMetadata.storedImage={width:dimensions.width,height:dimensions.height};
    form.append("captureMetadata",JSON.stringify(captureMetadata));
  }
  return apiJson("/api/findings/photo",{method:"POST",body:form});
}

saveFindingBtn.addEventListener("click",async()=>{
  setBusy(saveFindingBtn,true,"Saving…","Save finding evidence");findingMessage.textContent="Uploading finding evidence…";
  try{
    const overview=await uploadFindingPhoto(overviewFile,"FACE_OVERVIEW",overviewPreview,overviewCaptureMeta);
    if(locationReferenceQuad?.length===4) await apiJson("/api/annotations",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({photoId:overview.photoId,annotationType:"CONTAINER_FACE",geometryType:"POLYGON",geometry:{corners:locationReferenceQuad,doorEnd:doorEndSide.value,source:"SURVEYOR_FACE_QUAD"},createdBy:"SURVEYOR"})});
    if(aiLocationArea) await apiJson("/api/annotations",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({photoId:overview.photoId,annotationType:"DAMAGE",geometryType:"BOX",geometry:aiLocationArea,createdBy:"AI"})});
    if(aiLocationPoint) await apiJson("/api/annotations",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({photoId:overview.photoId,annotationType:"LOCATION_POINT",geometryType:"POINT",geometry:aiLocationPoint,createdBy:"AI"})});
    if(overviewMarkMode==="AREA"&&locationArea) await apiJson("/api/annotations",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({photoId:overview.photoId,annotationType:"DAMAGE",geometryType:"BOX",geometry:locationArea,createdBy:"SURVEYOR"})});
    await apiJson("/api/annotations",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({photoId:overview.photoId,annotationType:"LOCATION_POINT",geometryType:"POINT",geometry:locationPoint,createdBy:"SURVEYOR"})});
    const closeup=await uploadFindingPhoto(closeupFile,"DAMAGE_CLOSEUP",closeupPreview,closeupCaptureMeta);
    if(aiDamageBox) await apiJson("/api/annotations",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({photoId:closeup.photoId,annotationType:"DAMAGE",geometryType:"BOX",geometry:aiDamageBox,createdBy:"AI"})});
    await apiJson("/api/annotations",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({photoId:closeup.photoId,annotationType:"DAMAGE",geometryType:"BOX",geometry:damageBox,createdBy:"SURVEYOR"})});
    const locationDecision=await apiJson("/api/cedex/location-decision",{
      method:"POST",
      headers:{"Content-Type":"application/json"},
      body:JSON.stringify({findingId:currentFinding.id,finalCode:normalizedLocationCode(locationCodeInput.value)})
    });
    findingMessage.textContent="Finding "+currentFinding.finding_sequence+" evidence saved · location "+locationDecision.finalCode+".";
    locationSuggestion.textContent=locationDecision.decision==="APPROVED"
      ?"CEDEX location accepted: "+locationDecision.finalCode
      :"CEDEX location confirmed/corrected: "+locationDecision.finalCode;
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


function dentDepthLimitMm(direction){
  const face=findingFace.value;
  if(direction==="INWARD"&&["LEFT","RIGHT","FRONT"].includes(face))return 35;
  if(direction==="OUTWARD"&&["LEFT","RIGHT"].includes(face))return 30;
  if(direction==="OUTWARD"&&face==="FRONT")return 15;
  return null;
}

function updateDentCriterionHint(){
  if(repairDentDirectionWrap.hidden)return;
  const direction=repairDirection.value;
  const depth=repairDepthCm.value===""?null:Number(repairDepthCm.value);
  const limit=dentDepthLimitMm(direction);
  if(depth!==null&&direction==="UNKNOWN"){
    repairDepthCriterion.textContent="Select inward or outward before saving a measured dent depth.";
    return;
  }
  if(limit===null){
    repairDepthCriterion.textContent=direction==="UNKNOWN"
      ?"Select a direction when a dent depth is measured."
      :"No mapped dimensional criterion is available for this face/direction.";
    return;
  }
  if(depth===null||!Number.isFinite(depth)){
    repairDepthCriterion.textContent="Dimensional reference: "+limit+" mm. Enter the manually measured depth to assess it.";
    return;
  }
  const depthMm=depth*10;
  repairDepthCriterion.textContent=depthMm<=limit
    ?"Depth "+depthMm.toFixed(1)+" mm ≤ "+limit+" mm: within this dimensional criterion only."
    :"Depth "+depthMm.toFixed(1)+" mm > "+limit+" mm: exceeds this dimensional criterion.";
}

function updateRepairConfirmState(){
  const depthEntered=repairDepthCm.value!=="";
  const missingDirection=!repairDentDirectionWrap.hidden&&depthEntered&&repairDirection.value==="UNKNOWN";
  confirmRepairBtn.disabled=!repairSelect.value||missingDirection;
  if(missingDirection)repairDepthCriterion.textContent="Select inward or outward before saving a measured dent depth.";
}

repairDirection.addEventListener("change",()=>{updateDentCriterionHint();updateRepairConfirmState();});
repairDepthCm.addEventListener("input",()=>{updateDentCriterionHint();updateRepairConfirmState();});

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
  repairDirection.value="UNKNOWN";
  const mappedDent=result.equipment==="GP"&&result.componentCode==="PAA"&&result.damageCode==="DT"&&["LEFT","RIGHT","FRONT"].includes(findingFace.value);
  repairDentDirectionWrap.hidden=!mappedDent;
  repairDepthCriterion.textContent="";
  if(mappedDent)updateDentCriterionHint();
  repairCorrugations.value="";
  repairNotes.value="";
  repairSelect.disabled=false;
  repairDecision.hidden=repairSelect.options.length<=1;
  repairDecisionMessage.textContent="";
  updateRepairConfirmState();
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
  updateRepairConfirmState();
  confirmRepairBtn.textContent=repairAiCode&&repairSelect.value===repairAiCode
    ?"Accept "+repairAiCode
    :repairAiCode?"Confirm correction":"Confirm repair method";
});

confirmRepairBtn.addEventListener("click",async()=>{
  if(!currentFinding||!repairSelect.value)return;
  if(!repairDentDirectionWrap.hidden&&repairDepthCm.value!==""&&repairDirection.value==="UNKNOWN"){
    repairDepthCriterion.textContent="Select inward or outward before saving a measured dent depth.";
    updateRepairConfirmState();
    return;
  }
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
        deformationDirection:repairDentDirectionWrap.hidden?"UNKNOWN":repairDirection.value,
        notes:repairNotes.value.trim()||null
      }
    })});
    repairDecisionMessage.textContent="Repair method confirmed: "+result.finalCode+(result.measurementCaptured?" · measurements saved":"");
    if(result.iiclDepthAssessment?.applicable){
      const assessment=result.iiclDepthAssessment;
      repairDepthCriterion.textContent=assessment.status==="WITHIN_DIMENSIONAL_CRITERION"
        ?"IICL depth assessment: within this dimensional criterion only; other inspection criteria still apply."
        :assessment.status==="EXCEEDS_DIMENSIONAL_CRITERION"
          ?"IICL depth assessment: measured deformation exceeds the applicable dimensional criterion."
          :"IICL depth assessment not completed because no depth was measured.";
    }
    repairSelect.disabled=true;
    confirmRepairBtn.disabled=true;
    confirmRepairBtn.textContent="Repair method confirmed ✓";
    analyseRepairBtn.disabled=true;
  }catch(e){
    repairDecisionMessage.textContent=e instanceof Error?e.message:"Unable to save repair decision.";
    setBusy(confirmRepairBtn,false,"Saving…","Confirm repair method");
  }
});

