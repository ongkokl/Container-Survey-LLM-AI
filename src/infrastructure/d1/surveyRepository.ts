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

const ACTIVE_STATUSES: ActiveGateCycleStatus[] = [
  "CREATED",
  "IDENTIFIED",
  "SURVEYING",
  "REVIEW_REQUIRED"
];

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
}
