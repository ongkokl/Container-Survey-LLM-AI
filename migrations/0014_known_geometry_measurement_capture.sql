-- Phase 5.2 POC: known container geometry + capture provenance.
--
-- Geometry is keyed by ISO size code (first two characters of the 4-character
-- ISO size/type code) so the same physical envelope can be reused across
-- GP/RF group codes. These are nominal external ISO container dimensions and
-- are the starting reference for perspective/scale calibration only.
--
-- 22 = 20 ft, 8 ft 6 in
-- 25 = 20 ft, 9 ft 6 in
-- 42 = 40 ft, 8 ft 6 in
-- 45 = 40 ft, 9 ft 6 in

CREATE TABLE IF NOT EXISTS container_geometry_profiles (
  equipment_type TEXT NOT NULL CHECK (equipment_type IN ('GP','RF')),
  iso_size_code TEXT NOT NULL,
  length_mm INTEGER NOT NULL,
  width_mm INTEGER NOT NULL,
  height_mm INTEGER NOT NULL,
  geometry_version TEXT NOT NULL DEFAULT 'POC-1',
  source_reference TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  created_at TEXT NOT NULL,
  PRIMARY KEY (equipment_type, iso_size_code, geometry_version)
);

INSERT OR REPLACE INTO container_geometry_profiles
  (equipment_type,iso_size_code,length_mm,width_mm,height_mm,geometry_version,source_reference,active,created_at)
VALUES
  ('GP','22', 6058,2438,2591,'POC-1','ISO nominal external container geometry',1,datetime('now')),
  ('GP','25', 6058,2438,2896,'POC-1','ISO nominal external container geometry',1,datetime('now')),
  ('GP','42',12192,2438,2591,'POC-1','ISO nominal external container geometry',1,datetime('now')),
  ('GP','45',12192,2438,2896,'POC-1','ISO nominal external container geometry',1,datetime('now')),
  ('RF','22', 6058,2438,2591,'POC-1','ISO nominal external container geometry',1,datetime('now')),
  ('RF','25', 6058,2438,2896,'POC-1','ISO nominal external container geometry',1,datetime('now')),
  ('RF','42',12192,2438,2591,'POC-1','ISO nominal external container geometry',1,datetime('now')),
  ('RF','45',12192,2438,2896,'POC-1','ISO nominal external container geometry',1,datetime('now'));

ALTER TABLE survey_photos ADD COLUMN capture_source TEXT;
ALTER TABLE survey_photos ADD COLUMN measurement_intent INTEGER NOT NULL DEFAULT 0 CHECK (measurement_intent IN (0,1));
ALTER TABLE survey_photos ADD COLUMN measurement_quality_status TEXT NOT NULL DEFAULT 'NOT_ASSESSED'
  CHECK (measurement_quality_status IN ('NOT_ASSESSED','PENDING_GEOMETRY_CHECK','SUITABLE','UNSUITABLE'));
