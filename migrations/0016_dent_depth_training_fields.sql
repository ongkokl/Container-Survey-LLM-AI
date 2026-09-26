-- Training-ready dent-depth fields extracted from the superseded measurement POC.
-- Existing geometry/camera migrations remain authoritative; this migration only
-- adds structured manual dent-depth evidence and the applicable IICL criterion.

ALTER TABLE repair_measurements ADD COLUMN deformation_direction TEXT
  CHECK (deformation_direction IN ('INWARD','OUTWARD','UNKNOWN'));

ALTER TABLE repair_measurements ADD COLUMN geometry_iso_code TEXT;

ALTER TABLE repair_measurements ADD COLUMN measurement_method TEXT
  CHECK (measurement_method IN ('SURVEYOR_MANUAL','KNOWN_CONTAINER_GEOMETRY','DEVICE_DEPTH','MODEL'));

ALTER TABLE repair_measurements ADD COLUMN applicable_iicl_limit_mm REAL;

ALTER TABLE repair_measurements ADD COLUMN iicl_depth_status TEXT
  CHECK (iicl_depth_status IN ('WITHIN_DIMENSIONAL_CRITERION','EXCEEDS_DIMENSIONAL_CRITERION','NOT_MEASURED','NOT_APPLICABLE'));

ALTER TABLE repair_measurements ADD COLUMN iicl_criterion_source TEXT;
