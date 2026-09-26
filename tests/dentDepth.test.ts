import { describe, expect, it } from "vitest";
import { assessDentDepth } from "../src/domain/container/dentDepth";

describe("GP panel dent depth assessment", () => {
  it("uses 35 mm for inward side-panel dents", () => {
    expect(assessDentDepth({
      equipment: "GP",
      componentCode: "PAA",
      damageCode: "DT",
      containerFace: "RIGHT",
      depthCm: 3.5,
      direction: "INWARD"
    })).toMatchObject({
      applicable: true,
      limitMm: 35,
      status: "WITHIN_DIMENSIONAL_CRITERION"
    });
  });

  it("uses 30 mm for outward side-panel dents", () => {
    expect(assessDentDepth({
      equipment: "GP",
      componentCode: "PAA",
      damageCode: "DT",
      containerFace: "LEFT",
      depthCm: 3.1,
      direction: "OUTWARD"
    })).toMatchObject({
      applicable: true,
      limitMm: 30,
      status: "EXCEEDS_DIMENSIONAL_CRITERION"
    });
  });

  it("uses 15 mm for outward front-panel dents", () => {
    expect(assessDentDepth({
      equipment: "GP",
      componentCode: "PAA",
      damageCode: "DT",
      containerFace: "FRONT",
      depthCm: 1.5,
      direction: "OUTWARD"
    })).toMatchObject({
      applicable: true,
      limitMm: 15,
      status: "WITHIN_DIMENSIONAL_CRITERION"
    });
  });

  it("requires a direction when a mapped dent depth is entered", () => {
    expect(() => assessDentDepth({
      equipment: "GP",
      componentCode: "PAA",
      damageCode: "DT",
      containerFace: "RIGHT",
      depthCm: 2,
      direction: "UNKNOWN"
    })).toThrow("Select inward or outward dent direction");
  });

  it("keeps an unmeasured mapped dent distinct from a missing direction error", () => {
    expect(assessDentDepth({
      equipment: "GP",
      componentCode: "PAA",
      damageCode: "DT",
      containerFace: "RIGHT",
      depthCm: null,
      direction: "UNKNOWN"
    })).toMatchObject({
      applicable: true,
      limitMm: null,
      status: "NOT_MEASURED"
    });
  });

  it("does not apply the GP panel criterion to other damage contexts", () => {
    expect(assessDentDepth({
      equipment: "RF",
      componentCode: "PAA",
      damageCode: "DT",
      containerFace: "RIGHT",
      depthCm: 2,
      direction: "UNKNOWN"
    })).toEqual({
      applicable: false,
      limitMm: null,
      status: "NOT_APPLICABLE",
      sourceReference: null
    });
  });
});
