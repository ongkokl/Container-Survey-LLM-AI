-- Physical CEDEX structure calibration for fixed Door/Front cameras.
-- This replaces the PoC percentage bands for D/F with admin-marked physical
-- structural boundaries on the calibrated end-face plane.
--
-- Door/Front structure is keyed by equipment type + container height, not
-- container length, so the same 8'6" or 9'6" end-face structure can be reused
-- across 20 ft and 40 ft containers when the fixed camera/stop geometry is the same.

CREATE TABLE IF NOT EXISTS fixed_camera_end_structure_calibrations (
  camera_id TEXT NOT NULL CHECK (camera_id IN ('D','F')),
  container_face TEXT NOT NULL CHECK (container_face IN ('DOOR','FRONT')),
  equipment_type TEXT NOT NULL CHECK (equipment_type IN ('GP','RF')),
  height_mm INTEGER NOT NULL CHECK (height_mm > 0),
  position_boundaries_json TEXT NOT NULL,
  vertical_boundaries_json TEXT NOT NULL,
  calibration_version INTEGER NOT NULL DEFAULT 1,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (camera_id, equipment_type, height_mm)
);

CREATE INDEX IF NOT EXISTS idx_fixed_camera_end_structure_lookup
  ON fixed_camera_end_structure_calibrations(camera_id, equipment_type, height_mm, active);
