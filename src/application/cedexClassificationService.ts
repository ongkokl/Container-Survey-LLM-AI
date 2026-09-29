import { CedexRepository, ComponentVisualRule } from "../infrastructure/d1/cedexRepository";

const MODEL = "@cf/qwen/qwen3.8-27b";
const MAX_COMPLETION_TOKENS = 2000;
const COMPONENT_REVIEW_THRESHOLD = 0.8;
const COMPONENT_FAMILY_MIN_CONFIDENCE = 0.8;
const COMPONENT_FAMILY_MIN_ALLOWED = 12;
const GP_DOOR_FAMILIES = [
  "LOCKING_BAR_SUPPORT",
  "LOCKING_BAR_CAM",
  "LOCKING_BAR_HANDLE",
  "HINGE",
  "GASKET_SEAL",
  "DOOR_PANEL_FRAME",
  "CORNER_POST_RAIL",
  "DOOR_ACCESSORY",
  "UNKNOWN"
] as const;
type GpDoorFamily = typeof GP_DOOR_FAMILIES[number];

const GP_DOOR_FAMILY_CODES: Record<Exclude<GpDoorFamily, "UNKNOWN">, readonly string[]> = {
  LOCKING_BAR_SUPPORT: ["HWH","HWR","LBB","LBG","LBR"],
  LOCKING_BAR_CAM: ["HWH","HWR","LBB","LBC","LBR","RCK"],
  LOCKING_BAR_HANDLE: ["DHC","DHL","DHR","HWH","HWR","LBH","LBL","LBR","LHH"],
  HINGE: ["CPL","HGA","HGB","HGP","HWH","HWR"],
  GASKET_SEAL: ["GRS","GTA"],
  DOOR_PANEL_FRAME: ["DFA","DSB","DSC","DSH","DST","PAA"],
  CORNER_POST_RAIL: ["CFG","CPA","CPI","CPJ","CPL","CPO","HEP","RCG","RCI","RLA","RLG"],
  DOOR_ACCESSORY: ["DHC","DHR","DPL","DRH","DRT","MPD"]
};

const GP_STRUCTURAL_FAMILIES = [
  "CORNER_FITTING",
  "CORNER_POST",
  "PANEL_SURFACE",
  "RAIL_EDGE",
  "FITTED_COMPONENT",
  "UNKNOWN"
] as const;
type GpStructuralFamily = typeof GP_STRUCTURAL_FAMILIES[number];
type ComponentFamily = GpDoorFamily | GpStructuralFamily;

const GP_STRUCTURAL_FAMILY_CODES: Record<Exclude<GpStructuralFamily, "UNKNOWN"|"PANEL_SURFACE"|"FITTED_COMPONENT">, readonly string[]> = {
  CORNER_FITTING: ["CFG"],
  CORNER_POST: ["CPA","CPI","CPJ","CPL","CPO"],
  RAIL_EDGE: ["RLA","RLG","RDP","RCI","HEP","RCG"]
};

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

function formatVisualGuidance(rules: ComponentVisualRule[], zone: OverviewZone) {
  if (!rules.length) {
    return `Overview-position prior: ${zone}. No additional D1 visual rule is loaded for these candidates. Treat position as supporting context only; camera framing can be oblique or cropped.`;
  }
  const lines = rules.map(rule => {
    const parts = [`- ${rule.component_code}: ${rule.visual_definition}`];
    if (rule.positive_cues) parts.push(`Positive cues: ${rule.positive_cues}`);
    if (rule.negative_cues) parts.push(`Do not confuse with: ${rule.negative_cues}`);
    if (rule.confusable_with) parts.push(`Common alternatives: ${rule.confusable_with}`);
    if (rule.overview_zone !== "ANY") parts.push(`Position rule: ${rule.container_face}/${rule.overview_zone}`);
    return parts.join(" ");
  });
  return `D1 component visual knowledge (use as guidance, not as a substitute for visible evidence):\n${lines.join("\n")}\nOverview-position prior: ${zone}. If image evidence conflicts with position guidance, set needs_review true.`;
}

function visualRuleForcesReview(rules: ComponentVisualRule[], code: string | null) {
  return Boolean(code && rules.some(rule => rule.component_code === code && rule.force_review === 1));
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

function parseMetadataJson(value: string | null | undefined): Record<string, unknown> | null {
  if (!value) return null;
  try {
    return record(JSON.parse(value));
  } catch {
    return null;
  }
}

// Only parse final answer content. Never promote unfinished reasoning into a prediction.
function parseStructuredJson(raw: unknown, requiredKey: string): Record<string, unknown> | null {
  const envelope = record(raw);
  const first = Array.isArray(envelope?.choices) ? record(envelope.choices[0]) : null;
  const message = record(first?.message);
  const values = first ? [message?.content] : [raw, envelope?.response, envelope?.result, envelope?.output_text];
  for (const value of values) {
    const object = record(value);
    if (object && Object.hasOwn(object, requiredKey)) return object;
    if (typeof value !== "string") continue;
    const text = value.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
    try {
      const parsed = record(JSON.parse(text));
      if (parsed && Object.hasOwn(parsed, requiredKey)) return parsed;
    } catch { /* The caller returns an explicit invalid-response outcome. */ }
  }
  return null;
}

function parseJson(raw: unknown): Record<string, unknown> | null {
  return parseStructuredJson(raw, "selected_code");
}

function parseFamilyJson(raw: unknown): Record<string, unknown> | null {
  return parseStructuredJson(raw, "family");
}

function validConfidence(value: unknown): value is number | null {
  return value === null || (typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 100);
}
function confidence(value: number | null): number | null {
  return value === null ? null : value > 1 ? value / 100 : value;
}

function isGpDoorFamily(value: unknown): value is GpDoorFamily {
  return typeof value === "string" && (GP_DOOR_FAMILIES as readonly string[]).includes(value);
}

function isGpStructuralFamily(value: unknown): value is GpStructuralFamily {
  return typeof value === "string" && (GP_STRUCTURAL_FAMILIES as readonly string[]).includes(value);
}

function gpDoorFamilyShortlist(
  family: GpDoorFamily,
  allowedCodes: string[],
  rules: ComponentVisualRule[]
) {
  if (family === "UNKNOWN") return [];
  const selected = new Set<string>(GP_DOOR_FAMILY_CODES[family]);
  for (const rule of rules) {
    if (!selected.has(rule.component_code)) continue;
    for (const code of (rule.confusable_with ?? "").toUpperCase().split(/[^A-Z0-9]+/).filter(Boolean)) {
      if (code.length === 3) selected.add(code);
    }
  }
  return allowedCodes.filter(code => selected.has(code));
}

function gpStructuralFamilyShortlist(
  family: GpStructuralFamily,
  allowedCodes: string[]
) {
  if (family === "UNKNOWN" || family === "PANEL_SURFACE" || family === "FITTED_COMPONENT") return [];
  const selected = new Set<string>(GP_STRUCTURAL_FAMILY_CODES[family]);
  return allowedCodes.filter(code => selected.has(code));
}

function componentLog(event: string, details: Record<string, unknown> = {}) {
  console.log(JSON.stringify({
    scope: "COMPONENT_ANALYSIS",
    event,
    ...details
  }));
}

export class CedexClassificationService {
  constructor(private readonly repo: CedexRepository, private readonly bucket: Bucket, private readonly ai: AiRunner) {}

  async analyseComponent(findingId: string) {
    const startedAt = Date.now();
    const traceId = crypto.randomUUID();
    componentLog("START", { traceId, findingId, model: MODEL });
    const context = await this.repo.findingContext(findingId);
    if (!context) throw new Error("Finding not found.");
    const equipment = await this.repo.equipmentForFinding(findingId);
    const allowed = await this.repo.components(equipment, context.container_face);
    if (!allowed.length) throw new Error("No verified CEDEX component master is loaded for this equipment type.");
    const photo = await this.repo.findingPhoto(findingId, "DAMAGE_CLOSEUP");
    if (!photo) throw new Error("Save the damage close-up photo before AI classification.");
    const object = await this.bucket.get(photo.r2_key);
    if (!object) throw new Error("Damage close-up photo is unavailable.");
    const targetPoint = await this.repo.surveyorComponentPoint(findingId, photo.id);
    const image = dataUri(await object.arrayBuffer(), photo.content_type);

    const componentTargetPhoto = await this.repo.findingPhoto(findingId, "COMPONENT_CLOSEUP");
    let componentTargetImage: string | null = null;
    if (componentTargetPhoto) {
      const componentTargetObject = await this.bucket.get(componentTargetPhoto.r2_key);
      if (componentTargetObject) {
        componentTargetImage = dataUri(await componentTargetObject.arrayBuffer(), componentTargetPhoto.content_type);
      }
    }

    const componentTargetMetadata = parseMetadataJson(componentTargetPhoto?.capture_metadata_json);
    const pointerMapping = record(componentTargetMetadata?.pointerMapping);
    const pointerStagePoint = record(pointerMapping?.stagePoint);
    const imageNormalizedPoint = record(pointerMapping?.imageNormalizedPoint);
    const imageContentBounds = record(pointerMapping?.imageContentBounds);

    const overviewPhoto = await this.repo.findingPhoto(findingId, "FACE_OVERVIEW");
    const overviewPoint = overviewPhoto ? await this.repo.surveyorLocationPoint(findingId, overviewPhoto.id) : null;
    const zone = overviewZone(overviewPoint);
    let overviewImage: string | null = null;
    if (overviewPhoto) {
      const overviewObject = await this.bucket.get(overviewPhoto.r2_key);
      if (overviewObject) overviewImage = dataUri(await overviewObject.arrayBuffer(), overviewPhoto.content_type);
    }
    const fullAllowedCodes = [...new Set(allowed.map(x => x.component_code))];
    const fullAllowedSet = new Set(fullAllowedCodes);
    const allVisualRules = (await this.repo.componentVisualRules(equipment, context.container_face, zone))
      .filter(rule => fullAllowedSet.has(rule.component_code));

    const structuralFace=["LEFT","RIGHT","FRONT","ROOF","FLOOR"].includes(context.container_face);
    const componentFamilyScope: "GP_DOOR"|"GP_STRUCTURAL"|null =
      equipment === "GP"
        ? context.container_face === "DOOR"
          ? "GP_DOOR"
          : structuralFace
            ? "GP_STRUCTURAL"
            : null
        : null;
    const familyInferenceEligible =
      Boolean(componentFamilyScope) &&
      fullAllowedCodes.length > (componentFamilyScope === "GP_DOOR" ? COMPONENT_FAMILY_MIN_ALLOWED : 3) &&
      Boolean(componentTargetImage || targetPoint);
    let componentFamilyInferenceUsed = false;
    let componentFamily: ComponentFamily | null = null;
    let componentFamilyConfidence: number | null = null;
    let componentFamilyReason: string | null = null;
    let componentFamilyNarrowingUsed = false;
    let classificationAllowed = allowed;

    if (familyInferenceEligible && componentFamilyScope) {
      componentFamilyInferenceUsed = true;
      const familyPrompt = componentFamilyScope === "GP_DOOR"
        ? `Identify the local GP dry-container DOOR assembly family directly beneath the surveyor target.
The exact reticle centre / numeric pinpoint is the target; surrounding structure is context only.
Choose one family:
- LOCKING_BAR_SUPPORT: locking-bar rod support area, bracket, guide, fastening/mounting hardware.
- LOCKING_BAR_CAM: locking cam and keeper engagement area near the locking-bar end.
- LOCKING_BAR_HANDLE: operating handle, hub, lug, handle catch/retainer/lock area.
- HINGE: hinge assembly, blade, pin or hinge lug.
- GASKET_SEAL: door gasket or gasket retainer strip.
- DOOR_PANEL_FRAME: door leaf/panel, frame or door stiffeners.
- CORNER_POST_RAIL: corner fitting/post/J-bar/header/rail/gusset structural edge.
- DOOR_ACCESSORY: door stop/slam plate, holdback chain/cable, data plate or similar accessory.
- UNKNOWN: target is unclear or lies between families.
Do not identify the CEDEX component code yet. If the visual evidence is ambiguous, choose UNKNOWN rather than guessing.
${targetPoint ? `Original close-up target coordinates: x=${targetPoint.x.toFixed(4)}, y=${targetPoint.y.toFixed(4)}.` : ""}`
        : `Identify the local GP dry-container structural family directly beneath the surveyor crosshair on the ${context.container_face} view.
Use the local target evidence only. The crosshair centre is authoritative; a large nearby panel or the overall image must not override the object directly under the crosshair.
Choose one family:
- CORNER_FITTING: the block-like ISO corner casting/fitting at a container corner.
- CORNER_POST: the vertical corner-post assembly or one of its inner/outer/J-bar/hinge-lug pieces.
- PANEL_SURFACE: broad corrugated sheet/panel surface.
- RAIL_EDGE: a distinct structural rail, rail gusset/doubling/recess, header extension or roof-corner gusset.
- FITTED_COMPONENT: a fitted item such as a ventilator, marking/stripe or another local accessory.
- UNKNOWN: the local target is unclear or lies between families.
Do not identify the exact CEDEX component code yet. If the local evidence is ambiguous, choose UNKNOWN rather than guessing.
${targetPoint ? `Original close-up target coordinates: x=${targetPoint.x.toFixed(4)}, y=${targetPoint.y.toFixed(4)}.` : ""}`;

      const familyContent: Array<Record<string, unknown>> = [
        { type: "text", text: familyPrompt },
        {
          type: "text",
          text: componentTargetImage
            ? "Local target image: LEFT half is a tight crop and RIGHT half is a medium crop. The fine cyan reticle centre in both halves marks the same exact physical target. Decide from the reticle centre first."
            : "Full close-up fallback: use the numeric pinpoint as the exact target and ignore dominant surrounding objects."
        },
        { type: "image_url", image_url: { url: componentTargetImage ?? image } }
      ];
      const familyEnum = componentFamilyScope === "GP_DOOR"
        ? GP_DOOR_FAMILIES
        : GP_STRUCTURAL_FAMILIES;

      try {
        componentLog("FAMILY_REQUEST", {
          traceId,
          findingId,
          model: MODEL,
          componentFamilyScope,
          fullAllowedCount: fullAllowedCodes.length,
          hasTargetCrop: Boolean(componentTargetImage),
          targetEvidenceMode: componentTargetMetadata?.targetEvidenceMode ?? null
        });
        const familyRaw = await this.ai.run(MODEL, {
          messages: [{ role: "user", content: familyContent }],
          max_completion_tokens: 450,
          reasoning_effort: "low",
          temperature: 0,
          response_format: {
            type: "json_schema",
            json_schema: {
              name: componentFamilyScope === "GP_DOOR"
                ? "gp_door_component_family"
                : "gp_structural_component_family",
              strict: true,
              schema: {
                type: "object",
                properties: {
                  family: { type: "string", enum: familyEnum },
                  confidence: { type: ["number", "null"], minimum: 0, maximum: 1 },
                  reason: { type: "string" }
                },
                required: ["family", "confidence", "reason"],
                additionalProperties: false
              }
            }
          }
        });
        const parsedFamily = parseFamilyJson(familyRaw);
        const familyValid = componentFamilyScope === "GP_DOOR"
          ? isGpDoorFamily(parsedFamily?.family)
          : isGpStructuralFamily(parsedFamily?.family);
        if (parsedFamily && familyValid && validConfidence(parsedFamily.confidence) && typeof parsedFamily.reason === "string") {
          componentFamily = parsedFamily.family as ComponentFamily;
          componentFamilyConfidence = confidence(parsedFamily.confidence);
          componentFamilyReason = parsedFamily.reason.trim() || null;
          const minConfidence =
            componentFamilyScope === "GP_STRUCTURAL" && componentFamily === "CORNER_FITTING"
              ? 0.9
              : COMPONENT_FAMILY_MIN_CONFIDENCE;
          if (
            componentFamily !== "UNKNOWN" &&
            componentFamilyConfidence !== null &&
            componentFamilyConfidence >= minConfidence
          ) {
            const shortlistCodes = componentFamilyScope === "GP_DOOR"
              ? gpDoorFamilyShortlist(componentFamily as GpDoorFamily, fullAllowedCodes, allVisualRules)
              : gpStructuralFamilyShortlist(componentFamily as GpStructuralFamily, fullAllowedCodes);
            const minimumShortlist = componentFamilyScope === "GP_DOOR" ? 2 : 1;
            if (shortlistCodes.length >= minimumShortlist && shortlistCodes.length < fullAllowedCodes.length) {
              const shortlistSet = new Set(shortlistCodes);
              classificationAllowed = allowed.filter(item => shortlistSet.has(item.component_code));
              componentFamilyNarrowingUsed = true;
            }
          }
        }
        componentLog("FAMILY_RESPONSE", {
          traceId,
          findingId,
          componentFamilyScope,
          componentFamily,
          componentFamilyConfidence,
          componentFamilyReason,
          componentFamilyNarrowingUsed,
          shortlistedCount: classificationAllowed.length
        });
      } catch (error) {
        componentLog("FAMILY_FALLBACK", {
          traceId,
          findingId,
          componentFamilyScope,
          reason: error instanceof Error ? error.message : "Family classifier unavailable"
        });
      }
    }

    const allowedCodes = [...new Set(classificationAllowed.map(x => x.component_code))];
    const allowedSet = new Set(allowedCodes);
    const allowedText = classificationAllowed.map(x => `${x.component_code} = ${x.component_name}`).join("\n");
    const visualRules = allVisualRules.filter(rule => allowedSet.has(rule.component_code));
    const guidance = formatVisualGuidance(visualRules, zone);
    componentLog("CONTEXT", {
      traceId,
      findingId,
      equipment,
      containerFace: context.container_face,
      confirmedLocationCode: context.final_location_code,
      closeupPhotoId: photo.id,
      targetPoint,
      componentTargetPhotoId: componentTargetPhoto?.id ?? null,
      targetCropAvailable: Boolean(componentTargetImage),
      targetEvidenceMode: componentTargetMetadata?.targetEvidenceMode ?? null,
      targetCropVersion: componentTargetMetadata?.version ?? null,
      coordinateSpace: componentTargetMetadata?.coordinateSpace ?? null,
      pointerStagePoint,
      imageNormalizedPoint,
      imageContentBounds,
      overviewPhotoId: overviewPhoto?.id ?? null,
      overviewPoint,
      overviewZone: zone,
      overviewImageAvailable: Boolean(overviewImage),
      fullAllowedCount: fullAllowedCodes.length,
      allowedCount: allowedCodes.length,
      allowedCodes,
      componentFamilyInferenceUsed,
      componentFamilyScope,
      componentFamily,
      componentFamilyConfidence,
      componentFamilyNarrowingUsed,
      visualRuleCount: visualRules.length,
      visualRuleCodes: [...new Set(visualRules.map(rule => rule.component_code))]
    });
    const gpDoorHardwareGuidance = equipment === "GP" && context.container_face === "DOOR"
      ? `GP DOOR family stage: ${componentFamilyNarrowingUsed
          ? `the pinpoint family was classified as ${componentFamily} at confidence ${componentFamilyConfidence?.toFixed(2)}; the final AI candidate list was narrowed from ${fullAllowedCodes.length} to ${allowedCodes.length} codes.`
          : "no high-confidence family shortlist was applied, so the full face-valid candidate list remains available."}
The exact reticle centre still overrides the surrounding assembly.
Special HWH/HWR rule: HWH is the specific Huckbolt code. A round fastener head by itself is NOT enough evidence for HWH. Select HWH only when the target is positively visually identifiable as the Huckbolt referenced by the visual rule. If the target is fastening/mounting hardware but that Huckbolt-specific identification cannot be established from the image, prefer HWR and keep needs_review true when uncertainty remains.`
      : "";

    const prompt = `You are assisting a shipping-container surveyor. Equipment type: ${equipment}. Recorded container face: ${context.container_face}.
Classify ONLY the physical component directly beneath the surveyor crosshair. The allowed list has already been restricted to components verified as physically applicable to the recorded container face. Choose ONLY from the allowed component codes. Never invent a code.

Evidence priority is strict:
1. Local crosshair evidence — strongest. If supplied, the LEFT half is a tight crop and the RIGHT half is a medium crop of the same target.
2. The exact numeric crosshair coordinate.
3. The full close-up — surrounding assembly context only.
4. D1 visual rules and recorded container face.
5. Overview position/location — weak supporting context only.

A damage-area box or damage extent is for damage size/location and must NEVER be used as the component target. A large panel occupying most of the full image must not override a smaller component directly under the crosshair.
${gpDoorHardwareGuidance}
${overviewPoint ? `The surveyor's confirmed damage position on the overview image is x=${overviewPoint.x.toFixed(4)}, y=${overviewPoint.y.toFixed(4)} (normalized from top-left). Heuristic overview zone: ${zone}. This is weak context only.` : "No confirmed overview position is available."}
${context.final_location_code ? `Confirmed CEDEX location from the overview workflow: ${context.final_location_code}. Use this only as weak structural-position context. Do not choose a component from the location code alone.` : "No confirmed CEDEX location code is available yet."}
${targetPoint ? `The surveyor pinpointed the component target on the original close-up at normalized coordinates x=${targetPoint.x.toFixed(4)}, y=${targetPoint.y.toFixed(4)}. Identify the physical component containing this exact point.` : "No close-up target point is available. If the target component is ambiguous, abstain."}
${componentTargetImage ? "The local target image is supplied FIRST. Its fine cyan reticle marks the same exact surveyor-selected point in a tight crop and a medium crop. The reticle is an overlay, not part of the container. Resolve the object directly beneath the reticle before considering the full close-up." : "No local target crop is available; use the numeric pinpoint and full close-up carefully."}

${guidance}

If the local target cannot be identified reliably or evidence conflicts, return selected_code null and needs_review true rather than allowing the dominant full-image object to decide.
Allowed codes:
${allowedText}
Return only the final JSON object with selected_code (an allowed code or JSON null), confidence (0 to 1 or null), needs_review (boolean), reason (one short visual sentence), and candidates (at most 3 objects with code, confidence and reason). Do not explain your reasoning outside the JSON.`;

    const content: Array<Record<string, unknown>> = [{ type: "text", text: prompt }];
    if (componentTargetImage) {
      content.push(
        { type: "text", text: "PRIMARY LOCAL TARGET: left = tight crop, right = medium crop. The fine cyan reticle centre in both halves is the exact component target." },
        { type: "image_url", image_url: { url: componentTargetImage } }
      );
    }
    content.push(
      { type: "text", text: "SECONDARY CONTEXT: full close-up. Use only to understand how the locally targeted object connects to surrounding structure." },
      { type: "image_url", image_url: { url: image } }
    );
    if (!componentTargetImage && overviewImage) {
      content.push(
        { type: "text", text: "WEAK CONTEXT: overview image. Do not use the dominant object in this image as the component target." },
        { type: "image_url", image_url: { url: overviewImage } }
      );
    }

    componentLog("AI_REQUEST", {
      traceId,
      findingId,
      model: MODEL,
      reasoningEffort: "low",
      maxCompletionTokens: MAX_COMPLETION_TOKENS,
      hasOverviewImage: Boolean(overviewImage && !componentTargetImage),
      overviewImageSuppressedByLocalTarget: Boolean(overviewImage && componentTargetImage),
      hasCloseupImage: true,
      hasTargetCrop: Boolean(componentTargetImage),
      targetEvidenceMode: componentTargetMetadata?.targetEvidenceMode ?? null,
      localEvidencePriorityUsed: Boolean(componentTargetImage),
      targetPointUsed: Boolean(targetPoint),
      locationContextUsed: Boolean(context.final_location_code),
      componentFamily,
      componentFamilyConfidence,
      componentFamilyNarrowingUsed,
      fullAllowedCount: fullAllowedCodes.length,
      classificationAllowedCount: allowedCodes.length
    });
    const aiStartedAt = Date.now();
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
        const positionalConflict = visualRuleForcesReview(visualRules, code);
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
    const positionalConflict = visualRuleForcesReview(visualRules, selectedCode);
    componentLog("AI_RESPONSE", {
      traceId,
      findingId,
      finishReason,
      analysisStatus,
      selectedCode,
      confidence: selectedConfidence,
      needsReview,
      positionalConflict,
      candidates: candidates.map(candidate => ({
        code: candidate.code,
        confidence: candidate.confidence,
        reason: candidate.reason
      })),
      aiDurationMs: Date.now() - aiStartedAt
    });
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
      classificationAllowedComponents: classificationAllowed,
      classificationAllowedCount: allowedCodes.length,
      fullAllowedCount: fullAllowedCodes.length,
      model: MODEL,
      targetPointUsed: Boolean(targetPoint),
      targetCropUsed: Boolean(componentTargetImage),
      targetEvidenceMode: componentTargetMetadata?.targetEvidenceMode ?? null,
      localEvidencePriorityUsed: Boolean(componentTargetImage),
      overviewUsed: Boolean(overviewImage && overviewPoint),
      overviewImageUsed: Boolean(!componentTargetImage && overviewImage),
      overviewZone: zone,
      confirmedLocationCode: context.final_location_code,
      locationContextUsed: Boolean(context.final_location_code),
      positionalConflict,
      visualKnowledgeUsed: visualRules.length > 0,
      visualRuleCount: visualRules.length,
      componentFamilyInferenceUsed,
      componentFamilyScope,
      componentFamily,
      componentFamilyConfidence,
      componentFamilyReason,
      componentFamilyNarrowingUsed,
      componentFamilyFallbackUsed: componentFamilyInferenceUsed && !componentFamilyNarrowingUsed,
      hardwareSpecificityRuleUsed: equipment === "GP" && context.container_face === "DOOR"
    };
    componentLog("PERSIST_START", {
      traceId,
      findingId,
      analysisStatus,
      selectedCode,
      status: analysisStatus === "INCOMPLETE" || analysisStatus === "INVALID_RESPONSE" ? "FAILED" : needsReview ? "REVIEW_REQUIRED" : "SUGGESTED"
    });
    const persisted = await this.repo.saveComponentPrediction({
      findingId, surveyId: context.survey_id, modelName: MODEL, selectedCode, confidence: selectedConfidence, candidates,
      response: raw,
      status: analysisStatus === "INCOMPLETE" || analysisStatus === "INVALID_RESPONSE" ? "FAILED" : needsReview ? "REVIEW_REQUIRED" : "SUGGESTED",
      requestContext: {
        debugTraceId: traceId,
        photoId: photo.id,
        targetPoint,
        componentTargetPhotoId: componentTargetPhoto?.id ?? null,
        targetCropUsed: Boolean(componentTargetImage),
        targetCropReticle: componentTargetImage ? "FINE_LASER" : null,
        targetEvidenceMode: componentTargetMetadata?.targetEvidenceMode ?? null,
        targetCropVersion: componentTargetMetadata?.version ?? null,
        localEvidencePriorityUsed: Boolean(componentTargetImage),
        damageAreaUsedForComponent: false,
        coordinateSpace: componentTargetMetadata?.coordinateSpace ?? null,
        pointerStagePoint,
        imageNormalizedPoint,
        imageContentBounds,
        overviewPhotoId: overviewPhoto?.id ?? null,
        overviewPoint,
        overviewUsed: Boolean(overviewImage && overviewPoint),
        overviewZone: zone,
        confirmedLocationCode: context.final_location_code,
        locationContextUsed: Boolean(context.final_location_code),
        positionalConflict,
        visualKnowledgeUsed: visualRules.length > 0,
        visualRuleCount: visualRules.length,
        visualRuleCodes: [...new Set(visualRules.map(rule => rule.component_code))],
        componentFamilyInferenceUsed,
        componentFamilyScope,
        componentFamily,
        componentFamilyConfidence,
        componentFamilyReason,
        componentFamilyNarrowingUsed,
        componentFamilyFallbackUsed: componentFamilyInferenceUsed && !componentFamilyNarrowingUsed,
        hardwareSpecificityRuleUsed: equipment === "GP" && context.container_face === "DOOR",
        containerFace: context.container_face,
        allowedComponentCount: allowed.length,
        classificationAllowedComponentCount: allowedCodes.length,
        familyConfidenceThreshold: COMPONENT_FAMILY_MIN_CONFIDENCE,
        componentReviewThreshold: COMPONENT_REVIEW_THRESHOLD,
        max_completion_tokens: MAX_COMPLETION_TOKENS,
        reasoning_effort: "low",
        analysisStatus,
        finishReason
      }
    });
    componentLog("COMPLETE", {
      traceId,
      findingId,
      selectedCode,
      confidence: selectedConfidence,
      needsReview,
      analysisStatus,
      predictionId: persisted.predictionId,
      totalDurationMs: Date.now() - startedAt
    });
    return result;
  }
}
