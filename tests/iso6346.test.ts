import { describe, expect, it } from "vitest";
import {
  calculateIso6346CheckDigit,
  normalizeContainerNumber,
  parseAndValidateContainerNumber
} from "../src/domain/container/iso6346";

describe("ISO 6346 container number", () => {
  it("normalizes spaces and punctuation", () => {
    expect(normalizeContainerNumber("MSCU 663987-0")).toBe("MSCU6639870");
  });

  it("calculates the ISO 6346 check digit", () => {
    expect(calculateIso6346CheckDigit("MSCU663987")).toBe(0);
    expect(calculateIso6346CheckDigit("CSQU305438")).toBe(3);
  });

  it("accepts a valid container number", () => {
    const result = parseAndValidateContainerNumber("MSCU 663987 0");
    expect(result.validFormat).toBe(true);
    expect(result.validCheckDigit).toBe(true);
    expect(result.ownerCode).toBe("MSC");
    expect(result.equipmentCategory).toBe("U");
    expect(result.serialNo).toBe("663987");
  });

  it("rejects an incorrect check digit", () => {
    const result = parseAndValidateContainerNumber("MSCU6639871");
    expect(result.validFormat).toBe(true);
    expect(result.validCheckDigit).toBe(false);
    expect(result.expectedCheckDigit).toBe(0);
  });
});
