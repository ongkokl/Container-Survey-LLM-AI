PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS containers (
  id TEXT PRIMARY KEY,
  container_no TEXT NOT NULL UNIQUE,
  owner_code TEXT NOT NULL,
  equipment_category TEXT NOT NULL,
  serial_no TEXT NOT NULL,
  check_digit TEXT NOT NULL,
  latest_iso_size_type TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS iso_size_type_codes (
  iso_code TEXT PRIMARY KEY,
  length_ft INTEGER NOT NULL,
  height_description TEXT NOT NULL,
  equipment_family TEXT NOT NULL,
  app_container_type TEXT NOT NULL,
  description TEXT,
  standard_version TEXT NOT NULL DEFAULT 'ISO 6346',
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1))
);

CREATE TABLE IF NOT EXISTS gate_cycles (
  id TEXT PRIMARY KEY,
  container_id TEXT NOT NULL,
  cycle_sequence INTEGER NOT NULL,
  external_gate_txn_id TEXT,
  gate_in_at TEXT NOT NULL,
  gate_out_at TEXT,
  depot_code TEXT,
  observed_iso_code TEXT NOT NULL,
  observed_container_type TEXT NOT NULL,
  observed_length_ft INTEGER NOT NULL,
  observed_height_description TEXT NOT NULL,
  status TEXT NOT NULL CHECK (
    status IN (
      'CREATED', 'IDENTIFIED', 'SURVEYING', 'REVIEW_REQUIRED',
      'COMPLETED', 'CANCELLED', 'ABANDONED'
    )
  ),
  created_at TEXT NOT NULL,
  completed_at TEXT,
  FOREIGN KEY (container_id) REFERENCES containers(id),
  UNIQUE (container_id, cycle_sequence)
);

CREATE INDEX IF NOT EXISTS idx_gate_cycles_container
  ON gate_cycles(container_id, cycle_sequence DESC);

CREATE UNIQUE INDEX IF NOT EXISTS ux_gate_cycle_external_txn
  ON gate_cycles(depot_code, external_gate_txn_id)
  WHERE external_gate_txn_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS ux_gate_cycle_one_active_per_container
  ON gate_cycles(container_id)
  WHERE status IN ('CREATED', 'IDENTIFIED', 'SURVEYING', 'REVIEW_REQUIRED');

CREATE TABLE IF NOT EXISTS surveys (
  id TEXT PRIMARY KEY,
  gate_cycle_id TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL CHECK (
    status IN (
      'CREATED', 'IDENTIFIED', 'SURVEYING', 'REVIEW_REQUIRED',
      'COMPLETED', 'CANCELLED', 'ABANDONED'
    )
  ),
  door_photo_r2_key TEXT,
  started_at TEXT NOT NULL,
  completed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (gate_cycle_id) REFERENCES gate_cycles(id)
);

CREATE TABLE IF NOT EXISTS findings (
  id TEXT PRIMARY KEY,
  survey_id TEXT NOT NULL,
  finding_sequence INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (
    status IN (
      'CAPTURED', 'ANALYSING', 'AI_SUGGESTED',
      'REVIEW_REQUIRED', 'APPROVED', 'CORRECTED', 'CANCELLED'
    )
  ),
  final_component_code TEXT,
  final_damage_code TEXT,
  final_repair_code TEXT,
  final_location_code TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (survey_id) REFERENCES surveys(id),
  UNIQUE (survey_id, finding_sequence)
);

CREATE TABLE IF NOT EXISTS survey_photos (
  id TEXT PRIMARY KEY,
  survey_id TEXT NOT NULL,
  finding_id TEXT,
  photo_role TEXT NOT NULL CHECK (
    photo_role IN (
      'DOOR_IDENTITY', 'FACE_OVERVIEW', 'COMPONENT_CLOSEUP',
      'DAMAGE_CLOSEUP', 'REPAIR_REFERENCE'
    )
  ),
  r2_key TEXT NOT NULL UNIQUE,
  width INTEGER,
  height INTEGER,
  content_type TEXT,
  captured_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (survey_id) REFERENCES surveys(id),
  FOREIGN KEY (finding_id) REFERENCES findings(id)
);

CREATE TABLE IF NOT EXISTS annotations (
  id TEXT PRIMARY KEY,
  photo_id TEXT NOT NULL,
  annotation_type TEXT NOT NULL CHECK (
    annotation_type IN ('CONTAINER_FACE', 'COMPONENT', 'DAMAGE', 'LOCATION_POINT')
  ),
  geometry_type TEXT NOT NULL CHECK (
    geometry_type IN ('POINT', 'BOX', 'POLYGON', 'LINE')
  ),
  geometry_json TEXT NOT NULL,
  created_by TEXT NOT NULL DEFAULT 'SURVEYOR',
  created_at TEXT NOT NULL,
  FOREIGN KEY (photo_id) REFERENCES survey_photos(id)
);

CREATE TABLE IF NOT EXISTS component_codes (
  equipment_type TEXT NOT NULL,
  component_code TEXT NOT NULL,
  component_name TEXT NOT NULL,
  description TEXT,
  standard_name TEXT NOT NULL DEFAULT 'CEDEX/ECS',
  standard_version TEXT NOT NULL,
  effective_from TEXT,
  effective_to TEXT,
  source_reference TEXT,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  PRIMARY KEY (equipment_type, component_code, standard_version)
);

CREATE TABLE IF NOT EXISTS damage_codes (
  damage_code TEXT NOT NULL,
  damage_name TEXT NOT NULL,
  description TEXT,
  standard_version TEXT NOT NULL,
  source_reference TEXT,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  PRIMARY KEY (damage_code, standard_version)
);

CREATE TABLE IF NOT EXISTS repair_codes (
  repair_code TEXT NOT NULL,
  repair_name TEXT NOT NULL,
  description TEXT,
  standard_version TEXT NOT NULL,
  source_reference TEXT,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  PRIMARY KEY (repair_code, standard_version)
);

CREATE TABLE IF NOT EXISTS component_damage_repair_rules (
  id TEXT PRIMARY KEY,
  equipment_type TEXT NOT NULL,
  component_code TEXT NOT NULL,
  damage_code TEXT NOT NULL,
  repair_code TEXT NOT NULL,
  standard_version TEXT NOT NULL,
  effective_from TEXT,
  effective_to TEXT,
  source_reference TEXT,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  UNIQUE (
    equipment_type, component_code, damage_code, repair_code, standard_version
  )
);

CREATE INDEX IF NOT EXISTS idx_cedex_rule_lookup
  ON component_damage_repair_rules(
    equipment_type, component_code, damage_code, active
  );

CREATE TABLE IF NOT EXISTS model_versions (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  model_name TEXT NOT NULL,
  model_version TEXT NOT NULL,
  purpose TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS prompt_versions (
  id TEXT PRIMARY KEY,
  prompt_name TEXT NOT NULL,
  prompt_version TEXT NOT NULL,
  content_hash TEXT,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS ai_runs (
  id TEXT PRIMARY KEY,
  survey_id TEXT NOT NULL,
  finding_id TEXT,
  task_type TEXT NOT NULL,
  model_version_id TEXT,
  prompt_version_id TEXT,
  request_context_json TEXT,
  response_json TEXT,
  started_at TEXT NOT NULL,
  completed_at TEXT,
  FOREIGN KEY (survey_id) REFERENCES surveys(id),
  FOREIGN KEY (finding_id) REFERENCES findings(id),
  FOREIGN KEY (model_version_id) REFERENCES model_versions(id),
  FOREIGN KEY (prompt_version_id) REFERENCES prompt_versions(id)
);

CREATE TABLE IF NOT EXISTS ai_predictions (
  id TEXT PRIMARY KEY,
  ai_run_id TEXT NOT NULL,
  prediction_type TEXT NOT NULL CHECK (
    prediction_type IN ('CONTAINER_ID', 'ISO_SIZE_TYPE', 'COMPONENT', 'DAMAGE', 'REPAIR', 'LOCATION')
  ),
  selected_code TEXT,
  confidence REAL,
  status TEXT NOT NULL DEFAULT 'SUGGESTED',
  created_at TEXT NOT NULL,
  FOREIGN KEY (ai_run_id) REFERENCES ai_runs(id)
);

CREATE TABLE IF NOT EXISTS prediction_candidates (
  id TEXT PRIMARY KEY,
  prediction_id TEXT NOT NULL,
  candidate_code TEXT NOT NULL,
  rank INTEGER NOT NULL,
  confidence REAL,
  evidence_json TEXT,
  FOREIGN KEY (prediction_id) REFERENCES ai_predictions(id),
  UNIQUE (prediction_id, rank)
);

CREATE TABLE IF NOT EXISTS surveyor_decisions (
  id TEXT PRIMARY KEY,
  finding_id TEXT NOT NULL,
  prediction_id TEXT,
  field_type TEXT NOT NULL CHECK (
    field_type IN ('COMPONENT', 'DAMAGE', 'REPAIR', 'LOCATION')
  ),
  ai_value TEXT,
  final_value TEXT NOT NULL,
  decision TEXT NOT NULL CHECK (
    decision IN ('APPROVED', 'REJECTED', 'CORRECTED')
  ),
  correction_reason TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (finding_id) REFERENCES findings(id),
  FOREIGN KEY (prediction_id) REFERENCES ai_predictions(id)
);

CREATE TABLE IF NOT EXISTS training_candidates (
  id TEXT PRIMARY KEY,
  finding_id TEXT NOT NULL,
  surveyor_decision_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (
    status IN ('PENDING', 'VERIFIED', 'REJECTED', 'DUPLICATE')
  ),
  verified_at TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (finding_id) REFERENCES findings(id),
  FOREIGN KEY (surveyor_decision_id) REFERENCES surveyor_decisions(id)
);
