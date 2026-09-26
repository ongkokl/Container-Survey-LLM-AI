-- Phase 5.1: training-ready repair measurement capture.
--
-- GP.xlsx remains the authoritative constraint for valid component+damage+
-- repair combinations. These optional surveyor measurements are stored as
-- structured evidence so a future repair-decision model can learn from
-- measured damage plus the surveyor-confirmed repair method.

CREATE TABLE IF NOT EXISTS repair_measurements (
  finding_id TEXT PRIMARY KEY,
  damage_length_cm REAL,
  damage_width_cm REAL,
  damage_depth_cm REAL,
  corrugations_affected INTEGER,
  measurement_source TEXT NOT NULL DEFAULT 'SURVEYOR'
    CHECK (measurement_source IN ('SURVEYOR','DEVICE','MODEL')),
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (finding_id) REFERENCES findings(id)
);
