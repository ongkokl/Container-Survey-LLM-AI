-- One active definition per equipment/code; older versions remain as history.
-- Source precedence follows 0006: the equipment-specific IICL ECS guide takes
-- precedence over the older generic COA visualisation for these known pairs.
-- Only retire the exact known COA rows when their verified successor exists.
UPDATE component_codes
SET active=0,
    effective_to=CASE WHEN equipment_type='GP' THEN '2025-06-10' ELSE '2025-10-06' END
WHERE active=1 AND standard_name='COA CEDEX Syntax' AND standard_version='2.0'
  AND (
    (equipment_type='GP' AND component_code='RLA' AND component_name='Rail Assembly') OR
    (equipment_type='RF' AND component_code='PIC' AND component_name='Panel Inner Cladding') OR
    (equipment_type='RF' AND component_code='POC' AND component_name='Panel Outer Cladding')
  )
  AND EXISTS (
    SELECT 1 FROM component_codes verified
    WHERE verified.equipment_type=component_codes.equipment_type
      AND verified.component_code=component_codes.component_code
      AND verified.active=1 AND verified.standard_name='IICL ECS'
      AND (
        (verified.equipment_type='GP' AND verified.standard_version='2025-06-11'
          AND verified.effective_from='2025-06-11' AND verified.component_name='Rail Assembly') OR
        (verified.equipment_type='RF' AND verified.standard_version='2025-10-07'
          AND verified.effective_from='2025-10-07'
          AND ((verified.component_code='PIC' AND verified.component_name='Panel Inner Cladding')
            OR (verified.component_code='POC' AND verified.component_name='Panel - Outer Cladding')))
      )
  );

-- Deliberately fail on any other unresolved active duplicate. Do not pick a
-- winner by date, text ordering, or row ID when the intended meaning is unknown.
CREATE UNIQUE INDEX ux_component_codes_one_active
ON component_codes(equipment_type,component_code) WHERE active=1;

-- SQLite OR REPLACE can delete the conflicting row before inserting a new one.
-- Reject this for existing versions and competing active definitions so future
-- seed/import changes must retire the current row and INSERT a new version.
CREATE TRIGGER component_codes_guard_insert
BEFORE INSERT ON component_codes
WHEN EXISTS (
  SELECT 1 FROM component_codes current
  WHERE current.equipment_type=NEW.equipment_type
    AND current.component_code=NEW.component_code
    AND (current.standard_version=NEW.standard_version OR (current.active=1 AND NEW.active=1))
)
BEGIN
  SELECT RAISE(ABORT,'Component version already exists or another version is active. Retire the current definition and insert a new version; do not use REPLACE.');
END;

CREATE TRIGGER component_codes_guard_update
BEFORE UPDATE ON component_codes
WHEN EXISTS (
  SELECT 1 FROM component_codes current
  WHERE current.equipment_type=NEW.equipment_type
    AND current.component_code=NEW.component_code
    AND (current.standard_version=NEW.standard_version OR (current.active=1 AND NEW.active=1))
    AND NOT (current.equipment_type=OLD.equipment_type
      AND current.component_code=OLD.component_code AND current.standard_version=OLD.standard_version)
)
BEGIN
  SELECT RAISE(ABORT,'Another component version occupies this key or is active. Resolve the definition explicitly; do not use REPLACE.');
END;
