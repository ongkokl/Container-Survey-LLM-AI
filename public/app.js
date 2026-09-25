const input = document.querySelector("#doorPhoto");
const previewWrap = document.querySelector("#previewWrap");
const preview = document.querySelector("#preview");
const retake = document.querySelector("#retake");
const continueBtn = document.querySelector("#continueBtn");
const message = document.querySelector("#message");

let selectedFile = null;
let objectUrl = null;

function clearPreview() {
  selectedFile = null;
  if (objectUrl) URL.revokeObjectURL(objectUrl);
  objectUrl = null;
  preview.removeAttribute("src");
  previewWrap.hidden = true;
  continueBtn.disabled = true;
  input.value = "";
  message.textContent = "";
}

input.addEventListener("change", () => {
  const [file] = input.files ?? [];
  if (!file) return clearPreview();

  selectedFile = file;
  objectUrl = URL.createObjectURL(file);
  preview.src = objectUrl;
  previewWrap.hidden = false;
  continueBtn.disabled = false;
  message.textContent = "Door photo captured. OCR integration is the next POC step.";
});

retake.addEventListener("click", () => {
  clearPreview();
  input.click();
});

continueBtn.addEventListener("click", () => {
  if (!selectedFile) return;
  message.textContent = "Ready for OCR wiring: container number + ISO size/type extraction.";
});
