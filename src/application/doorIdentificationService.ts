import {
  normalizeContainerNumber,
  parseAndValidateContainerNumber
} from "../domain/container/iso6346";
import {
  DoorIdentityVisionProvider,
  normalizeIsoSizeTypeCode
} from "../domain/vision/doorIdentity";
import {
  IdentificationAttemptRepository,
  SurveyRepository
} from "../infrastructure/d1/surveyRepository";
import { PhotoStore } from "../infrastructure/r2/photoStore";

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif"
]);

export class DoorIdentificationError extends Error {
  constructor(
    message: string,
    readonly code:
      | "IMAGE_REQUIRED"
      | "IMAGE_TOO_LARGE"
      | "UNSUPPORTED_IMAGE"
      | "ATTEMPT_NOT_FOUND"
      | "IDENTITY_NOT_VALID"
  ) {
    super(message);
  }
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  let binary = "";

  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }

  return btoa(binary);
}

export class DoorIdentificationService {
  constructor(
    private readonly vision: DoorIdentityVisionProvider,
    private readonly photos: PhotoStore,
    private readonly attempts: IdentificationAttemptRepository,
    private readonly surveys: SurveyRepository
  ) {}

  async analyse(file: File) {
    if (!file || file.size === 0) {
      throw new DoorIdentificationError("A door photo is required.", "IMAGE_REQUIRED");
    }

    if (file.size > MAX_IMAGE_BYTES) {
      throw new DoorIdentificationError(
        "Door photo is too large. Capture or upload an image below 8 MB.",
        "IMAGE_TOO_LARGE"
      );
    }

    const contentType = (file.type || "image/jpeg").toLowerCase();
    if (!ALLOWED_IMAGE_TYPES.has(contentType)) {
      throw new DoorIdentificationError(
        "Unsupported image type. Use JPEG, PNG, WebP, HEIC or HEIF.",
        "UNSUPPORTED_IMAGE"
      );
    }

    const attemptId = crypto.randomUUID();
    const bytes = await file.arrayBuffer();
    const stored = await this.photos.saveDoorIdentityPhoto({
      attemptId,
      bytes,
      contentType
    });

    try {
      const imageDataUrl =
        "data:" + contentType + ";base64," + arrayBufferToBase64(bytes);

      const vision = await this.vision.extractIdentity({
        imageDataUrl,
        mimeType: contentType
      });

      const containerNumber = normalizeContainerNumber(
        vision.prediction.containerNumberRaw ?? ""
      );
      const isoSizeType = normalizeIsoSizeTypeCode(
        vision.prediction.isoSizeTypeRaw
      );
      const parsedContainer = parseAndValidateContainerNumber(containerNumber);
      const isoRecord = isoSizeType
        ? await this.surveys.findIsoSizeType(isoSizeType)
        : null;

      const needsReview =
        !parsedContainer.validCheckDigit ||
        !isoRecord ||
        vision.prediction.containerNumberConfidence === null ||
        vision.prediction.isoSizeTypeConfidence === null ||
        vision.prediction.containerNumberConfidence < 0.8 ||
        vision.prediction.isoSizeTypeConfidence < 0.8;

      await this.attempts.create({
        id: attemptId,
        doorPhotoR2Key: stored.key,
        contentType: stored.contentType,
        imageSizeBytes: stored.size,
        modelName: vision.modelName,
        rawResponseJson: JSON.stringify(vision.rawResponse),
        ocrContainerNo: containerNumber || null,
        ocrIsoSizeType: isoSizeType || null,
        containerConfidence: vision.prediction.containerNumberConfidence,
        isoConfidence: vision.prediction.isoSizeTypeConfidence,
        containerFormatValid: parsedContainer.validFormat,
        containerCheckDigitValid: parsedContainer.validCheckDigit,
        expectedCheckDigit: parsedContainer.expectedCheckDigit,
        isoCodeFound: Boolean(isoRecord),
        status: needsReview ? "NEEDS_REVIEW" : "ANALYSED",
        errorMessage: null
      });

      return {
        attemptId,
        status: needsReview ? "NEEDS_REVIEW" : "ANALYSED",
        detected: {
          containerNo: containerNumber || null,
          isoSizeType: isoSizeType || null,
          containerConfidence: vision.prediction.containerNumberConfidence,
          isoSizeTypeConfidence: vision.prediction.isoSizeTypeConfidence
        },
        validation: {
          containerFormatValid: parsedContainer.validFormat,
          containerCheckDigitValid: parsedContainer.validCheckDigit,
          expectedCheckDigit: parsedContainer.expectedCheckDigit,
          isoCodeFound: Boolean(isoRecord)
        },
        derived: isoRecord
          ? {
              containerType: isoRecord.app_container_type,
              lengthFt: isoRecord.length_ft,
              height: isoRecord.height_description,
              equipmentFamily: isoRecord.equipment_family
            }
          : null,
        notes: vision.prediction.notes
      };
    } catch (error) {
      await this.attempts.create({
        id: attemptId,
        doorPhotoR2Key: stored.key,
        contentType: stored.contentType,
        imageSizeBytes: stored.size,
        modelName: null,
        rawResponseJson: null,
        ocrContainerNo: null,
        ocrIsoSizeType: null,
        containerConfidence: null,
        isoConfidence: null,
        containerFormatValid: false,
        containerCheckDigitValid: false,
        expectedCheckDigit: null,
        isoCodeFound: false,
        status: "FAILED",
        errorMessage: error instanceof Error ? error.message : "Vision OCR failed."
      });
      throw error;
    }
  }

  async confirm(input: {
    attemptId: string;
    containerNo: string;
    isoSizeType: string;
    depotCode?: string | null;
  }) {
    const attempt = await this.attempts.findById(input.attemptId);
    if (!attempt) {
      throw new DoorIdentificationError(
        "Door identification attempt was not found.",
        "ATTEMPT_NOT_FOUND"
      );
    }

    const containerNumber = parseAndValidateContainerNumber(input.containerNo);
    const isoSizeType = normalizeIsoSizeTypeCode(input.isoSizeType);
    const isoRecord = await this.surveys.findIsoSizeType(isoSizeType);

    if (!containerNumber.validCheckDigit || !isoRecord) {
      throw new DoorIdentificationError(
        "Confirm a valid ISO 6346 container number and a recognised ISO size/type code.",
        "IDENTITY_NOT_VALID"
      );
    }

    const survey = await this.surveys.startOrResumeSurvey({
      containerNo: containerNumber.normalized,
      ownerCode: containerNumber.ownerCode,
      equipmentCategory: containerNumber.equipmentCategory,
      serialNo: containerNumber.serialNo,
      checkDigit: containerNumber.checkDigit,
      isoSizeType,
      isoRecord,
      depotCode: input.depotCode
    });

    const photoId = await this.surveys.attachDoorPhoto({
      surveyId: survey.surveyId,
      r2Key: attempt.door_photo_r2_key,
      contentType: attempt.content_type,
      capturedAt: attempt.created_at
    });

    await this.attempts.confirm({
      id: input.attemptId,
      finalContainerNo: containerNumber.normalized,
      finalIsoSizeType: isoSizeType,
      surveyId: survey.surveyId,
      gateCycleId: survey.gateCycleId
    });

    return {
      survey,
      photoId,
      container: {
        containerNo: containerNumber.normalized,
        isoSizeType,
        containerType: isoRecord.app_container_type,
        lengthFt: isoRecord.length_ft,
        height: isoRecord.height_description,
        equipmentFamily: isoRecord.equipment_family
      }
    };
  }
}
