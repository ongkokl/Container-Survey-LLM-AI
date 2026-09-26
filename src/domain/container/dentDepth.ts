export type DeformationDirection = "INWARD" | "OUTWARD" | "UNKNOWN";

export type IiclDepthStatus =
  | "WITHIN_DIMENSIONAL_CRITERION"
  | "EXCEEDS_DIMENSIONAL_CRITERION"
  | "NOT_MEASURED"
  | "NOT_APPLICABLE";

export interface DentDepthAssessmentInput {
  equipment: "GP" | "RF";
  componentCode: string;
  damageCode: string;
  containerFace: string | null;
  depthCm: number | null;
  direction: DeformationDirection;
}

export interface DentDepthAssessment {
  applicable: boolean;
  limitMm: number | null;
  status: IiclDepthStatus;
  sourceReference: string | null;
}

const IICL_SOURCE = "IICL TB-013";

export function assessDentDepth(input: DentDepthAssessmentInput): DentDepthAssessment {
  const face = (input.containerFace ?? "").toUpperCase();
  const sideFace = face === "LEFT" || face === "RIGHT";
  const frontFace = face === "FRONT";
  const applicableDamage =
    input.equipment === "GP" &&
    input.componentCode.toUpperCase() === "PAA" &&
    input.damageCode.toUpperCase() === "DT" &&
    (sideFace || frontFace);

  if (!applicableDamage) {
    return {
      applicable: false,
      limitMm: null,
      status: "NOT_APPLICABLE",
      sourceReference: null
    };
  }

  if (input.depthCm !== null && input.direction === "UNKNOWN") {
    throw new Error("Select inward or outward dent direction when entering dent depth.");
  }

  let limitMm: number | null = null;
  if (input.direction === "INWARD") limitMm = 35;
  if (input.direction === "OUTWARD" && sideFace) limitMm = 30;
  if (input.direction === "OUTWARD" && frontFace) limitMm = 15;

  if (input.depthCm === null || limitMm === null) {
    return {
      applicable: true,
      limitMm,
      status: "NOT_MEASURED",
      sourceReference: IICL_SOURCE
    };
  }

  return {
    applicable: true,
    limitMm,
    status: input.depthCm * 10 <= limitMm
      ? "WITHIN_DIMENSIONAL_CRITERION"
      : "EXCEEDS_DIMENSIONAL_CRITERION",
    sourceReference: IICL_SOURCE
  };
}
