ALTER TABLE findings ADD COLUMN container_face TEXT
  CHECK (container_face IN ('LEFT','RIGHT','FRONT','DOOR','ROOF','FLOOR'));

CREATE INDEX IF NOT EXISTS idx_findings_survey_sequence
  ON findings(survey_id, finding_sequence);
