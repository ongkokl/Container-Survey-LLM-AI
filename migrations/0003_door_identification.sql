CREATE TABLE IF NOT EXISTS container_identification_attempts (
  id TEXT PRIMARY KEY,
  door_photo_r2_key TEXT NOT NULL UNIQUE,
  content_type TEXT NOT NULL,
  image_size_bytes INTEGER NOT NULL,
  model_name TEXT,
  raw_response_json TEXT,
  ocr_container_no TEXT,
  ocr_iso_size_type TEXT,
  container_confidence REAL,
  iso_confidence REAL,
  container_format_valid INTEGER NOT NULL DEFAULT 0 CHECK (container_format_valid IN (0, 1)),
  container_check_digit_valid INTEGER NOT NULL DEFAULT 0 CHECK (container_check_digit_valid IN (0, 1)),
  expected_check_digit INTEGER,
  iso_code_found INTEGER NOT NULL DEFAULT 0 CHECK (iso_code_found IN (0, 1)),
  status TEXT NOT NULL CHECK (
    status IN ('ANALYSED', 'NEEDS_REVIEW', 'CONFIRMED', 'FAILED')
  ),
  error_message TEXT,
  final_container_no TEXT,
  final_iso_size_type TEXT,
  survey_id TEXT,
  gate_cycle_id TEXT,
  created_at TEXT NOT NULL,
  confirmed_at TEXT,
  FOREIGN KEY (survey_id) REFERENCES surveys(id),
  FOREIGN KEY (gate_cycle_id) REFERENCES gate_cycles(id)
);

CREATE INDEX IF NOT EXISTS idx_identification_attempts_status
  ON container_identification_attempts(status, created_at DESC);
