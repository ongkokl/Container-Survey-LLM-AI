-- Phase 5.1: training-ready repair measurement capture.
--
-- Repair suitability is no longer inferred directly from the image. GP.xlsx
-- supplies the valid component+damage+repair combinations; the surveyor records
-- measurements/extent and confirms the final repair. These structured labels
-- are retained for future repair-decision model training.

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
