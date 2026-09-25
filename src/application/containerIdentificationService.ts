import {
  normalizeContainerNumber,
  parseAndValidateContainerNumber
} from "../domain/container/iso6346";
import { SurveyRepository } from "../infrastructure/d1/surveyRepository";

export interface ContainerIdentificationInput {
  containerNo: string;
  isoSizeType: string;
  depotCode?: string | null;
}

export class ContainerIdentificationError extends Error {
  constructor(
    message: string,
    readonly code:
      | "INVALID_CONTAINER_FORMAT"
      | "INVALID_CHECK_DIGIT"
      | "UNKNOWN_ISO_SIZE_TYPE"
  ) {
    super(message);
  }
}

export class ContainerIdentificationService {
  constructor(private readonly repository: SurveyRepository) {}

  async validate(input: ContainerIdentificationInput) {
    const parsed = parseAndValidateContainerNumber(input.containerNo);

    if (!parsed.validFormat) {
      throw new ContainerIdentificationError(
        "Container number must contain four letters followed by seven digits.",
        "INVALID_CONTAINER_FORMAT"
      );
    }

    if (!parsed.validCheckDigit) {
      throw new ContainerIdentificationError(
        `Container check digit is invalid. Expected ${parsed.expectedCheckDigit}.`,
        "INVALID_CHECK_DIGIT"
      );
    }

    const isoSizeType = normalizeContainerNumber(input.isoSizeType).slice(0, 4);
    const isoRecord = await this.repository.findIsoSizeType(isoSizeType);

    if (!isoRecord) {
      throw new ContainerIdentificationError(
        `ISO size/type code ${isoSizeType} is not present in the active reference table.`,
        "UNKNOWN_ISO_SIZE_TYPE"
      );
    }

    return {
      container: parsed,
      isoSizeType,
      iso: isoRecord
    };
  }

  async startOrResume(input: ContainerIdentificationInput) {
    const validated = await this.validate(input);

    const survey = await this.repository.startOrResumeSurvey({
      containerNo: validated.container.normalized,
      ownerCode: validated.container.ownerCode,
      equipmentCategory: validated.container.equipmentCategory,
      serialNo: validated.container.serialNo,
      checkDigit: validated.container.checkDigit,
      isoSizeType: validated.isoSizeType,
      isoRecord: validated.iso,
      depotCode: input.depotCode
    });

    return { ...validated, survey };
  }
}
