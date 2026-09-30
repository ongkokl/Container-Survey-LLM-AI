import { createGuidedCamera, estimateFixedFaceAlignment } from "./camera-guidance.js";
import {
  containedImageRect,
  stagePixelToImageNormalized,
  imageNormalizedToStagePixel,
  imageNormalizedBoxToStageRect
} from "./annotation-space.js";

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
const damageMeasurementText=document.querySelector("#damageMeasurementText");
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
const closeupMeasurementReview=document.querySelector("#closeupMeasurementReview");
const closeupMeasurementText=document.querySelector("#closeupMeasurementText");
const closeupMeasurementMeta=document.querySelector("#closeupMeasurementMeta");
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
const overviewDamagePocToggle=document.querySelector("#overviewDamagePocToggle");
const overviewDamagePocReview=document.querySelector("#overviewDamagePocReview");
const overviewDamagePocSuggestion=document.querySelector("#overviewDamagePocSuggestion");
const overviewDamagePocCandidates=document.querySelector("#overviewDamagePocCandidates");
const overviewDamagePocMeta=document.querySelector("#overviewDamagePocMeta");
const overviewDamagePocRetry=document.querySelector("#overviewDamagePocRetry");
const analyseDamageBtn=document.querySelector("#analyseDamageBtn"),damageReview=document.querySelector("#damageReview"),damageSuggestion=document.querySelector("#damageSuggestion"),damageCandidates=document.querySelector("#damageCandidates"),damageDecision=document.querySelector("#damageDecision"),damageSelect=document.querySelector("#damageSelect"),confirmDamageBtn=document.querySelector("#confirmDamageBtn"),damageDecisionMessage=document.querySelector("#damageDecisionMessage");
const analyseRepairBtn=document.querySelector("#analyseRepairBtn"),repairReview=document.querySelector("#repairReview"),repairSuggestion=document.querySelector("#repairSuggestion"),repairCandidates=document.querySelector("#repairCandidates"),repairDecision=document.querySelector("#repairDecision"),repairSelect=document.querySelector("#repairSelect"),confirmRepairBtn=document.querySelector("#confirmRepairBtn"),repairDecisionMessage=document.querySelector("#repairDecisionMessage"),repairLengthCm=document.querySelector("#repairLengthCm"),repairWidthCm=document.querySelector("#repairWidthCm"),repairDepthCm=document.querySelector("#repairDepthCm"),repairDentDirectionWrap=document.querySelector("#repairDentDirectionWrap"),repairDirection=document.querySelector("#repairDirection"),repairDepthCriterion=document.querySelector("#repairDepthCriterion"),repairCorrugations=document.querySelector("#repairCorrugations"),repairNotes=document.querySelector("#repairNotes");
let damageAiCode=null;
let componentAiCode=null;
let repairAiCode=null;
let repairRecommendationGenerated=false,repairRecommendationStale=true,currentRepairContext=null;

let currentSurveyId=null,currentFinding=null,overviewFile=null,closeupFile=null,locationPoint=null,locationArea=null,closeupTargetPoint=null;
let overviewPointerDebug=null,closeupPointerDebug=null;
let aiLocationPoint=null,aiLocationArea=null,aiCloseupTargetPoint=null,aiCloseupDamageBox=null;
let overviewAiRequest=0,closeupAiRequest=0,overviewDamagePocRequest=0,overviewEdited=false,closeupEdited=false;
let overviewMarkMode="AREA",overviewDragStart=null;
let currentGeometry=null,overviewCaptureMeta=null,closeupCaptureMeta=null;
let currentAutoDamageMeasurement=null,currentOverviewDamageMeasurement=null,currentCloseupDamageMeasurement=null;
let currentOverviewDamagePocResult=null;
let locationReferenceBox=null,locationAutoUsable=false,aiLocationCode=null,aiLocalizationSource=null,locationRecalcRequest=0;
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
    currentGeometry=null;currentFixedCalibration=null;overviewCaptureMeta=null;closeupCaptureMeta=null;
    currentAutoDamageMeasurement=null;currentOverviewDamageMeasurement=null;currentCloseupDamageMeasurement=null;
    aiCloseupDamageBox=null;closeupMeasurementReview.hidden=true;closeupMeasurementText.textContent="";closeupMeasurementMeta.textContent="";
    locationReferenceBox=null;locationAutoUsable=false;aiLocationCode=null;aiLocalizationSource=null;locationRecalcRequest++;
    locationReferenceQuad=null;faceMarkMode=false;faceMarkPoints=[];faceMarkResumeMode="AREA";
    locationPoint=null;locationArea=null;aiLocationPoint=null;aiLocationArea=null;overviewEdited=false;overviewMarkMode="AREA";overviewDragStart=null;
    overviewPointerDebug=null;closeupPointerDebug=null;
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
    try{
      currentFixedCalibration=await apiJson(
        "/api/fixed-camera/calibration?findingId="+encodeURIComponent(currentFinding.id)+"&cameraId="+encodeURIComponent(camera.id)
      );
    }catch{
      currentFixedCalibration=null;
    }
    repairReview.hidden=true;analyseRepairBtn.hidden=true;repairAiCode=null;
    repairRecommendationGenerated=false;repairRecommendationStale=true;currentRepairContext=null;
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

function applyPhysicalMeasurement(measurement){
  currentAutoDamageMeasurement=measurement??null;
  if(!measurement){
    currentOverviewDamageMeasurement=null;
    currentCloseupDamageMeasurement=null;
    damageMeasurementText.textContent="";
    return;
  }
  const isCloseup=measurement.source==="CLOSEUP_DAMAGE_BOX_RELATIVE_TO_OVERVIEW_ROI";
  if(isCloseup){
    currentCloseupDamageMeasurement=measurement;
  }else if(measurement.source==="OVERVIEW_DAMAGE_BOX"){
    currentOverviewDamageMeasurement=measurement;
    currentCloseupDamageMeasurement=null;
    if(closeupMeasurementReview&&!closeupMeasurementReview.hidden){
      closeupMeasurementReview.hidden=true;
      closeupMeasurementText.textContent="";
      closeupMeasurementMeta.textContent="";
    }
  }
  const x=(measurement.spanXmm/10).toFixed(1);
  const y=(measurement.spanYmm/10).toFixed(1);
  damageMeasurementText.textContent=
    (isCloseup?"Close-up refined planar estimate: ":"Estimated planar damage size: ")+x+" × "+y+" cm · "+
    String(measurement.xAxis||"X").toLowerCase()+" × "+
    String(measurement.yAxis||"Y").toLowerCase()+
    (isCloseup
      ?" · Moondream close-up extent × calibrated overview ROI · POC only; verify before repair decision."
      :" · fixed-camera geometry · verify before repair decision.");
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
  overviewPointerDebug=null;
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
  currentAutoDamageMeasurement=null;
  damageMeasurementText.textContent="";
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

function fixedAlignmentText(alignment){
  if(!alignment)return "";
  if(alignment.status==="GREEN"){
    return " · Alignment GREEN: container matches the calibrated position.";
  }
  if(alignment.status==="AMBER"){
    return " · Alignment AMBER: small position difference automatically compensated; verify the suggested location.";
  }
  if(alignment.status==="RED"){
    return " · Alignment RED: a container face was detected outside the calibrated tolerance; reposition/retake before automatic location.";
  }
  if(alignment.status==="UNVERIFIED"){
    return " · Alignment UNVERIFIED: face position could not be independently confirmed; stored calibration is used and surveyor confirmation is required.";
  }
  if(alignment.status==="UNAVAILABLE"){
    return " · Alignment unavailable until this camera/geometry profile is calibrated.";
  }
  return "";
}

function renderLocationResult(result){
  locationReferenceBox=result?.referenceBox??null;
  aiLocalizationSource=result?.localizationSource??null;
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
  applyPhysicalMeasurement(location?.physicalMeasurement??null);

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
          " · damage coordinates are mapped through stored physical calibration."+
          (result?.localizationSource==="QWEN_PRIMARY_BOX"
            ?" · Qwen reviewed Moondream candidates and selected the primary physical damage."
            :result?.localizationSource==="QWEN_PRIMARY_OVERRIDE_POINT"
              ?" · Qwen rejected lower-priority candidate marks and relocated the primary physical damage."
              :result?.localizationSource==="POINT_FALLBACK"
                ?" · AI box detector missed; automatic Moondream pinpoint fallback used."
                :result?.localizationSource==="QWEN_POINT_FALLBACK"
                  ?" · Moondream localization missed; Qwen full-overview fallback used."
                  :"")+
          fixedAlignmentText(result?.alignment??location?.alignment)
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
            damagePoint:usingArea?null:locationPoint,
            alignmentReferenceBox:locationReferenceBox
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
    applyPhysicalMeasurement(result?.physicalMeasurement??null);
    if(result?.code){
      locationCodeInput.value=result.code;
      locationSuggestion.textContent=(usingArea?"Marked area":"Marked point")+" location: "+result.code+
        (result.reviewRequired?" · close to a CEDEX zone boundary; verify before saving":"");
      if(fixedCalibratedCamera&&result?.calibration?.available){
        locationGeometryMessage.textContent="Reference: stored fixed Camera "+fixedCamera.id+" calibration · "+result.calibration.lengthFt+" ft · "+result.calibration.heightMm+" mm · version "+result.calibration.calibrationVersion+"."+fixedAlignmentText(result?.alignment);
      }else if(hasFaceQuad){
        locationGeometryMessage.textContent="Reference: surveyor-marked 4-corner perspective · door end at image "+doorEndSide.value.toLowerCase();
      }
    }else{
      locationCodeInput.value="";
      locationSuggestion.textContent=result?.reason||"Unable to calculate a location code from this mark. Enter it manually.";
      if(fixedCalibratedCamera&&result?.alignment){
        locationGeometryMessage.textContent="Reference: stored fixed Camera "+fixedCamera.id+" calibration."+fixedAlignmentText(result.alignment);
      }
    }
  }catch(e){
    if(requestId!==locationRecalcRequest)return;
    applyPhysicalMeasurement(null);
    locationCodeInput.value="";
    locationSuggestion.textContent=e instanceof Error?e.message:"Unable to recalculate location. Enter it manually.";
  }
  if(overviewDamagePocToggle?.checked&&usingArea&&validNormalizedBox(locationArea)){
    void runOverviewDamagePoc(locationArea);
  }
  updateFindingReady();
}

function annotationImageForCanvas(canvas){
  if(canvas===overviewCanvas)return overviewPreview;
  if(canvas===closeupCanvas)return closeupPreview;
  return null;
}

function annotationImageRect(canvas){
  const img=annotationImageForCanvas(canvas);
  return containedImageRect(
    canvas.width,
    canvas.height,
    img?.naturalWidth||canvas.width,
    img?.naturalHeight||canvas.height
  );
}

function annotationStagePoint(canvas,point){
  return imageNormalizedToStagePixel(point,annotationImageRect(canvas))??{
    x:point.x*canvas.width,
    y:point.y*canvas.height
  };
}

function annotationStageBox(canvas,box){
  return imageNormalizedBoxToStageRect(box,annotationImageRect(canvas))??{
    x:box.x*canvas.width,
    y:box.y*canvas.height,
    width:box.width*canvas.width,
    height:box.height*canvas.height
  };
}

function pointerToImageSpace(event,canvas,img){
  const rect=canvas.getBoundingClientRect();
  if(rect.width<=0||rect.height<=0)return {point:null,debug:null};
  const scaleX=canvas.width/rect.width,scaleY=canvas.height/rect.height;
  const stagePixel={
    x:(event.clientX-rect.left)*scaleX,
    y:(event.clientY-rect.top)*scaleY
  };
  const imageRect=containedImageRect(
    canvas.width,
    canvas.height,
    img?.naturalWidth||canvas.width,
    img?.naturalHeight||canvas.height
  );
  const point=stagePixelToImageNormalized(stagePixel,imageRect);
  return {
    point,
    debug:{
      coordinateSpace:"SOURCE_IMAGE_NORMALIZED",
      stagePoint:{
        x:Math.max(0,Math.min(1,(event.clientX-rect.left)/rect.width)),
        y:Math.max(0,Math.min(1,(event.clientY-rect.top)/rect.height))
      },
      imageNormalizedPoint:point,
      imageContentBounds:{
        x:imageRect.x/canvas.width,
        y:imageRect.y/canvas.height,
        width:imageRect.width/canvas.width,
        height:imageRect.height/canvas.height
      },
      canvasSize:{width:canvas.width,height:canvas.height},
      naturalImageSize:{width:img?.naturalWidth||0,height:img?.naturalHeight||0}
    }
  };
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
    const mapped=annotationStagePoint(canvas,point),x=mapped.x,y=mapped.y;
    if(index===0)ctx.moveTo(x,y);else ctx.lineTo(x,y);
  });
  if(complete&&points.length===4)ctx.closePath();
  ctx.stroke();
  ctx.font="700 13px system-ui,sans-serif";
  ctx.textAlign="center";
  ctx.textBaseline="middle";
  points.forEach((point,index)=>{
    const mapped=annotationStagePoint(canvas,point),x=mapped.x,y=mapped.y;
    ctx.beginPath();ctx.arc(x,y,11,0,Math.PI*2);ctx.fill();
    ctx.fillStyle="#08131f";ctx.fillText(String(index+1),x,y);ctx.fillStyle="#9c8cff";
  });
  ctx.restore();
}

function drawDoorEndBox(canvas,box){
  if(!validNormalizedBox(box))return;
  const ctx=canvas.getContext("2d");
  const mapped=annotationStageBox(canvas,box),x=mapped.x,y=mapped.y,w=mapped.width,h=mapped.height;
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
    const mapped=annotationStagePoint(canvas,point),x=mapped.x,y=mapped.y;
    ctx.beginPath();ctx.arc(x,y,10,0,Math.PI*2);ctx.stroke();
    ctx.fillText(labels[index]??String(index+1),x+14,y);
  });
  ctx.restore();
}

function drawDamageAnalysisCallout(canvas,box,result){
  if(!validNormalizedBox(box)||!result?.selectedCode)return;
  const ctx=canvas.getContext("2d");
  if(!ctx)return;
  const mapped=annotationStageBox(canvas,box);
  const confidence=typeof result.confidence==="number"?Math.round(result.confidence*100):null;
  const title=result.selectedCode+(result.selectedName?" · "+result.selectedName:"");
  const componentLabel=result.componentCode
    ?result.componentCode+(result.componentName?" "+result.componentName:"")
    :null;
  const detail=[
    confidence!==null?confidence+"%":null,
    componentLabel,
    result.locationCode||normalizedLocationCode(locationCodeInput.value)||null
  ].filter(Boolean).join(" · ");
  const review=result.needsReview?"Review required":null;

  ctx.save();
  const fontSize=Math.max(11,Math.min(14,Math.round(canvas.width/38)));
  const smallSize=Math.max(10,fontSize-2);
  const pad=Math.max(7,Math.round(fontSize*0.65));
  const radius=Math.max(7,Math.round(fontSize*0.65));
  ctx.font="700 "+fontSize+"px Inter, system-ui, sans-serif";
  const titleWidth=ctx.measureText(title).width;
  ctx.font="600 "+smallSize+"px Inter, system-ui, sans-serif";
  const detailWidth=ctx.measureText(detail).width;
  const reviewWidth=review?ctx.measureText(review).width:0;
  const boxWidth=Math.min(
    Math.max(titleWidth,detailWidth,reviewWidth)+pad*2,
    Math.max(150,canvas.width-16)
  );
  const lineHeight=fontSize+4;
  const boxHeight=review?lineHeight*3+pad*1.5:lineHeight*2+pad*1.5;

  const preferredRight=mapped.x+mapped.width+10;
  const preferredLeft=mapped.x-boxWidth-10;
  let x=preferredRight+boxWidth<=canvas.width-6
    ?preferredRight
    :Math.max(6,preferredLeft);
  x=Math.min(Math.max(6,x),Math.max(6,canvas.width-boxWidth-6));

  const centreY=mapped.y+mapped.height/2;
  let y=centreY-boxHeight/2;
  y=Math.min(Math.max(6,y),Math.max(6,canvas.height-boxHeight-6));

  const attachX=x>mapped.x+mapped.width/2?x:x+boxWidth;
  const damageX=x>mapped.x+mapped.width/2?mapped.x+mapped.width:mapped.x;
  const attachY=Math.min(Math.max(centreY,y+10),y+boxHeight-10);

  ctx.strokeStyle="rgba(110,231,255,.95)";
  ctx.lineWidth=1.5;
  ctx.beginPath();
  ctx.moveTo(damageX,centreY);
  ctx.lineTo(attachX,attachY);
  ctx.stroke();

  ctx.fillStyle="rgba(5,10,18,.90)";
  ctx.strokeStyle="rgba(110,231,255,.95)";
  ctx.lineWidth=1;
  ctx.beginPath();
  if(typeof ctx.roundRect==="function"){
    ctx.roundRect(x,y,boxWidth,boxHeight,radius);
  }else{
    ctx.rect(x,y,boxWidth,boxHeight);
  }
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle="#f4f7fb";
  ctx.font="700 "+fontSize+"px Inter, system-ui, sans-serif";
  ctx.textBaseline="top";
  ctx.fillText(title,x+pad,y+pad,boxWidth-pad*2);

  ctx.fillStyle="#b9c8da";
  ctx.font="600 "+smallSize+"px Inter, system-ui, sans-serif";
  ctx.fillText(detail,x+pad,y+pad+lineHeight,boxWidth-pad*2);

  if(review){
    ctx.fillStyle="#f0c78b";
    ctx.fillText(review,x+pad,y+pad+lineHeight*2,boxWidth-pad*2);
  }
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
  else if(locationPoint)drawPrecisionTarget(overviewCanvas,locationPoint,!overviewEdited,false);
  const visibleLocation=normalizedLocationCode(locationCodeInput.value)||aiLocationCode;
  if(visibleLocation){
    const anchor=overviewMarkMode==="AREA"&&validNormalizedBox(locationArea)
      ?centreOfBox(locationArea)
      :locationPoint;
    if(anchor)drawOverviewLocationLabel(overviewCanvas,anchor,visibleLocation,overviewLocalizationSourceLabel());
  }
  if(overviewDamagePocToggle?.checked&&currentOverviewDamagePocResult?.selectedCode){
    const resultBox=validNormalizedBox(currentOverviewDamagePocResult.damageBox)
      ?currentOverviewDamagePocResult.damageBox
      :validNormalizedBox(locationArea)?locationArea:aiLocationArea;
    drawDamageAnalysisCallout(overviewCanvas,resultBox,currentOverviewDamagePocResult);
  }
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

async function createOverviewDamagePocCrop(file,box){
  if(!file||!validNormalizedBox(box))return null;
  try{
    const source=await compressForOcr(file);
    const bitmap=await createImageBitmap(source);
    const sw=bitmap.width,sh=bitmap.height;
    const padX=Math.max(box.width*0.35,0.025);
    const padY=Math.max(box.height*0.35,0.025);
    const left=Math.max(0,box.x-padX);
    const top=Math.max(0,box.y-padY);
    const right=Math.min(1,box.x+box.width+padX);
    const bottom=Math.min(1,box.y+box.height+padY);
    const sx=Math.round(left*sw),sy=Math.round(top*sh);
    const cropWidth=Math.max(1,Math.round((right-left)*sw));
    const cropHeight=Math.max(1,Math.round((bottom-top)*sh));
    const maxSide=900,longSide=Math.max(cropWidth,cropHeight);
    const scale=Math.min(maxSide/longSide,Math.max(1,640/longSide));
    const outW=Math.max(1,Math.round(cropWidth*scale));
    const outH=Math.max(1,Math.round(cropHeight*scale));
    const canvas=document.createElement("canvas");
    canvas.width=outW;canvas.height=outH;
    const ctx=canvas.getContext("2d");
    if(!ctx){bitmap.close();return null;}
    ctx.drawImage(bitmap,sx,sy,cropWidth,cropHeight,0,0,outW,outH);
    bitmap.close();
    const blob=await new Promise(resolve=>canvas.toBlob(resolve,"image/jpeg",0.94));
    if(!blob)return null;
    return new File([blob],"overview-damage-poc.jpg",{type:"image/jpeg",lastModified:Date.now()});
  }catch{
    return null;
  }
}

function renderOverviewDamagePocResult(result){
  currentOverviewDamagePocResult=result??null;
  overviewDamagePocReview.hidden=false;
  const failed=["INCOMPLETE","INVALID_RESPONSE"].includes(result?.analysisStatus);
  const componentText=result?.componentCode
    ?"Component "+result.componentCode+(result.componentName?" — "+result.componentName:"")+
      (typeof result.componentConfidence==="number"?" · "+Math.round(result.componentConfidence*100)+"%":"")
    :"Component not reliable";
  const damageText=result?.selectedCode
    ?"Damage "+result.selectedCode+(result.selectedName?" — "+result.selectedName:"")+
      (typeof result.confidence==="number"?" · "+Math.round(result.confidence*100)+"%":"")
    :"Damage not classified";
  overviewDamagePocSuggestion.textContent=failed
    ?"Automatic analysis incomplete · "+(result?.componentReason||result?.damageReason||"retry required")
    :componentText+" | "+damageText+(result?.needsReview?" · review required":"");
  const componentCandidates=result?.componentCandidates?.length
    ?"Component candidates: "+result.componentCandidates.map(x=>x.code+" "+(typeof x.confidence==="number"?Math.round(x.confidence*100)+"%":"—")).join(" / ")
    :"";
  const damageCandidates=result?.candidates?.length
    ?"Damage candidates: "+result.candidates.map(x=>x.code+" "+(typeof x.confidence==="number"?Math.round(x.confidence*100)+"%":"—")).join(" / ")
    :"";
  overviewDamagePocCandidates.textContent=[componentCandidates,damageCandidates].filter(Boolean).join(" · ");
  overviewDamagePocMeta.textContent=
    "Location "+(result?.locationCode||locationCodeInput.value||"—")+
    " · one overview photo · AI-detected damage region · no manual box/pinpoint used.";
  overviewDamagePocRetry.hidden=!validNormalizedBox(locationArea??aiLocationArea);
  drawOverviewComposite();
}

async function runOverviewDamagePoc(box=locationArea??aiLocationArea){
  if(!overviewDamagePocToggle?.checked||!currentFinding||!overviewFile||!validNormalizedBox(box))return;
  if(!["LEFT","RIGHT","FRONT"].includes(findingFace.value)){
    overviewDamagePocReview.hidden=false;
    overviewDamagePocSuggestion.textContent="Zero-touch POC currently supports GP side/front views only.";
    overviewDamagePocCandidates.textContent="";
    overviewDamagePocMeta.textContent="";
    overviewDamagePocRetry.hidden=true;
    return;
  }
  const requestId=++overviewDamagePocRequest;
  currentOverviewDamagePocResult=null;
  drawOverviewComposite();
  overviewDamagePocReview.hidden=false;
  overviewDamagePocSuggestion.textContent="Detecting the component and damage from the AI-located overview region…";
  overviewDamagePocCandidates.textContent="";
  overviewDamagePocMeta.textContent="Location comes from the fixed-camera geometry; no manual box or pinpoint is used.";
  overviewDamagePocRetry.hidden=true;
  try{
    const crop=await createOverviewDamagePocCrop(overviewFile,box);
    if(!crop)throw new Error("Unable to create the detected damage crop.");
    const form=new FormData();
    form.append("photo",crop,crop.name);
    form.append("findingId",currentFinding.id);
    form.append("damageBox",JSON.stringify(box));
    form.append("locationCode",normalizedLocationCode(locationCodeInput.value||aiLocationCode||""));
    const result=await apiJson("/api/poc/overview-auto-analyse",{method:"POST",body:form});
    if(requestId!==overviewDamagePocRequest)return;
    renderOverviewDamagePocResult(result);
  }catch(e){
    if(requestId!==overviewDamagePocRequest)return;
    if(["OVERVIEW_AUTO_INCOMPLETE","OVERVIEW_AUTO_INVALID_RESPONSE"].includes(e?.code)&&e.result){
      renderOverviewDamagePocResult(e.result);
    }else{
      currentOverviewDamagePocResult=null;
      drawOverviewComposite();
      overviewDamagePocReview.hidden=false;
      overviewDamagePocSuggestion.textContent=e instanceof Error?e.message:"Zero-touch overview analysis failed.";
      overviewDamagePocCandidates.textContent="";
      overviewDamagePocMeta.textContent="The detected location remains available; component/damage can be reviewed manually.";
      overviewDamagePocRetry.hidden=!validNormalizedBox(box);
    }
  }
}

overviewDamagePocToggle?.addEventListener("change",()=>{
  if(!overviewDamagePocToggle.checked){
    overviewDamagePocRequest++;
    currentOverviewDamagePocResult=null;
    overviewDamagePocReview.hidden=true;
    overviewMarkTools.hidden=!overviewFile;
    tapHelp.hidden=!overviewFile;
    drawOverviewComposite();
    return;
  }
  overviewMarkTools.hidden=true;
  tapHelp.hidden=true;
  const box=validNormalizedBox(locationArea)?locationArea:aiLocationArea;
  if(validNormalizedBox(box))void runOverviewDamagePoc(box);
  else{
    overviewDamagePocReview.hidden=false;
    overviewDamagePocSuggestion.textContent="Upload one overview and let AI locate the damage automatically.";
    overviewDamagePocCandidates.textContent="";
    overviewDamagePocMeta.textContent="No damage box or pinpoint is required from the surveyor.";
    overviewDamagePocRetry.hidden=true;
  }
});
overviewDamagePocRetry?.addEventListener("click",()=>void runOverviewDamagePoc(validNormalizedBox(locationArea)?locationArea:aiLocationArea));

function selectOverviewPhoto(file,source,captureMetadata=null){
  overviewDamagePocRequest++;
  currentOverviewDamagePocResult=null;
  overviewDamagePocReview.hidden=true;
  overviewFile=file??null;
  overviewCaptureMeta=fixedCameraMetadata(captureMetadata??unscoredCaptureMetadata(source,"overview"),"overview");
  resetOverviewLocation();
  const requestId=++overviewAiRequest;
  if(!overviewFile){locationReview.hidden=true;overviewMarkTools.hidden=true;faceReferenceTools.hidden=true;updateFindingReady();return;}
  if(source==="gallery") overviewPhoto.value=""; else overviewGalleryPhoto.value="";
  findingMessage.textContent="Fixed Camera "+(selectedFixedCamera()?.id??"—")+" overview loaded. Face/orientation and perspective come from the stored camera profile/calibration; AI will locate the damage area.";
  showImage(overviewFile,overviewPreview,overviewStage,overviewCanvas,async()=>{
    overviewMarkTools.hidden=Boolean(overviewDamagePocToggle?.checked);
    setOverviewMarkMode("AREA");
    tapHelp.hidden=Boolean(overviewDamagePocToggle?.checked);
    tapHelp.textContent="AI is locating the visible structural damage area…";
    try{
      if(currentFixedCalibration?.available&&Array.isArray(currentFixedCalibration.corners)){
        const edgeAlignment=estimateFixedFaceAlignment(overviewPreview,currentFixedCalibration.corners);
        if(edgeAlignment?.box){
          overviewCaptureMeta={
            ...(overviewCaptureMeta??{}),
            fixedAlignmentReferenceBox:edgeAlignment.box,
            fixedAlignmentConfidence:edgeAlignment.confidence,
            fixedAlignmentSource:edgeAlignment.source
          };
        }
      }
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
        locationPoint=aiLocationPoint?{...aiLocationPoint}:centreOfBox(locationArea);
        overviewMarkMode="AREA";
        markAreaBtn.classList.add("active");markAreaBtn.setAttribute("aria-pressed","true");
        markPointBtn.classList.remove("active");markPointBtn.setAttribute("aria-pressed","false");
        overviewStage.dataset.markMode="AREA";
        drawOverviewComposite();
        tapHelp.textContent="AI proposed this damage area. Drag on the photo to redraw it, or switch to Pinpoint damage for a small defect.";
        if(overviewDamagePocToggle?.checked){
          overviewMarkTools.hidden=true;
          tapHelp.hidden=true;
          void runOverviewDamagePoc(locationArea);
        }
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
        overviewMarkTools.hidden=false;
        tapHelp.hidden=false;
        tapHelp.textContent="AI could not identify the damage area. Manual marking is available only as a fallback.";
        if(overviewDamagePocToggle?.checked){
          overviewDamagePocReview.hidden=false;
          overviewDamagePocSuggestion.textContent="Automatic damage localization completed but no reliable damage target was found.";
          overviewDamagePocCandidates.textContent="";
          overviewDamagePocMeta.textContent=result?.location?.reason||"Moondream and Qwen localization could not find a reliable damage target.";
          overviewDamagePocRetry.hidden=true;
        }
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
  const mapped=annotationStagePoint(canvas,point),ctx=canvas.getContext("2d"),x=mapped.x,y=mapped.y,r=14;
  if(clear)ctx.clearRect(0,0,canvas.width,canvas.height);
  ctx.lineWidth=5;ctx.strokeStyle=isAi?"#ffd54a":"#6ee7ff";ctx.fillStyle=isAi?"#ffd54a":"#6ee7ff";
  ctx.beginPath();ctx.arc(x,y,r,0,Math.PI*2);ctx.stroke();
  ctx.beginPath();ctx.moveTo(x-r-10,y);ctx.lineTo(x+r+10,y);ctx.moveTo(x,y-r-10);ctx.lineTo(x,y+r+10);ctx.stroke();
  ctx.beginPath();ctx.arc(x,y,4,0,Math.PI*2);ctx.fill();
}

const PRECISION_MARK_STROKE_WIDTH=1.5;

function drawPrecisionTarget(canvas,point,isAi=false,clear=true){
  const mapped=annotationStagePoint(canvas,point),ctx=canvas.getContext("2d"),x=mapped.x,y=mapped.y;
  if(clear)ctx.clearRect(0,0,canvas.width,canvas.height);
  const color=isAi?"#ffd54a":"#6ee7ff",gap=7,arm=18;
  ctx.save();
  ctx.lineWidth=PRECISION_MARK_STROKE_WIDTH;
  ctx.strokeStyle=color;
  ctx.fillStyle=color;
  ctx.shadowColor="rgba(0,0,0,.9)";
  ctx.shadowBlur=2;
  ctx.beginPath();
  ctx.moveTo(x-arm,y);ctx.lineTo(x-gap,y);
  ctx.moveTo(x+gap,y);ctx.lineTo(x+arm,y);
  ctx.moveTo(x,y-arm);ctx.lineTo(x,y-gap);
  ctx.moveTo(x,y+gap);ctx.lineTo(x,y+arm);
  ctx.stroke();
  ctx.shadowBlur=0;
  ctx.beginPath();ctx.arc(x,y,1.75,0,Math.PI*2);ctx.fill();
  ctx.restore();
}
function drawBox(canvas,box,isAi=false,clear=true){
  const ctx=canvas.getContext("2d");if(clear)ctx.clearRect(0,0,canvas.width,canvas.height);
  ctx.save();
  ctx.lineWidth=PRECISION_MARK_STROKE_WIDTH;ctx.strokeStyle=isAi?"#ffd54a":"#6ee7ff";
  ctx.shadowColor="rgba(0,0,0,.9)";ctx.shadowBlur=2;
  const mapped=annotationStageBox(canvas,box);
  ctx.strokeRect(mapped.x,mapped.y,mapped.width,mapped.height);
  ctx.restore();
}

function overviewLocalizationSourceLabel(){
  if(overviewEdited)return "Manual";
  if(["QWEN_PRIMARY_BOX","QWEN_PRIMARY_OVERRIDE_POINT","QWEN_POINT_FALLBACK"].includes(aiLocalizationSource))return "AI · Qwen";
  if(["DETECT_BOX","POINT_FALLBACK"].includes(aiLocalizationSource))return "AI · Moondream";
  return "AI";
}

function drawOverviewLocationLabel(canvas,anchor,locationCode,source){
  if(!anchor||!locationCode)return;
  const ctx=canvas.getContext("2d");
  if(!ctx)return;
  const mapped=annotationStagePoint(canvas,anchor);
  const label=[source,locationCode].filter(Boolean).join(" · ");
  const fontSize=Math.max(11,Math.min(14,Math.round(canvas.width/38)));
  const padX=8,padY=5;
  ctx.save();
  ctx.font="700 "+fontSize+"px Inter, system-ui, sans-serif";
  const width=ctx.measureText(label).width+padX*2;
  const height=fontSize+padY*2;
  let x=mapped.x+12,y=mapped.y-height-12;
  if(x+width>canvas.width-5)x=Math.max(5,mapped.x-width-12);
  if(y<5)y=Math.min(canvas.height-height-5,mapped.y+12);
  ctx.fillStyle="rgba(5,10,18,.90)";
  ctx.strokeStyle=source==="Manual"?"#6ee7ff":"#ffd54a";
  ctx.lineWidth=1;
  ctx.beginPath();
  if(typeof ctx.roundRect==="function")ctx.roundRect(x,y,width,height,6);
  else ctx.rect(x,y,width,height);
  ctx.fill();ctx.stroke();
  ctx.fillStyle="#f4f7fb";
  ctx.textBaseline="top";
  ctx.fillText(label,x+padX,y+padY);
  ctx.restore();
}
function drawCloseupComposite(){
  if(closeupStage.hidden||!closeupPreview.complete)return;
  syncAnnotationCanvas(closeupPreview,closeupCanvas);
  const ctx=closeupCanvas.getContext("2d");
  ctx.clearRect(0,0,closeupCanvas.width,closeupCanvas.height);
  if(validNormalizedBox(aiCloseupDamageBox))drawBox(closeupCanvas,aiCloseupDamageBox,true,false);
  if(closeupTargetPoint)drawPrecisionTarget(closeupCanvas,closeupTargetPoint,!closeupEdited,false);
}
function syncAnnotationCanvas(img,canvas){
  const rect=img.getBoundingClientRect(),width=Math.max(1,Math.round(rect.width)),height=Math.max(1,Math.round(rect.height));
  if(canvas.width!==width||canvas.height!==height){canvas.width=width;canvas.height=height;}
}
function redrawAnnotations(){
  if(!overviewStage.hidden&&overviewPreview.complete)drawOverviewComposite();
  if(!closeupStage.hidden&&closeupPreview.complete)drawCloseupComposite();
}
window.addEventListener("resize",()=>requestAnimationFrame(redrawAnnotations));
document.addEventListener("visibilitychange",()=>{if(!document.hidden)requestAnimationFrame(redrawAnnotations);});

function overviewPointer(event){
  const mapped=pointerToImageSpace(event,overviewCanvas,overviewPreview);
  overviewPointerDebug=mapped.debug;
  return mapped.point;
}

overviewCanvas.addEventListener("pointerdown",(event)=>{
  const point=overviewPointer(event);
  if(!point){
    if(endStructureMarkMode)endStructureHelp.textContent="Tap inside the visible photo, not the black margin.";
    else if(faceMarkMode)faceMarkHelp.textContent="Tap inside the visible photo, not the black margin.";
    else tapHelp.textContent="Tap inside the visible photo, not the black margin.";
    return;
  }
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
  if(!end)return;
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
  if(!end){
    overviewDragStart=null;
    if(overviewCanvas.hasPointerCapture(event.pointerId))overviewCanvas.releasePointerCapture(event.pointerId);
    tapHelp.textContent="Finish the damage box inside the visible photo.";
    redrawAnnotations();
    return;
  }
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

function selectCloseupPhoto(file,source,captureMetadata=null){
  closeupFile=file??null;
  closeupTargetPoint=null;
  aiCloseupTargetPoint=null;
  aiCloseupDamageBox=null;
  currentCloseupDamageMeasurement=null;
  closeupEdited=false;
  closeupPointerDebug=null;
  closeupMeasurementReview.hidden=true;
  closeupMeasurementText.textContent="";
  closeupMeasurementMeta.textContent="";
  closeupCaptureMeta=fixedCameraMetadata(captureMetadata??unscoredCaptureMetadata(source,"closeup"),"closeup");
  const requestId=++closeupAiRequest;
  if(!closeupFile)return;
  if(source==="gallery") closeupPhoto.value=""; else closeupGalleryPhoto.value="";
  findingMessage.textContent="Optical-zoom close-up loaded from fixed Camera "+(selectedFixedCamera()?.id??"—")+". AI will detect the damage extent and component target.";
  showImage(closeupFile,closeupPreview,closeupStage,closeupCanvas,async()=>{
    boxHelp.hidden=false;
    boxHelp.textContent="AI is detecting close-up damage extent and pinpointing the component target…";
    try{
      const upload=await compressForOcr(closeupFile);
      const makeForm=mode=>{
        const form=new FormData();
        form.append("photo",upload,upload.name||"closeup.jpg");
        form.append("mode",mode);
        return form;
      };
      const [pointResult,boxResult]=await Promise.all([
        apiJson("/api/vision/mark-damage",{method:"POST",body:makeForm("point")}).catch(()=>null),
        apiJson("/api/vision/mark-damage",{method:"POST",body:makeForm("box")}).catch(()=>null)
      ]);
      if(requestId!==closeupAiRequest)return;

      if(boxResult?.found&&validNormalizedBox(boxResult.geometry)){
        aiCloseupDamageBox={...boxResult.geometry};
      }
      if(pointResult?.found&&pointResult.geometry){
        aiCloseupTargetPoint={...pointResult.geometry};
        closeupTargetPoint={...pointResult.geometry};
      }
      drawCloseupComposite();

      if(aiCloseupDamageBox&&currentOverviewDamageMeasurement&&validNormalizedBox(locationArea)){
        closeupMeasurementReview.hidden=false;
        closeupMeasurementText.textContent="Calculating close-up refined length/width…";
        closeupMeasurementMeta.textContent="POC assumption: the optical-zoom frame represents the same physical damage ROI as the calibrated overview.";
        try{
          const camera=selectedFixedCamera();
          const measured=await apiJson("/api/poc/closeup-damage-measurement",{
            method:"POST",
            headers:{"Content-Type":"application/json"},
            body:JSON.stringify({
              findingId:currentFinding.id,
              cameraId:camera?.id??"",
              overviewDamageBox:locationArea,
              closeupDamageBox:aiCloseupDamageBox,
              alignmentReferenceBox:locationReferenceBox
            })
          });
          if(requestId!==closeupAiRequest)return;
          const measurement=measured?.measurement??null;
          if(measurement){
            applyPhysicalMeasurement(measurement);
            const x=(measurement.spanXmm/10).toFixed(1);
            const y=(measurement.spanYmm/10).toFixed(1);
            closeupMeasurementText.textContent="AI close-up estimate: "+x+" × "+y+" cm · surveyor verification required.";
            const quality=measurement.quality?.reason?" "+measurement.quality.reason:"";
            closeupMeasurementMeta.textContent=
              "Detected close-up coverage: "+(measurement.closeupCoverage?.widthPct??"—")+"% × "+
              (measurement.closeupCoverage?.heightPct??"—")+"% of the overview ROI. "+
              "Depth is not estimated."+quality;
            if(closeupCaptureMeta){
              closeupCaptureMeta.damageMeasurementPoc={
                source:measurement.source,
                method:measurement.method,
                closeupDamageBox:{...aiCloseupDamageBox},
                spanXmm:measurement.spanXmm,
                spanYmm:measurement.spanYmm,
                majorCm:measurement.majorCm,
                minorCm:measurement.minorCm,
                framingAssumption:measurement.framingAssumption,
                requiresSurveyorVerification:true
              };
            }
          }
        }catch(e){
          if(requestId!==closeupAiRequest)return;
          closeupMeasurementText.textContent=e instanceof Error?e.message:"Close-up physical measurement unavailable.";
          closeupMeasurementMeta.textContent="The AI damage box is still shown. Use the overview estimate or manual measurement for repair decisions.";
        }
      }else if(aiCloseupDamageBox){
        closeupMeasurementReview.hidden=false;
        closeupMeasurementText.textContent="AI detected the close-up damage extent, but physical cm refinement is unavailable.";
        closeupMeasurementMeta.textContent=currentOverviewDamageMeasurement
          ?"Draw/confirm a real overview damage area before using close-up measurement."
          :"A calibrated overview DAMAGE BOX measurement is required. Point-only localization cannot be used as a physical size reference.";
      }

      if(closeupTargetPoint&&aiCloseupDamageBox){
        boxHelp.textContent="AI marked the damage extent and component target. Tap only if the component target needs correction.";
      }else if(closeupTargetPoint){
        boxHelp.textContent="AI pinpointed the component target, but could not determine a reliable damage extent.";
      }else if(aiCloseupDamageBox){
        boxHelp.textContent="AI detected the damage extent. Tap the exact damaged component to set the component target.";
      }else{
        boxHelp.textContent="AI could not locate the close-up target reliably. Tap the damaged component; length/width remains manual.";
      }
    }catch{
      boxHelp.textContent="AI marking unavailable. Tap the damaged component.";
    }
    updateFindingReady();
  });
}
closeupPhoto.addEventListener("change",()=>selectCloseupPhoto(closeupPhoto.files?.[0]??null,"system_camera"));
closeupGalleryPhoto.addEventListener("change",()=>selectCloseupPhoto(closeupGalleryPhoto.files?.[0]??null,"gallery"));

closeupCanvas.addEventListener("pointerdown",(event)=>{
  const mapped=pointerToImageSpace(event,closeupCanvas,closeupPreview);
  closeupPointerDebug=mapped.debug;
  if(!mapped.point){
    boxHelp.textContent="Tap inside the visible close-up photo, not the black margin.";
    return;
  }
  closeupEdited=true;
  closeupTargetPoint=mapped.point;
  drawCloseupComposite();
  boxHelp.textContent="Component target pinpoint confirmed. The AI damage-extent box remains unchanged.";
  updateFindingReady();
});

function updateFindingReady(){
  const code=normalizedLocationCode(locationCodeInput.value);
  const locationValid=validLocationCode();
  const overviewMarkReady=overviewMarkMode==="AREA"?validNormalizedBox(locationArea):Boolean(locationPoint);
  if(locationCodeInput.value)locationCodeInput.setAttribute("aria-invalid",locationValid?"false":"true");
  saveFindingBtn.disabled=!(overviewFile&&closeupFile&&overviewMarkReady&&locationPoint&&closeupTargetPoint&&locationValid);
}

async function createComponentTargetCrop(file,point){
  if(!file||!point)return null;
  try{
    const source=await compressForOcr(file);
    const bitmap=await createImageBitmap(source);
    const sourceWidth=bitmap.width,sourceHeight=bitmap.height;
    const minDimension=Math.min(sourceWidth,sourceHeight);
    const targetX=point.x*sourceWidth,targetY=point.y*sourceHeight;

    function cropAroundTarget(side){
      const cropSide=Math.min(minDimension,Math.max(1,side));
      const x=Math.max(0,Math.min(sourceWidth-cropSide,targetX-cropSide/2));
      const y=Math.max(0,Math.min(sourceHeight-cropSide,targetY-cropSide/2));
      return {
        x,y,side:cropSide,
        localX:(targetX-x)/cropSide,
        localY:(targetY-y)/cropSide
      };
    }

    const tight=cropAroundTarget(Math.max(160,Math.min(420,Math.round(minDimension*0.18))));
    const medium=cropAroundTarget(Math.max(300,Math.min(900,Math.round(minDimension*0.42))));
    const panelSize=512,canvas=document.createElement("canvas");
    canvas.width=panelSize*2;canvas.height=panelSize;
    const ctx=canvas.getContext("2d");
    if(!ctx){bitmap.close();return null;}

    function drawPanel(crop,offsetX){
      ctx.drawImage(bitmap,crop.x,crop.y,crop.side,crop.side,offsetX,0,panelSize,panelSize);
      const x=offsetX+crop.localX*panelSize,y=crop.localY*panelSize,gap=8,arm=26;
      ctx.save();
      ctx.lineWidth=1.5;
      ctx.strokeStyle="#6ee7ff";
      ctx.fillStyle="#6ee7ff";
      ctx.shadowColor="rgba(0,0,0,.95)";
      ctx.shadowBlur=2;
      ctx.beginPath();
      ctx.moveTo(x-arm,y);ctx.lineTo(x-gap,y);
      ctx.moveTo(x+gap,y);ctx.lineTo(x+arm,y);
      ctx.moveTo(x,y-arm);ctx.lineTo(x,y-gap);
      ctx.moveTo(x,y+gap);ctx.lineTo(x,y+arm);
      ctx.stroke();
      ctx.shadowBlur=0;
      ctx.beginPath();ctx.arc(x,y,1.5,0,Math.PI*2);ctx.fill();
      ctx.restore();
    }

    drawPanel(tight,0);
    drawPanel(medium,panelSize);
    bitmap.close();

    const normalizedCrop=crop=>({
      x:crop.x/sourceWidth,
      y:crop.y/sourceHeight,
      width:crop.side/sourceWidth,
      height:crop.side/sourceHeight
    });
    const blob=await new Promise(resolve=>canvas.toBlob(resolve,"image/jpeg",0.94));
    if(!blob)return null;
    return {
      file:new File([blob],"component-target-local.jpg",{type:"image/jpeg",lastModified:Date.now()}),
      metadata:{
        version:"component_target_crop_v3",
        source:"DERIVED_FROM_DAMAGE_CLOSEUP",
        targetEvidenceMode:"DUAL_SCALE_LOCAL",
        coordinateSpace:"SOURCE_IMAGE_NORMALIZED",
        targetPoint:{x:point.x,y:point.y},
        pointerMapping:closeupPointerDebug,
        tightCrop:normalizedCrop(tight),
        mediumCrop:normalizedCrop(medium),
        targetPointInTightCrop:{x:tight.localX,y:tight.localY},
        targetPointInMediumCrop:{x:medium.localX,y:medium.localY},
        panelOrder:["TIGHT","MEDIUM"],
        reticle:{style:"FINE_LASER",lineWidthPx:1.5,centreGapPx:8,armLengthPx:26,centreDotPx:1.5},
        output:{width:panelSize*2,height:panelSize}
      }
    };
  }catch{
    return null;
  }
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
    if(overviewCaptureMeta){
      overviewCaptureMeta.annotationCoordinateSpace="SOURCE_IMAGE_NORMALIZED";
      overviewCaptureMeta.pointerMapping=overviewPointerDebug;
    }
    const overview=await uploadFindingPhoto(overviewFile,"FACE_OVERVIEW",overviewPreview,overviewCaptureMeta);
    if(locationReferenceQuad?.length===4) await apiJson("/api/annotations",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({photoId:overview.photoId,annotationType:"CONTAINER_FACE",geometryType:"POLYGON",geometry:{corners:locationReferenceQuad,doorEnd:doorEndSide.value,source:"SURVEYOR_FACE_QUAD"},createdBy:"SURVEYOR"})});
    if(aiLocationArea) await apiJson("/api/annotations",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({photoId:overview.photoId,annotationType:"DAMAGE",geometryType:"BOX",geometry:aiLocationArea,createdBy:"AI"})});
    if(aiLocationPoint) await apiJson("/api/annotations",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({photoId:overview.photoId,annotationType:"LOCATION_POINT",geometryType:"POINT",geometry:aiLocationPoint,createdBy:"AI"})});
    if(overviewMarkMode==="AREA"&&locationArea) await apiJson("/api/annotations",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({photoId:overview.photoId,annotationType:"DAMAGE",geometryType:"BOX",geometry:locationArea,createdBy:"SURVEYOR"})});
    await apiJson("/api/annotations",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({photoId:overview.photoId,annotationType:"LOCATION_POINT",geometryType:"POINT",geometry:locationPoint,createdBy:"SURVEYOR"})});
    if(closeupCaptureMeta){
      closeupCaptureMeta.annotationCoordinateSpace="SOURCE_IMAGE_NORMALIZED";
      closeupCaptureMeta.pointerMapping=closeupPointerDebug;
      closeupCaptureMeta.aiDamageBox=aiCloseupDamageBox?{...aiCloseupDamageBox}:null;
      if(currentCloseupDamageMeasurement){
        closeupCaptureMeta.closeupMeasurement={
          source:currentCloseupDamageMeasurement.source,
          method:currentCloseupDamageMeasurement.method,
          spanXmm:currentCloseupDamageMeasurement.spanXmm,
          spanYmm:currentCloseupDamageMeasurement.spanYmm,
          majorCm:currentCloseupDamageMeasurement.majorCm,
          minorCm:currentCloseupDamageMeasurement.minorCm,
          framingAssumption:currentCloseupDamageMeasurement.framingAssumption,
          requiresSurveyorVerification:true
        };
      }
    }
    const closeup=await uploadFindingPhoto(closeupFile,"DAMAGE_CLOSEUP",closeupPreview,closeupCaptureMeta);
    if(aiCloseupDamageBox) await apiJson("/api/annotations",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({photoId:closeup.photoId,annotationType:"DAMAGE",geometryType:"BOX",geometry:aiCloseupDamageBox,createdBy:"AI"})});
    if(aiCloseupTargetPoint) await apiJson("/api/annotations",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({photoId:closeup.photoId,annotationType:"COMPONENT",geometryType:"POINT",geometry:aiCloseupTargetPoint,createdBy:"AI"})});
    await apiJson("/api/annotations",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({photoId:closeup.photoId,annotationType:"COMPONENT",geometryType:"POINT",geometry:closeupTargetPoint,createdBy:"SURVEYOR"})});
    const componentTarget=await createComponentTargetCrop(closeupFile,closeupTargetPoint);
    if(componentTarget){
      componentTarget.metadata.derivedFromPhotoId=closeup.photoId;
      await uploadFindingPhoto(componentTarget.file,"COMPONENT_CLOSEUP",closeupPreview,componentTarget.metadata);
    }
    const locationDecision=await apiJson("/api/cedex/location-decision",{
      method:"POST",
      headers:{"Content-Type":"application/json"},
      body:JSON.stringify({findingId:currentFinding.id,finalCode:normalizedLocationCode(locationCodeInput.value)})
    });
    findingMessage.textContent="Finding "+currentFinding.finding_sequence+" capture saved · overview + close-up + markings stored · location "+locationDecision.finalCode+".";
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
    prepareRepairReasoning(result.componentCode,result.finalCode);
  }catch(e){damageDecisionMessage.textContent=e instanceof Error?e.message:"Unable to save damage decision.";setBusy(confirmDamageBtn,false,"Saving…","Accept damage");}
});


function dentDepthLimitMm(direction){
  const face=findingFace.value;
  if(direction==="INWARD"&&["LEFT","RIGHT","FRONT"].includes(face))return 35;
  if(direction==="OUTWARD"&&["LEFT","RIGHT"].includes(face))return 30;
  if(direction==="OUTWARD"&&face==="FRONT")return 15;
  return null;
}

function repairMeasurementsPayload(){
  const numberOrNull=value=>value===""?null:Number(value);
  return {
    damageLengthCm:numberOrNull(repairLengthCm.value),
    damageWidthCm:numberOrNull(repairWidthCm.value),
    damageDepthCm:numberOrNull(repairDepthCm.value),
    corrugationsAffected:repairCorrugations.value===""?null:Number(repairCorrugations.value),
    deformationDirection:repairDentDirectionWrap.hidden?"UNKNOWN":repairDirection.value,
    notes:repairNotes.value.trim()||null
  };
}

function updateDentCriterionHint(){
  if(repairDentDirectionWrap.hidden)return;
  const direction=repairDirection.value;
  const depth=repairDepthCm.value===""?null:Number(repairDepthCm.value);
  const limit=dentDepthLimitMm(direction);
  if(depth!==null&&direction==="UNKNOWN"){
    repairDepthCriterion.textContent="Select inward or outward before using a measured dent depth.";
    return;
  }
  if(limit===null){
    repairDepthCriterion.textContent=direction==="UNKNOWN"
      ?"Select a direction when a dent depth is measured."
      :"No mapped dimensional criterion is available for this face/direction.";
    return;
  }
  if(depth===null||!Number.isFinite(depth)){
    repairDepthCriterion.textContent="Dimensional reference: "+limit+" mm. Enter the manually measured depth if available.";
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
  confirmRepairBtn.disabled=!repairSelect.value||missingDirection||repairRecommendationStale;
  if(missingDirection)repairDepthCriterion.textContent="Select inward or outward before using a measured dent depth.";
}

function markRepairRecommendationStale(){
  updateDentCriterionHint();
  if(!repairRecommendationGenerated){
    updateRepairConfirmState();
    return;
  }
  repairRecommendationStale=true;
  repairAiCode=null;
  repairSelect.value="";
  repairDecisionMessage.textContent="Measurements changed. Re-run the repair recommendation before confirming.";
  analyseRepairBtn.textContent="Re-run repair recommendation";
  analyseRepairBtn.disabled=false;
  updateRepairConfirmState();
}

for(const input of [repairLengthCm,repairWidthCm,repairDepthCm,repairCorrugations,repairNotes]){
  input.addEventListener("input",markRepairRecommendationStale);
}
repairDirection.addEventListener("change",markRepairRecommendationStale);

function prepareRepairReasoning(componentCode,damageCode){
  currentRepairContext={componentCode,damageCode};
  repairReview.hidden=false;
  repairDecision.hidden=false;
  repairAiCode=null;
  repairRecommendationGenerated=false;
  repairRecommendationStale=true;

  repairLengthCm.value=currentAutoDamageMeasurement?.majorCm??"";
  repairWidthCm.value=currentAutoDamageMeasurement?.minorCm??"";
  repairDepthCm.value="";
  repairDirection.value="UNKNOWN";
  repairCorrugations.value="";
  repairNotes.value=currentAutoDamageMeasurement
    ?currentAutoDamageMeasurement.source==="CLOSEUP_DAMAGE_BOX_RELATIVE_TO_OVERVIEW_ROI"
      ?"Length/width prefilled from close-up refined POC estimate (AI extent × calibrated overview ROI); surveyor verified/adjusted before recommendation."
      :"Length/width prefilled from fixed-camera plane-projected overview measurement; surveyor verified/adjusted before recommendation."
    :"";

  const mappedDent=componentCode==="PAA"&&damageCode==="DT"&&["LEFT","RIGHT","FRONT"].includes(findingFace.value);
  repairDentDirectionWrap.hidden=!mappedDent;
  repairDepthCriterion.textContent="";
  if(mappedDent)updateDentCriterionHint();

  repairSelect.innerHTML='<option value="">Run recommendation first…</option>';
  repairSelect.disabled=true;
  confirmRepairBtn.disabled=true;
  confirmRepairBtn.textContent="Confirm repair method";
  repairDecisionMessage.textContent="";
  repairSuggestion.textContent=mappedDent
    ?"Verify damage length/width, add depth/corrugations if available, then run the repair recommendation."
    :"Run the verified repair-method recommendation.";
  repairCandidates.textContent="";
  analyseRepairBtn.hidden=false;
  analyseRepairBtn.disabled=false;
  analyseRepairBtn.textContent="Recommend repair method";
}

function renderRepairResult(result){
  const failed=["INCOMPLETE","INVALID_RESPONSE"].includes(result.analysisStatus);
  repairAiCode=result.selectedCode??null;
  repairRecommendationGenerated=!failed;
  repairRecommendationStale=failed;

  repairSuggestion.textContent=failed
    ? result.reason
    : result.selectedCode
      ? result.selectedCode+" · "+(typeof result.confidence==="number"?Math.round(result.confidence*100)+"% reasoning score":"score unavailable")+" · surveyor confirmation required"
      : result.reason || "No reliable repair method selected · surveyor selection required";

  const historyNote=typeof result.historicalCaseCount==="number"
    ?" · comparable confirmed repairs found: "+result.historicalCaseCount
    :"";
  repairCandidates.textContent=result.candidates?.length
    ? "Alternatives: "+result.candidates.map(x=>x.code+" "+(typeof x.confidence==="number"?Math.round(x.confidence*100)+"% score":"—")+(x.reason?" · "+x.reason:"")).join(" | ")+historyNote
    : "Allowed by GP.xlsx: "+(result.allowedRepairs??[]).map(x=>x.repair_code+" — "+x.repair_name).join(" | ")+historyNote;

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
  repairSelect.disabled=false;
  repairDecision.hidden=false;
  repairDecisionMessage.textContent="";
  analyseRepairBtn.textContent="Re-run repair recommendation";
  updateRepairConfirmState();
  confirmRepairBtn.textContent=repairAiCode&&repairSelect.value===repairAiCode
    ?"Accept "+repairAiCode
    :repairAiCode?"Confirm correction":"Confirm repair method";
}

analyseRepairBtn.addEventListener("click",async()=>{
  if(!currentFinding)return;
  const measurements=repairMeasurementsPayload();
  if(currentRepairContext?.componentCode==="PAA"&&currentRepairContext?.damageCode==="DT"){
    if(measurements.damageLengthCm===null||measurements.damageWidthCm===null){
      repairSuggestion.textContent="Damage length and width are required before GP/PAA dent repair reasoning.";
      return;
    }
    if(measurements.damageDepthCm!==null&&measurements.deformationDirection==="UNKNOWN"){
      repairDepthCriterion.textContent="Select inward or outward before using a measured dent depth.";
      return;
    }
  }

  setBusy(analyseRepairBtn,true,"Reasoning…","Recommend repair method");
  repairReview.hidden=false;
  repairDecision.hidden=false;
  repairSelect.disabled=true;
  confirmRepairBtn.disabled=true;
  repairAiCode=null;
  repairSuggestion.textContent="Applying GP.xlsx constraints, measurements and comparable confirmed repair history…";
  repairCandidates.textContent="";
  try{
    const result=await apiJson("/api/cedex/repair-suggest",{
      method:"POST",
      headers:{"Content-Type":"application/json"},
      body:JSON.stringify({findingId:currentFinding.id,measurements})
    });
    renderRepairResult(result);
  }catch(e){
    if(["CEDEX_REPAIR_INCOMPLETE","CEDEX_REPAIR_INVALID_RESPONSE"].includes(e?.code)&&e.result){
      renderRepairResult(e.result);
    }else{
      repairRecommendationStale=true;
      repairSuggestion.textContent=e instanceof Error?e.message:"Unable to recommend repair method.";
    }
  }finally{
    setBusy(analyseRepairBtn,false,"Reasoning…","Recommend repair method");
  }
});

repairSelect.addEventListener("change",()=>{
  updateRepairConfirmState();
  confirmRepairBtn.textContent=repairAiCode&&repairSelect.value===repairAiCode
    ?"Accept "+repairAiCode
    :repairAiCode?"Confirm correction":"Confirm repair method";
});

confirmRepairBtn.addEventListener("click",async()=>{
  if(!currentFinding||!repairSelect.value||repairRecommendationStale)return;
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

