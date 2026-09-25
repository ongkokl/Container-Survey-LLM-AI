const input = document.querySelector("#doorPhoto");
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

input.addEventListener("change", () => {
  const [file] = input.files ?? [];
  if (!file) return clearPreview();

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
    "Photo ready. The app will optimise it before Vision OCR.";
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
const overviewStage=document.querySelector("#overviewStage");
const overviewPreview=document.querySelector("#overviewPreview");
const overviewCanvas=document.querySelector("#overviewCanvas");
const tapHelp=document.querySelector("#tapHelp");
const closeupPhoto=document.querySelector("#closeupPhoto");
const closeupStage=document.querySelector("#closeupStage");
const closeupPreview=document.querySelector("#closeupPreview");
const closeupCanvas=document.querySelector("#closeupCanvas");
const boxHelp=document.querySelector("#boxHelp");
const saveFindingBtn=document.querySelector("#saveFindingBtn");
const findingMessage=document.querySelector("#findingMessage");

let currentSurveyId=null,currentFinding=null,overviewFile=null,closeupFile=null,locationPoint=null,damageBox=null;

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
  img.onload=()=>{canvas.width=img.clientWidth;canvas.height=img.clientHeight;stage.hidden=false;ready();};
  img.src=url;
}

overviewPhoto.addEventListener("change",()=>{
  overviewFile=overviewPhoto.files?.[0]??null; locationPoint=null;
  if(!overviewFile)return;
  showImage(overviewFile,overviewPreview,overviewStage,overviewCanvas,()=>{tapHelp.hidden=false;});
});

overviewCanvas.addEventListener("pointerdown",(event)=>{
  const rect=overviewCanvas.getBoundingClientRect();
  locationPoint={x:(event.clientX-rect.left)/rect.width,y:(event.clientY-rect.top)/rect.height};
  const ctx=overviewCanvas.getContext("2d");ctx.clearRect(0,0,overviewCanvas.width,overviewCanvas.height);
  ctx.beginPath();ctx.arc(locationPoint.x*overviewCanvas.width,locationPoint.y*overviewCanvas.height,10,0,Math.PI*2);ctx.lineWidth=4;ctx.strokeStyle="#fff";ctx.stroke();
  tapHelp.textContent="Damage position marked. Tap again to adjust.";
  updateFindingReady();
});

let dragStart=null;
closeupPhoto.addEventListener("change",()=>{
  closeupFile=closeupPhoto.files?.[0]??null;damageBox=null;
  if(!closeupFile)return;
  showImage(closeupFile,closeupPreview,closeupStage,closeupCanvas,()=>{boxHelp.hidden=false;});
});

closeupCanvas.addEventListener("pointerdown",(event)=>{
  const r=closeupCanvas.getBoundingClientRect();dragStart={x:(event.clientX-r.left)/r.width,y:(event.clientY-r.top)/r.height};closeupCanvas.setPointerCapture(event.pointerId);
});
closeupCanvas.addEventListener("pointerup",(event)=>{
  if(!dragStart)return;
  const r=closeupCanvas.getBoundingClientRect(),end={x:(event.clientX-r.left)/r.width,y:(event.clientY-r.top)/r.height};
  damageBox={x:Math.min(dragStart.x,end.x),y:Math.min(dragStart.y,end.y),width:Math.abs(end.x-dragStart.x),height:Math.abs(end.y-dragStart.y)};
  dragStart=null;
  const ctx=closeupCanvas.getContext("2d");ctx.clearRect(0,0,closeupCanvas.width,closeupCanvas.height);
  ctx.lineWidth=4;ctx.strokeStyle="#fff";ctx.strokeRect(damageBox.x*closeupCanvas.width,damageBox.y*closeupCanvas.height,damageBox.width*closeupCanvas.width,damageBox.height*closeupCanvas.height);
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
    await apiJson("/api/annotations",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({photoId:overview.photoId,annotationType:"LOCATION_POINT",geometryType:"POINT",geometry:locationPoint})});
    const closeup=await uploadFindingPhoto(closeupFile,"DAMAGE_CLOSEUP",closeupPreview);
    await apiJson("/api/annotations",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({photoId:closeup.photoId,annotationType:"DAMAGE",geometryType:"BOX",geometry:damageBox})});
    findingMessage.textContent="Finding "+currentFinding.finding_sequence+" evidence saved.";
    saveFindingBtn.textContent="Finding saved ✓";saveFindingBtn.disabled=true;
  }catch(e){findingMessage.textContent=e instanceof Error?e.message:"Unable to save finding evidence.";setBusy(saveFindingBtn,false,"Saving…","Save finding evidence");}
});
