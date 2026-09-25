import {
  clampConfidence,
  DoorIdentityPrediction,
  DoorIdentityVisionProvider
} from "../../domain/vision/doorIdentity";

export const DOOR_IDENTITY_MODEL = "@cf/qwen/qwen3.8-27b";

type AiLike = {
  run(model: string, input: unknown): Promise<unknown>;
};

interface ParsedModelPayload {
  container_number?: unknown;
  iso_size_type?: unknown;
  container_number_confidence?: unknown;
  iso_size_type_confidence?: unknown;
  notes?: unknown;
}

function extractResponseText(response: unknown): string {
  if (typeof response === "string") return response;

  if (!response || typeof response !== "object") {
    throw new Error("Vision model returned an empty response.");
  }

  const value = response as Record<string, unknown>;

  if (typeof value.response === "string") return value.response;

  const choices = value.choices;
  if (Array.isArray(choices) && choices.length > 0) {
    const first = choices[0];
    if (first && typeof first === "object") {
      const message = (first as Record<string, unknown>).message;
      if (message && typeof message === "object") {
        const content = (message as Record<string, unknown>).content;
        if (typeof content === "string") return content;
      }
    }
  }

  throw new Error("Vision model response did not contain text.");
}

export function parseDoorIdentityModelOutput(text: string): DoorIdentityPrediction {
  const trimmed = text.trim();
  const fenceMarker = String.fromCharCode(96, 96, 96);
  let candidate = trimmed;

  if (trimmed.startsWith(fenceMarker)) {
    const firstLineEnd = trimmed.indexOf("\n");
    const lastFence = trimmed.lastIndexOf(fenceMarker);
    if (firstLineEnd >= 0 && lastFence > firstLineEnd) {
      candidate = trimmed.slice(firstLineEnd + 1, lastFence).trim();
    }
  }

  const firstBrace = candidate.indexOf("{");
  const lastBrace = candidate.lastIndexOf("}");

  if (firstBrace < 0 || lastBrace <= firstBrace) {
    throw new Error("Vision model did not return a JSON object.");
  }

  let payload: ParsedModelPayload;

  try {
    payload = JSON.parse(candidate.slice(firstBrace, lastBrace + 1)) as ParsedModelPayload;
  } catch {
    throw new Error("Vision model returned invalid JSON.");
  }

  const notes = Array.isArray(payload.notes)
    ? payload.notes.filter((value): value is string => typeof value === "string")
    : [];

  return {
    containerNumberRaw:
      typeof payload.container_number === "string" ? payload.container_number : null,
    isoSizeTypeRaw:
      typeof payload.iso_size_type === "string" ? payload.iso_size_type : null,
    containerNumberConfidence: clampConfidence(payload.container_number_confidence),
    isoSizeTypeConfidence: clampConfidence(payload.iso_size_type_confidence),
    notes
  };
}

export class QwenDoorIdentityProvider implements DoorIdentityVisionProvider {
  constructor(private readonly ai: AiLike) {}

  async extractIdentity(input: {
    imageDataUrl: string;
    mimeType: string;
  }): Promise<{
    prediction: DoorIdentityPrediction;
    rawResponse: unknown;
    modelName: string;
  }> {
    const rawResponse = await this.ai.run(DOOR_IDENTITY_MODEL, {
      messages: [
        {
          role: "system",
          content:
            "You extract shipping container identity markings from depot survey photos. " +
            "Do not infer or invent unreadable characters. Read the ISO 6346 container number " +
            "(4 letters + 7 digits including check digit) and the 4-character ISO size/type code. " +
            "Return JSON only."
        },
        {
          role: "user",
          content: [
            {
              type: "image_url",
              image_url: { url: input.imageDataUrl }
            },
            {
              type: "text",
              text:
                "Read the container door markings. Return exactly one JSON object with: " +
                "container_number (string or null), iso_size_type (string or null), " +
                "container_number_confidence (0 to 1 or null), iso_size_type_confidence " +
                "(0 to 1 or null), and notes (array of short strings). " +
                "Keep characters exactly as seen. If a field is unclear, use null or lower confidence."
            }
          ]
        }
      ],
      reasoning_effort: "low",
      temperature: 0
    });

    const text = extractResponseText(rawResponse);
    const prediction = parseDoorIdentityModelOutput(text);

    return {
      prediction,
      rawResponse,
      modelName: DOOR_IDENTITY_MODEL
    };
  }
}
