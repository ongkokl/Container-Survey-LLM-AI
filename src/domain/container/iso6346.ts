const LETTER_VALUES: Record<string, number> = {
  A: 10, B: 12, C: 13, D: 14, E: 15, F: 16, G: 17, H: 18, I: 19,
  J: 20, K: 21, L: 23, M: 24, N: 25, O: 26, P: 27, Q: 28, R: 29,
  S: 30, T: 31, U: 32, V: 34, W: 35, X: 36, Y: 37, Z: 38
};

export interface ParsedContainerNumber {
  normalized: string;
  ownerCode: string;
  equipmentCategory: string;
  serialNo: string;
  checkDigit: string;
  validFormat: boolean;
  validCheckDigit: boolean;
  expectedCheckDigit: number | null;
}

export function normalizeContainerNumber(value: string): string {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export function calculateIso6346CheckDigit(firstTenCharacters: string): number | null {
  const normalized = normalizeContainerNumber(firstTenCharacters);
  if (!/^[A-Z]{4}\d{6}$/.test(normalized)) return null;

  let sum = 0;

  for (let position = 0; position < normalized.length; position += 1) {
    const char = normalized[position];
    const numericValue = /\d/.test(char) ? Number(char) : LETTER_VALUES[char];

    if (numericValue === undefined) return null;
    sum += numericValue * (2 ** position);
  }

  const remainder = sum % 11;
  return remainder === 10 ? 0 : remainder;
}

export function parseAndValidateContainerNumber(value: string): ParsedContainerNumber {
  const normalized = normalizeContainerNumber(value);
  const validFormat = /^[A-Z]{4}\d{7}$/.test(normalized);

  if (!validFormat) {
    return {
      normalized,
      ownerCode: "",
      equipmentCategory: "",
      serialNo: "",
      checkDigit: "",
      validFormat: false,
      validCheckDigit: false,
      expectedCheckDigit: null
    };
  }

  const ownerCode = normalized.slice(0, 3);
  const equipmentCategory = normalized.slice(3, 4);
  const serialNo = normalized.slice(4, 10);
  const checkDigit = normalized.slice(10, 11);
  const expectedCheckDigit = calculateIso6346CheckDigit(normalized.slice(0, 10));

  return {
    normalized,
    ownerCode,
    equipmentCategory,
    serialNo,
    checkDigit,
    validFormat: true,
    validCheckDigit: expectedCheckDigit !== null && Number(checkDigit) === expectedCheckDigit,
    expectedCheckDigit
  };
}
