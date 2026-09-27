-- Extend fixed-camera calibration from R/L/D/T to all six POC faces:
-- R right, L left, D door, F front, T roof/top, B floor/bottom.
-- Existing calibration rows are preserved.

CREATE TABLE fixed_camera_calibrations_v2 (
  camera_id TEXT NOT NULL CHECK (camera_id IN ('R','L','D','F','T','B')),
  container_face TEXT NOT NULL CHECK (container_face IN ('LEFT','RIGHT','DOOR','FRONT','ROOF','FLOOR')),
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

INSERT INTO fixed_camera_calibrations_v2
  (camera_id,container_face,length_ft,height_mm,door_end_in_image,corners_json,calibration_version,active,created_at,updated_at)
SELECT
  camera_id,container_face,length_ft,height_mm,door_end_in_image,corners_json,calibration_version,active,created_at,updated_at
FROM fixed_camera_calibrations;

DROP TABLE fixed_camera_calibrations;
ALTER TABLE fixed_camera_calibrations_v2 RENAME TO fixed_camera_calibrations;

CREATE INDEX IF NOT EXISTS idx_fixed_camera_calibration_lookup
  ON fixed_camera_calibrations(camera_id, length_ft, height_mm, active);
