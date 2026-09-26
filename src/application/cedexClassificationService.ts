import { CedexRepository } from "../infrastructure/d1/cedexRepository";

const MODEL = "@cf/qwen/qwen3.8-27b";
const MAX_COMPLETION_TOKENS = 2000;
const COMPONENT_REVIEW_THRESHOLD = 0.8;
type AiRunner = { run(model: string, input: unknown): Promise<unknown> };
type Bucket = { get(key: string): Promise<{ arrayBuffer(): Promise<ArrayBuffer> } | null> };
type AnalysisStatus = "SUGGESTED" | "ABSTAINED" | "INCOMPLETE" | "INVALID_RESPONSE";
type Candidate = { code: string; confidence: number | null; reason: string };
type Point = { x: number; y: number };
type OverviewZone = "TOP_EDGE" | "BOTTOM_EDGE" | "LEFT_EDGE" | "RIGHT_EDGE" | "CENTRAL_FIELD" | "UNKNOWN";

function overviewZone(point: Point | null): OverviewZone {
  if (!point) return "UNKNOWN";
  const edges: Array<[OverviewZone, number]> = [
    ["TOP_EDGE", point.y],
    ["BOTTOM_EDGE", 1 - point.y],
    ["LEFT_EDGE", point.x],
    ["RIGHT_EDGE", 1 - point.x]
  ];
  edges.sort((a, b) => a[1] - b[1]);
  return edges[0][1] <= 0.2 ? edges[0][0] : "CENTRAL_FIELD";
}

function componentVisualGuidance(equipment: "GP" | "RF", face: string, zone: OverviewZone) {
  if (equipment === "GP" && (face === "LEFT" || face === "RIGHT")) {
    return `GP side-wall component guidance:
- PAA (Panel Assembly): the corrugated side-wall sheet/panel field. Dents, scuffs, gouges or deformation that remain in the corrugated wall sheet are PAA.
- RLA (Rail Assembly): a distinct structural rail at a container edge/perimeter. Do NOT call a horizontal dent line, shadow, corrugation ridge/valley, pressed panel profile or repeated corrugation pattern an RLA.
- RDP/RLG: use only when a distinct rail doubling plate or rail gusset is visibly present.
- CPA/CPO/CFG: corner/end structural components, not the ordinary central side-wall sheet.
- VRA: use only when the damaged object is the ventilator itself.
Overview-position prior: ${zone}.${zone === "CENTRAL_FIELD" ? " A central side-wall point strongly favours PAA unless the images clearly show a separate non-panel component at the target." : ""}
The overview-position prior is advisory because camera framing can be oblique or cropped. If the close-up conflicts with it, rely on visible physical structure and set needs_review true when uncertain.`;
  }
  return `Overview-position prior: ${zone}. Treat this as supporting context only; camera framing can be oblique or cropped. Identify the actual physical component visible at the target and set needs_review true if position and visual evidence conflict.`;
}

function hasPositionalConflict(equipment: "GP" | "RF", face: string, zone: OverviewZone, code: string | null) {
  if (!code || equipment !== "GP" || (face !== "LEFT" && face !== "RIGHT") || zone !== "CENTRAL_FIELD") return false;
  return new Set(["RLA", "RDP", "RLG", "CFG", "CPA", "CPO"]).has(code);
}

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
    const allowed = await this.repo.components(equipment, context.container_face);
    if (!allowed.length) throw new Error("No verified CEDEX component master is loaded for this equipment type.");
    const photo = await this.repo.findingPhoto(findingId, "DAMAGE_CLOSEUP");
    if (!photo) throw new Error("Save the damage close-up photo before AI classification.");
    const object = await this.bucket.get(photo.r2_key);
    if (!object) throw new Error("Damage close-up photo is unavailable.");
    const roi = await this.repo.surveyorDamageBox(findingId, photo.id);
    const image = dataUri(await object.arrayBuffer(), photo.content_type);

    const overviewPhoto = await this.repo.findingPhoto(findingId, "FACE_OVERVIEW");
    const overviewPoint = overviewPhoto ? await this.repo.surveyorLocationPoint(findingId, overviewPhoto.id) : null;
    const zone = overviewZone(overviewPoint);
    let overviewImage: string | null = null;
    if (overviewPhoto) {
      const overviewObject = await this.bucket.get(overviewPhoto.r2_key);
      if (overviewObject) overviewImage = dataUri(await overviewObject.arrayBuffer(), overviewPhoto.content_type);
    }
    const allowedCodes = [...new Set(allowed.map(x => x.component_code))];
    const allowedSet = new Set(allowedCodes);
    const allowedText = allowed.map(x => `${x.component_code} = ${x.component_name}`).join("\n");
    const guidance = componentVisualGuidance(equipment, context.container_face, zone);
    const prompt = `You are assisting a shipping-container surveyor. Equipment type: ${equipment}. Recorded container face: ${context.container_face}.
Classify ONLY the physical component containing the target damage. The allowed list has already been restricted to components verified as physically applicable to the recorded container face. Choose ONLY from the allowed component codes. Never invent a code.
${overviewPoint ? `The surveyor's confirmed damage position on the overview image is x=${overviewPoint.x.toFixed(4)}, y=${overviewPoint.y.toFixed(4)} (normalized from top-left). Heuristic overview zone: ${zone}.` : "No confirmed overview position is available."}
${roi ? `The target on the close-up image is the surveyor's damage box in normalized coordinates from the top-left: x=${roi.x.toFixed(4)}, y=${roi.y.toFixed(4)}, width=${roi.width.toFixed(4)}, height=${roi.height.toFixed(4)}. Identify the physical component inside this region, using surrounding structure as context. These coordinates are metadata; no box is drawn onto the image.` : "No damage box is available. If the target component is ambiguous, abstain."}

${guidance}

If the target cannot be identified reliably or the recorded face conflicts with the image, return selected_code null and needs_review true.
Allowed codes:
${allowedText}
Return only the final JSON object with selected_code (an allowed code or JSON null), confidence (0 to 1 or null), needs_review (boolean), reason (one short visual sentence), and candidates (at most 3 objects with code, confidence and reason). Do not explain your reasoning outside the JSON.`;

    const content: Array<Record<string, unknown>> = [{ type: "text", text: prompt }];
    if (overviewImage) {
      content.push(
        { type: "text", text: "Overview image: use this only to understand where the confirmed damage point sits on the recorded container face." },
        { type: "image_url", image_url: { url: overviewImage } }
      );
    }
    content.push(
      { type: "text", text: "Close-up image: classify the physical component that actually contains the marked damage." },
      { type: "image_url", image_url: { url: image } }
    );

    const raw = await this.ai.run(MODEL, {
      messages: [{ role: "user", content }],
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
        const positionalConflict = hasPositionalConflict(equipment, context.container_face, zone, code);
        needsReview =
          parsed.needs_review ||
          !code ||
          selectedConfidence === null ||
          selectedConfidence < COMPONENT_REVIEW_THRESHOLD ||
          positionalConflict;
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
    const positionalConflict = hasPositionalConflict(equipment, context.container_face, zone, selectedCode);
    const result = {
      equipment,
      analysisStatus,
      selectedCode,
      confidence: selectedConfidence,
      needsReview,
      reason,
      candidates,
      allowedComponents: allowed,
      allowedCount: allowed.length,
      model: MODEL,
      roiUsed: Boolean(roi),
      overviewUsed: Boolean(overviewImage && overviewPoint),
      overviewZone: zone,
      positionalConflict
    };
    await this.repo.saveComponentPrediction({
      findingId, surveyId: context.survey_id, modelName: MODEL, selectedCode, confidence: selectedConfidence, candidates,
      response: raw,
      status: analysisStatus === "INCOMPLETE" || analysisStatus === "INVALID_RESPONSE" ? "FAILED" : needsReview ? "REVIEW_REQUIRED" : "SUGGESTED",
      requestContext: {
        photoId: photo.id,
        roi,
        overviewPhotoId: overviewPhoto?.id ?? null,
        overviewPoint,
        overviewUsed: Boolean(overviewImage && overviewPoint),
        overviewZone: zone,
        positionalConflict,
        containerFace: context.container_face,
        allowedComponentCount: allowed.length,
        componentReviewThreshold: COMPONENT_REVIEW_THRESHOLD,
        max_completion_tokens: MAX_COMPLETION_TOKENS,
        reasoning_effort: "low",
        analysisStatus,
        finishReason
      }
    });
    return result;
  }
}
