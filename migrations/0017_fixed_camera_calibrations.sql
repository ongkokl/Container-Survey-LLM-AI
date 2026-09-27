-- POC fixed-camera calibration.
-- Each R/L camera is calibrated once for a known container length/height profile.
-- Surveyors do not mark container corners during normal operation.

CREATE TABLE IF NOT EXISTS fixed_camera_calibrations (
  camera_id TEXT NOT NULL CHECK (camera_id IN ('R','L','D','T')),
  container_face TEXT NOT NULL CHECK (container_face IN ('LEFT','RIGHT','DOOR','ROOF')),
  length_ft INTEGER NOT NULL CHECK (length_ft IN (20,40)),
  height_mm INTEGER NOT NULL CHECK (height_mm > 0),
  door_end_in_image TEXT CHECK (door_end_in_image IN ('LEFT','RIGHT')),
  corners_json TEXT NOT NULL,
  calibration_version INTEGER NOT NULL DEFAULT 1,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (camera_id, length_ft, height_mm)
);

CREATE INDEX IF NOT EXISTS idx_fixed_camera_calibration_lookup
  ON fixed_camera_calibrations(camera_id, length_ft, height_mm, active);
