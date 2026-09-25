export type ActiveGateCycleStatus =
  | "CREATED"
  | "IDENTIFIED"
  | "SURVEYING"
  | "REVIEW_REQUIRED";

export interface IsoSizeTypeRecord {
  iso_code: string;
  length_ft: number;
  height_description: string;
  equipment_family: string;
  app_container_type: "GP" | "RF" | string;
  description: string | null;
  active: number;
}

export interface StartSurveyInput {
  containerNo: string;
  ownerCode: string;
  equipmentCategory: string;
  serialNo: string;
  checkDigit: string;
  isoSizeType: string;
  isoRecord: IsoSizeTypeRecord;
  depotCode?: string | null;
}

export interface StartSurveyResult {
  containerId: string;
  gateCycleId: string;
  surveyId: string;
  cycleSequence: number;
  resumed: boolean;
  status: string;
}

export interface IdentificationAttemptRecord {
  id: string;
  door_photo_r2_key: string;
  content_type: string;
  image_size_bytes: number;
  model_name: string | null;
  ocr_container_no: string | null;
  ocr_iso_size_type: string | null;
  status: "ANALYSED" | "NEEDS_REVIEW" | "CONFIRMED" | "FAILED";
  created_at: string;
}

export interface CreateIdentificationAttemptInput {
  id: string;
  doorPhotoR2Key: string;
  contentType: string;
  imageSizeBytes: number;
  modelName: string | null;
  rawResponseJson: string | null;
  ocrContainerNo: string | null;
  ocrIsoSizeType: string | null;
  containerConfidence: number | null;
  isoConfidence: number | null;
  containerFormatValid: boolean;
  containerCheckDigitValid: boolean;
  expectedCheckDigit: number | null;
  isoCodeFound: boolean;
  status: "ANALYSED" | "NEEDS_REVIEW" | "FAILED";
  errorMessage: string | null;
}

const ACTIVE_STATUSES: ActiveGateCycleStatus[] = [
  "CREATED",
  "IDENTIFIED",
  "SURVEYING",
  "REVIEW_REQUIRED"
];

export class IdentificationAttemptRepository {
  constructor(private readonly db: D1Database) {}

  async create(input: CreateIdentificationAttemptInput): Promise<void> {
    const now = new Date().toISOString();

    await this.db
      .prepare(
        `INSERT INTO container_identification_attempts (
           id, door_photo_r2_key, content_type, image_size_bytes,
           model_name, raw_response_json, ocr_container_no, ocr_iso_size_type,
           container_confidence, iso_confidence, container_format_valid,
           container_check_digit_valid, expected_check_digit, iso_code_found,
           status, error_message, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        input.id,
        input.doorPhotoR2Key,
        input.contentType,
        input.imageSizeBytes,
        input.modelName,
        input.rawResponseJson,
        input.ocrContainerNo,
        input.ocrIsoSizeType,
        input.containerConfidence,
        input.isoConfidence,
        input.containerFormatValid ? 1 : 0,
        input.containerCheckDigitValid ? 1 : 0,
        input.expectedCheckDigit,
        input.isoCodeFound ? 1 : 0,
        input.status,
        input.errorMessage,
        now
      )
      .run();
  }

  async findById(id: string): Promise<IdentificationAttemptRecord | null> {
    return this.db
      .prepare(
        `SELECT id, door_photo_r2_key, content_type, image_size_bytes,
                model_name, ocr_container_no, ocr_iso_size_type, status, created_at
           FROM container_identification_attempts
          WHERE id = ?`
      )
      .bind(id)
      .first<IdentificationAttemptRecord>();
  }

  async confirm(input: {
    id: string;
    finalContainerNo: string;
    finalIsoSizeType: string;
    surveyId: string;
    gateCycleId: string;
  }): Promise<void> {
    const now = new Date().toISOString();

    await this.db
      .prepare(
        `UPDATE container_identification_attempts
            SET status = 'CONFIRMED',
                final_container_no = ?,
                final_iso_size_type = ?,
                survey_id = ?,
                gate_cycle_id = ?,
                confirmed_at = ?
          WHERE id = ?`
      )
      .bind(
        input.finalContainerNo,
        input.finalIsoSizeType,
        input.surveyId,
        input.gateCycleId,
        now,
        input.id
      )
      .run();
  }
}

export class SurveyRepository {
  constructor(private readonly db: D1Database) {}

  async findIsoSizeType(isoCode: string): Promise<IsoSizeTypeRecord | null> {
    return this.db
      .prepare(
        `SELECT iso_code, length_ft, height_description, equipment_family,
                app_container_type, description, active
           FROM iso_size_type_codes
          WHERE iso_code = ? AND active = 1`
      )
      .bind(isoCode.toUpperCase())
      .first<IsoSizeTypeRecord>();
  }

  async startOrResumeSurvey(input: StartSurveyInput): Promise<StartSurveyResult> {
    const now = new Date().toISOString();

    let container = await this.db
      .prepare("SELECT id FROM containers WHERE container_no = ?")
      .bind(input.containerNo)
      .first<{ id: string }>();

    if (!container) {
      const containerId = crypto.randomUUID();
      await this.db
        .prepare(
          `INSERT INTO containers (
             id, container_no, owner_code, equipment_category, serial_no,
             check_digit, latest_iso_size_type, created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .bind(
          containerId,
          input.containerNo,
          input.ownerCode,
          input.equipmentCategory,
          input.serialNo,
          input.checkDigit,
          input.isoSizeType,
          now,
          now
        )
        .run();

      container = { id: containerId };
    } else {
      await this.db
        .prepare(
          `UPDATE containers
              SET latest_iso_size_type = ?, updated_at = ?
            WHERE id = ?`
        )
        .bind(input.isoSizeType, now, container.id)
        .run();
    }

    const statusPlaceholders = ACTIVE_STATUSES.map(() => "?").join(", ");
    const activeCycle = await this.db
      .prepare(
        `SELECT gc.id AS gate_cycle_id, gc.cycle_sequence, gc.status,
                s.id AS survey_id
           FROM gate_cycles gc
           JOIN surveys s ON s.gate_cycle_id = gc.id
          WHERE gc.container_id = ?
            AND gc.status IN (${statusPlaceholders})
          ORDER BY gc.cycle_sequence DESC
          LIMIT 1`
      )
      .bind(container.id, ...ACTIVE_STATUSES)
      .first<{
        gate_cycle_id: string;
        cycle_sequence: number;
        status: string;
        survey_id: string;
      }>();

    if (activeCycle) {
      return {
        containerId: container.id,
        gateCycleId: activeCycle.gate_cycle_id,
        surveyId: activeCycle.survey_id,
        cycleSequence: activeCycle.cycle_sequence,
        resumed: true,
        status: activeCycle.status
      };
    }

    const sequenceRow = await this.db
      .prepare(
        "SELECT COALESCE(MAX(cycle_sequence), 0) + 1 AS next_sequence FROM gate_cycles WHERE container_id = ?"
      )
      .bind(container.id)
      .first<{ next_sequence: number }>();

    const cycleSequence = sequenceRow?.next_sequence ?? 1;
    const gateCycleId = crypto.randomUUID();
    const surveyId = crypto.randomUUID();

    await this.db.batch([
      this.db
        .prepare(
          `INSERT INTO gate_cycles (
             id, container_id, cycle_sequence, gate_in_at, depot_code,
             observed_iso_code, observed_container_type, observed_length_ft,
             observed_height_description, status, created_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'IDENTIFIED', ?)`
        )
        .bind(
          gateCycleId,
          container.id,
          cycleSequence,
          now,
          input.depotCode ?? null,
          input.isoSizeType,
          input.isoRecord.app_container_type,
          input.isoRecord.length_ft,
          input.isoRecord.height_description,
          now
        ),
      this.db
        .prepare(
          `INSERT INTO surveys (
             id, gate_cycle_id, status, started_at, created_at, updated_at
           ) VALUES (?, ?, 'IDENTIFIED', ?, ?, ?)`
        )
        .bind(surveyId, gateCycleId, now, now, now)
    ]);

    return {
      containerId: container.id,
      gateCycleId,
      surveyId,
      cycleSequence,
      resumed: false,
      status: "IDENTIFIED"
    };
  }

  async attachDoorPhoto(input: {
    surveyId: string;
    r2Key: string;
    contentType: string;
    capturedAt: string;
  }): Promise<string> {
    const existing = await this.db
      .prepare("SELECT id FROM survey_photos WHERE r2_key = ?")
      .bind(input.r2Key)
      .first<{ id: string }>();

    if (existing) {
      return existing.id;
    }

    const now = new Date().toISOString();
    const photoId = crypto.randomUUID();

    await this.db.batch([
      this.db
        .prepare(
          `INSERT INTO survey_photos (
             id, survey_id, finding_id, photo_role, r2_key,
             content_type, captured_at, created_at
           ) VALUES (?, ?, NULL, 'DOOR_IDENTITY', ?, ?, ?, ?)`
        )
        .bind(
          photoId,
          input.surveyId,
          input.r2Key,
          input.contentType,
          input.capturedAt,
          now
        ),
      this.db
        .prepare(
          `UPDATE surveys
              SET door_photo_r2_key = ?, updated_at = ?
            WHERE id = ?`
        )
        .bind(input.r2Key, now, input.surveyId)
    ]);

    return photoId;
  }
}
