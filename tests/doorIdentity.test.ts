import { describe, expect, it } from "vitest";
import { normalizeIsoSizeTypeCode } from "../src/domain/vision/doorIdentity";
import { parseDoorIdentityModelOutput } from "../src/infrastructure/ai/qwenDoorIdentityProvider";

describe("door identity vision parsing", () => {
  it("parses JSON-only model output", () => {
    const result = parseDoorIdentityModelOutput(
      '{"container_number":"MSCU 663987 0","iso_size_type":"45G1","container_number_confidence":0.97,"iso_size_type_confidence":0.94,"notes":[]}'
    );

    expect(result.containerNumberRaw).toBe("MSCU 663987 0");
    expect(result.isoSizeTypeRaw).toBe("45G1");
    expect(result.containerNumberConfidence).toBe(0.97);
  });

  it("parses fenced JSON output defensively", () => {
    const fence = String.fromCharCode(96, 96, 96);
    const modelText =
      fence +
      'json\n{"container_number":"CSQU3054383","iso_size_type":"22G1","container_number_confidence":1,"iso_size_type_confidence":0.88,"notes":["clear"]}\n' +
      fence;

    const result = parseDoorIdentityModelOutput(modelText);

    expect(result.containerNumberRaw).toBe("CSQU3054383");
    expect(result.notes).toEqual(["clear"]);
  });

  it("normalizes ISO size/type markings", () => {
    expect(normalizeIsoSizeTypeCode(" 45-g1 ")).toBe("45G1");
  });
});
