import { CedexRepository } from "../infrastructure/d1/cedexRepository";

const MODEL = "@cf/qwen/qwen3.8-27b";
const MAX_COMPLETION_TOKENS = 2000;
type AiRunner = { run(model: string, input: unknown): Promise<unknown> };
type Bucket = { get(key: string): Promise<{ arrayBuffer(): Promise<ArrayBuffer> } | null> };
type AnalysisStatus = "SUGGESTED" | "ABSTAINED" | "INCOMPLETE" | "INVALID_RESPONSE";
type Candidate = { code: string; confidence: number | null; reason: string };

function dataUri(bytes: ArrayBuffer, type: string) {
  let binary = "";
  const data = new Uint8Array(bytes);
  for (let i = 0; i < data.length; i += 0x8000) binary += String.fromCharCode(...data.subarray(i, i + 0x8000));
  return `data:${type || "image/jpeg"};base64,${btoa(binary)}`;
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}

// Only parse final answer content. Never promote unfinished reasoning into a prediction.
function parseJson(raw: unknown): Record<string, unknown> | null {
  const envelope = record(raw);
  const first = Array.isArray(envelope?.choices) ? record(envelope.choices[0]) : null;
  const message = record(first?.message);
  const values = first ? [message?.content] : [raw, envelope?.response, envelope?.result, envelope?.output_text];
  for (const value of values) {
    const object = record(value);
    if (object && Object.hasOwn(object, "selected_code")) return object;
    if (typeof value !== "string") continue;
    const text = value.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
    try {
      const parsed = record(JSON.parse(text));
      if (parsed) return parsed;
    } catch { /* The caller returns an explicit invalid-response outcome. */ }
  }
  return null;
}

function validConfidence(value: unknown): value is number | null {
  return value === null || (typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 100);
}
function confidence(value: number | null): number | null {
  return value === null ? null : value > 1 ? value / 100 : value;
}

export class CedexClassificationService {
  constructor(private readonly repo: CedexRepository, private readonly bucket: Bucket, private readonly ai: AiRunner) {}

  async analyseComponent(findingId: string) {
    const context = await this.repo.findingContext(findingId);
    if (!context) throw new Error("Finding not found.");
    const equipment = await this.repo.equipmentForFinding(findingId);
    const allowed = await this.repo.components(equipment);
    if (!allowed.length) throw new Error("No verified CEDEX component master is loaded for this equipment type.");
    const photo = await this.repo.findingPhoto(findingId, "DAMAGE_CLOSEUP");
    if (!photo) throw new Error("Save the damage close-up photo before AI classification.");
    const object = await this.bucket.get(photo.r2_key);
    if (!object) throw new Error("Damage close-up photo is unavailable.");
    const roi = await this.repo.surveyorDamageBox(findingId, photo.id);
    const image = dataUri(await object.arrayBuffer(), photo.content_type);
    const allowedCodes = [...new Set(allowed.map(x => x.component_code))];
    const allowedSet = new Set(allowedCodes);
    const allowedText = allowed.map(x => `${x.component_code} = ${x.component_name}`).join("\n");
    const prompt = `You are assisting a shipping-container surveyor. Equipment type: ${equipment}. Recorded container face: ${context.container_face}.
Classify ONLY the physical component containing the target damage. Choose ONLY from the allowed component codes. Never invent a code.
${roi ? `The target is the surveyor's damage box on this image, in normalized coordinates from the top-left: x=${roi.x.toFixed(4)}, y=${roi.y.toFixed(4)}, width=${roi.width.toFixed(4)}, height=${roi.height.toFixed(4)}. Identify the component inside this region, using surrounding structure as context. These coordinates are metadata; no box is drawn onto the image.` : "No damage box is available. If the target component is ambiguous, abstain."}
If the target cannot be identified reliably or the recorded face conflicts with the image, return selected_code null and needs_review true.
Allowed codes:
${allowedText}
Return only the final JSON object with selected_code (an allowed code or JSON null), confidence (0 to 1 or null), needs_review (boolean), reason (one short visual sentence), and candidates (at most 3 objects with code, confidence and reason). Do not explain your reasoning outside the JSON.`;
    const raw = await this.ai.run(MODEL, {
      messages: [{ role: "user", content: [{ type: "text", text: prompt }, { type: "image_url", image_url: { url: image } }] }],
      max_completion_tokens: MAX_COMPLETION_TOKENS,
      reasoning_effort: "low",
      temperature: 0,
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "component_classification",
          strict: true,
          schema: {
            type: "object",
            properties: {
              selected_code: { type: ["string", "null"], enum: [...allowedCodes, null] },
              confidence: { type: ["number", "null"], minimum: 0, maximum: 1 },
              needs_review: { type: "boolean" },
              reason: { type: "string" },
              candidates: {
                type: "array", maxItems: 3,
                items: {
                  type: "object",
                  properties: {
                    code: { type: "string", enum: allowedCodes },
                    confidence: { type: ["number", "null"], minimum: 0, maximum: 1 },
                    reason: { type: "string" }
                  },
                  required: ["code", "confidence", "reason"], additionalProperties: false
                }
              }
            },
            required: ["selected_code", "confidence", "needs_review", "reason", "candidates"],
            additionalProperties: false
          }
        }
      }
    });
    const envelope = record(raw);
    const choice = Array.isArray(envelope?.choices) ? record(envelope.choices[0]) : null;
    const finishReason = typeof choice?.finish_reason === "string" ? choice.finish_reason : null;
    const parsed = parseJson(raw);
    let analysisStatus: AnalysisStatus = "INVALID_RESPONSE";
    let selectedCode: string | null = null;
    let selectedConfidence: number | null = null;
    let needsReview = true;
    let reason = "AI returned an unreadable component answer. Retry analysis or select the component manually.";
    let candidates: Candidate[] = [];

    if (finishReason === "length") {
      analysisStatus = "INCOMPLETE";
      reason = "AI response incomplete. Retry analysis or select the component manually.";
    } else if ((!finishReason || finishReason === "stop") && !record(choice?.message)?.refusal && parsed &&
      (parsed.selected_code === null || typeof parsed.selected_code === "string") &&
      validConfidence(parsed.confidence) && typeof parsed.needs_review === "boolean" &&
      typeof parsed.reason === "string" && Array.isArray(parsed.candidates) && parsed.candidates.length <= 3 &&
      parsed.candidates.every(value => {
        const candidate = record(value);
        return candidate && typeof candidate.code === "string" && validConfidence(candidate.confidence) && typeof candidate.reason === "string";
      })) {
      const code = typeof parsed.selected_code === "string" ? parsed.selected_code.trim().toUpperCase() : null;
      if (code === null || allowedSet.has(code)) {
        selectedCode = code;
        selectedConfidence = confidence(parsed.confidence);
        needsReview = parsed.needs_review || !code;
        analysisStatus = code ? "SUGGESTED" : "ABSTAINED";
        reason = parsed.reason.trim() || (code ? "Surveyor confirmation required." : "AI could not identify the target component reliably. Select manually or retry with a clearer photo.");
        for (const value of parsed.candidates) {
          const candidate = value as { code: string; confidence: number | null; reason: string };
          const candidateCode = candidate.code.trim().toUpperCase();
          if (allowedSet.has(candidateCode) && !candidates.some(x => x.code === candidateCode)) {
            candidates.push({ code: candidateCode, confidence: confidence(candidate.confidence), reason: candidate.reason });
          }
        }
        if (code && !candidates.some(x => x.code === code)) candidates.unshift({ code, confidence: selectedConfidence, reason });
        candidates = candidates.slice(0, 3);
      }
    }
    const result = { equipment, analysisStatus, selectedCode, confidence: selectedConfidence, needsReview, reason, candidates,
      allowedComponents: allowed, allowedCount: allowed.length, model: MODEL, roiUsed: Boolean(roi) };
    await this.repo.saveComponentPrediction({
      findingId, surveyId: context.survey_id, modelName: MODEL, selectedCode, confidence: selectedConfidence, candidates,
      response: raw,
      status: analysisStatus === "INCOMPLETE" || analysisStatus === "INVALID_RESPONSE" ? "FAILED" : needsReview ? "REVIEW_REQUIRED" : "SUGGESTED",
      requestContext: { photoId: photo.id, roi, max_completion_tokens: MAX_COMPLETION_TOKENS, reasoning_effort: "low", analysisStatus, finishReason }
    });
    return result;
  }
}
