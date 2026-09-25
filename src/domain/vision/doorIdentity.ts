export interface DoorIdentityPrediction {
  containerNumberRaw: string | null;
  isoSizeTypeRaw: string | null;
  containerNumberConfidence: number | null;
  isoSizeTypeConfidence: number | null;
  notes: string[];
}

export interface DoorIdentityVisionProvider {
  extractIdentity(input: {
    imageDataUrl: string;
    mimeType: string;
  }): Promise<{
    prediction: DoorIdentityPrediction;
    rawResponse: unknown;
    modelName: string;
  }>;
}

export function normalizeIsoSizeTypeCode(value: string | null | undefined): string {
  return (value ?? "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 4);
}

export function clampConfidence(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return Math.max(0, Math.min(1, value));
}
