-- Phase 5.2 POC: known container geometry for image-based X/Y measurement.
-- External ISO dimensions are reference geometry only. Dent depth (Z) remains
-- a manual/3D measurement in this POC.

CREATE TABLE IF NOT EXISTS container_geometry_profiles (
  iso_code TEXT PRIMARY KEY,
  equipment_type TEXT NOT NULL CHECK (equipment_type IN ('GP','RF')),
  length_mm INTEGER NOT NULL,
  width_mm INTEGER NOT NULL,
  height_mm INTEGER NOT NULL,
  geometry_source TEXT NOT NULL,
  geometry_version TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1))
);

INSERT OR REPLACE INTO container_geometry_profiles
  (iso_code,equipment_type,length_mm,width_mm,height_mm,geometry_source,geometry_version,active)
VALUES
  ('22G1','GP',6058,2438,2591,'ISO external nominal dimensions','POC-1',1),
  ('42G1','GP',12192,2438,2591,'ISO external nominal dimensions','POC-1',1),
  ('45G1','GP',12192,2438,2896,'ISO external nominal dimensions','POC-1',1),
  ('22R1','RF',6058,2438,2591,'ISO external nominal dimensions','POC-1',1),
  ('42R1','RF',12192,2438,2591,'ISO external nominal dimensions','POC-1',1),
  ('45R1','RF',12192,2438,2896,'ISO external nominal dimensions','POC-1',1);
