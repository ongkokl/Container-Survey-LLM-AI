-- Phase 5.2: known-container-geometry measurement POC.
--
-- The overview image becomes the geometry/reference image and the close-up
-- remains the high-detail damage image for segmentation/classification.
-- These nominal external dimensions are used only as the starting geometry
-- profile for 2D size measurement. Dent depth remains surveyor/device measured.
--
-- IICL dry-van dimensional dent criteria recorded below are used only to
-- assess the measured deformation against the dimensional criterion. They do
-- not automatically determine the repair method.
-- IICL TB-013:
--   all side/front panels inward intrusion: 35 mm
--   side panels outward: 30 mm
--   front panel outward: 15 mm

CREATE TABLE IF NOT EXISTS container_geometry_profiles (
  iso_code TEXT PRIMARY KEY,
  equipment_type TEXT NOT NULL CHECK (equipment_type IN ('GP','RF')),
  length_mm INTEGER NOT NULL,
  width_mm INTEGER NOT NULL,
  height_mm INTEGER NOT NULL,
  geometry_version TEXT NOT NULL,
  source_reference TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  created_at TEXT NOT NULL
);

INSERT OR REPLACE INTO container_geometry_profiles
  (iso_code,equipment_type,length_mm,width_mm,height_mm,geometry_version,source_reference,active,created_at)
VALUES
  ('22G1','GP', 6058,2438,2591,'POC-ISO-GEOMETRY-1','ISO nominal external dimensions; POC geometry profile',1,CURRENT_TIMESTAMP),
  ('42G1','GP',12192,2438,2591,'POC-ISO-GEOMETRY-1','ISO nominal external dimensions; POC geometry profile',1,CURRENT_TIMESTAMP),
  ('45G1','GP',12192,2438,2896,'POC-ISO-GEOMETRY-1','ISO nominal external dimensions; POC geometry profile',1,CURRENT_TIMESTAMP),
  ('22R1','RF', 6058,2438,2591,'POC-ISO-GEOMETRY-1','ISO nominal external dimensions; POC geometry profile',1,CURRENT_TIMESTAMP),
  ('42R1','RF',12192,2438,2591,'POC-ISO-GEOMETRY-1','ISO nominal external dimensions; POC geometry profile',1,CURRENT_TIMESTAMP),
  ('45R1','RF',12192,2438,2896,'POC-ISO-GEOMETRY-1','ISO nominal external dimensions; POC geometry profile',1,CURRENT_TIMESTAMP);

ALTER TABLE survey_photos ADD COLUMN capture_source TEXT
  CHECK (capture_source IN ('CAMERA','GALLERY'));

ALTER TABLE survey_photos ADD COLUMN measurement_role TEXT
  CHECK (measurement_role IN ('REFERENCE_GEOMETRY','DETAIL_SEGMENTATION'));

ALTER TABLE repair_measurements ADD COLUMN deformation_direction TEXT
  CHECK (deformation_direction IN ('INWARD','OUTWARD','UNKNOWN'));

ALTER TABLE repair_measurements ADD COLUMN geometry_iso_code TEXT;

ALTER TABLE repair_measurements ADD COLUMN measurement_method TEXT
  CHECK (measurement_method IN ('SURVEYOR_MANUAL','KNOWN_CONTAINER_GEOMETRY','DEVICE_DEPTH','MODEL'));

ALTER TABLE repair_measurements ADD COLUMN applicable_iicl_limit_mm REAL;

ALTER TABLE repair_measurements ADD COLUMN iicl_depth_status TEXT
  CHECK (iicl_depth_status IN ('WITHIN_DIMENSIONAL_CRITERION','EXCEEDS_DIMENSIONAL_CRITERION','NOT_MEASURED','NOT_APPLICABLE'));
