import { describe, expect, it, vi } from "vitest";
import { DamageClassificationService } from "../../src/application/damageClassificationService";
import type { CedexRepository } from "../../src/infrastructure/d1/cedexRepository";

type Damage = { damage_code: string; damage_name: string };

function makeHarness(options?: {
  damages?: Damage[];
  roi?: { x: number; y: number; width: number; height: number } | null;
  photo?: { id: string; r2_key: string; content_type: string } | null;
  objectAvailable?: boolean;
  aiResponse?: unknown;
}) {
  const damages =
    options?.damages ??
    [
      { damage_code: "DT", damage_name: "Dent / Bent" },
      { damage_code: "GD", damage_name: "Gouged / Scratched" },
      { damage_code: "CK", damage_name: "Cracked" }
    ];

  const roi =
    options?.roi === undefined
      ? { x: 0.25, y: 0.4, width: 0.2, height: 0.15 }
      : options.roi;

  const photo =
    options?.photo === undefined
      ? {
          id: "photo-1",
          r2_key: "survey/finding/closeup.jpg",
          content_type: "image/jpeg"
        }
      : options.photo;

  const aiResponse =
    options?.aiResponse ??
    {
      choices: [
        {
          message: {
            content: JSON.stringify({
              selected_code: "DT",
              confidence: 0.92,
              needs_review: false,
              candidates: [
                { code: "DT", confidence: 0.92 },
                { code: "GD", confidence: 0.06 }
              ]
            })
          }
        }
      ]
    };

  const savedPredictions: unknown[] = [];
  const repo = {
    findingContext: vi.fn(async (_findingId: string) => ({
      id: "finding-1",
      survey_id: "survey-1",
      container_face: "RIGHT",
      equipment_type: "GP",
      length_ft: 40
    })),
    damageCodesForFinding: vi.fn(async (_findingId: string) => ({
      componentCode: "PAA",
      damages
    })),
    surveyorDamageBox: vi.fn(async (_findingId: string) => roi),
    findingPhoto: vi.fn(async (_findingId: string, _role: string) => photo),
    saveDamagePrediction: vi.fn(async (input: unknown) => {
      savedPredictions.push(input);
      return { predictionId: "prediction-1" };
    })
  } as unknown as CedexRepository;

  const bucket = {
    get: vi.fn(async (_key: string) =>
      options?.objectAvailable === false
        ? null
        : {
            arrayBuffer: async () => new Uint8Array([1, 2, 3, 4]).buffer
          }
    )
  };

  const ai = {
    run: vi.fn(async (_model: string, _input: unknown) => aiResponse)
  };

  const service = new DamageClassificationService(repo, bucket, ai);

  return { service, repo, bucket, ai, savedPredictions };
}

function requestText(input: unknown): string {
  const body = input as {
    messages?: Array<{
      content?: Array<{ type?: string; text?: string }>;
    }>;
  };

  return (
    body.messages?.[0]?.content?.find((part) => part.type === "text")?.text ?? ""
  );
}

describe("DamageClassificationService", () => {
  it("accepts a valid constrained damage prediction and persists it", async () => {
    const h = makeHarness();

    const result = await h.service.analyse("finding-1");

    expect(result.selectedCode).toBe("DT");
    expect(result.confidence).toBe(0.92);
    expect(result.needsReview).toBe(false);
    expect(result.componentCode).toBe("PAA");
    expect(result.roiUsed).toBe(true);
    expect(result.candidates.map((x) => x.code)).toEqual(["DT", "GD"]);

    expect(h.ai.run).toHaveBeenCalledTimes(1);
    expect(h.savedPredictions).toHaveLength(1);
    expect(h.savedPredictions[0]).toMatchObject({
      findingId: "finding-1",
      surveyId: "survey-1",
      selectedCode: "DT",
      confidence: 0.92
    });
  });

  it("rejects model-invented damage codes that are outside the allowed D1 list", async () => {
    const h = makeHarness({
      aiResponse: {
        choices: [
          {
            message: {
              content: JSON.stringify({
                selected_code: "ZZ",
                confidence: 0.99,
                needs_review: false,
                candidates: [
                  { code: "ZZ", confidence: 0.99 },
                  { code: "DT", confidence: 0.35 }
                ]
              })
            }
          }
        ]
      }
    });

    const result = await h.service.analyse("finding-1");

    expect(result.selectedCode).toBeNull();
    expect(result.needsReview).toBe(true);
    expect(result.candidates.map((x) => x.code)).toEqual(["DT"]);
    expect(h.savedPredictions[0]).toMatchObject({
      selectedCode: null,
      confidence: 0.99
    });
  });

  it("supports deliberate model abstention without calling an external fallback", async () => {
    const h = makeHarness({
      aiResponse: {
        choices: [
          {
            message: {
              content: JSON.stringify({
                selected_code: null,
                confidence: null,
                needs_review: true,
                candidates: []
              })
            }
          }
        ]
      }
    });

    const result = await h.service.analyse("finding-1");

    expect(result.selectedCode).toBeNull();
    expect(result.confidence).toBeNull();
    expect(result.needsReview).toBe(true);
    expect(result.allowedDamages).toHaveLength(3);
    expect(h.ai.run).toHaveBeenCalledTimes(1);
    expect(h.savedPredictions[0]).toMatchObject({
      selectedCode: null,
      confidence: null
    });
  });

  it("includes the surveyor ROI and constrained damage codes in the AI request", async () => {
    const h = makeHarness({
      roi: { x: 0.1234, y: 0.4567, width: 0.2222, height: 0.1111 }
    });

    await h.service.analyse("finding-1");

    const [, input] = h.ai.run.mock.calls[0];
    const prompt = requestText(input);

    expect(prompt).toContain("Confirmed component: PAA");
    expect(prompt).toContain("Container face: RIGHT");
    expect(prompt).toContain(
      "x=0.123, y=0.457, width=0.222, height=0.111"
    );
    expect(prompt).toContain("DT = Dent / Bent");
    expect(prompt).toContain("GD = Gouged / Scratched");
    expect(prompt).toContain("Never invent a code");

    expect(input).toMatchObject({
      max_completion_tokens: 400,
      reasoning_effort: "low",
      temperature: 0,
      response_format: {
        type: "json_schema"
      }
    });
  });

  it("stops before AI inference when no verified component-damage rules exist", async () => {
    const h = makeHarness({ damages: [] });

    await expect(h.service.analyse("finding-1")).rejects.toThrow(
      "No verified IICL damage rules are loaded for the confirmed component."
    );

    expect(h.ai.run).not.toHaveBeenCalled();
    expect(h.bucket.get).not.toHaveBeenCalled();
    expect(h.savedPredictions).toHaveLength(0);
  });

  it("stops before AI inference when the damage close-up is missing", async () => {
    const h = makeHarness({ photo: null });

    await expect(h.service.analyse("finding-1")).rejects.toThrow(
      "Damage close-up photo is required."
    );

    expect(h.ai.run).not.toHaveBeenCalled();
    expect(h.savedPredictions).toHaveLength(0);
  });

  it("reports an unavailable R2 object without consuming AI inference", async () => {
    const h = makeHarness({ objectAvailable: false });

    await expect(h.service.analyse("finding-1")).rejects.toThrow(
      "Damage close-up photo is unavailable."
    );

    expect(h.ai.run).not.toHaveBeenCalled();
    expect(h.savedPredictions).toHaveLength(0);
  });

  it("normalises percentage-style model confidence and limits candidates to valid codes", async () => {
    const h = makeHarness({
      aiResponse: {
        choices: [
          {
            message: {
              content: JSON.stringify({
                selected_code: "DT",
                confidence: 92,
                needs_review: false,
                candidates: [
                  { code: "DT", confidence: 92 },
                  { code: "GD", confidence: 6 },
                  { code: "ZZ", confidence: 2 },
                  { code: "CK", confidence: 1 }
                ]
              })
            }
          }
        ]
      }
    });

    const result = await h.service.analyse("finding-1");

    expect(result.confidence).toBe(0.92);
    expect(result.candidates).toEqual([
      { code: "DT", confidence: 0.92, reason: "" },
      { code: "GD", confidence: 0.06, reason: "" }
    ]);
  });
});
