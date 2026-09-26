-- Phase 5: conservative repair-method recommendation.
--
-- The application already stores repair_codes and final_repair_code. This
-- migration adds component-level repair applicability derived from the
-- user-provided depot tariff. It intentionally does NOT invent damage-to-repair
-- combinations: the tariff contains component + location + repair method, but
-- no damage-code column. The AI recommendation therefore remains advisory and
-- requires surveyor confirmation.

CREATE TABLE IF NOT EXISTS component_repair_rules (
  equipment_type TEXT NOT NULL CHECK (equipment_type IN ('GP','RF')),
  component_code TEXT NOT NULL,
  repair_code TEXT NOT NULL,
  source_reference TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  PRIMARY KEY (equipment_type,component_code,repair_code)
);

CREATE INDEX IF NOT EXISTS idx_component_repair_rules_lookup
ON component_repair_rules(equipment_type,component_code,active,repair_code);

INSERT OR REPLACE INTO repair_codes
(repair_code,repair_name,description,standard_version,source_reference,active)
VALUES
('FT','Refit','Refit a removable component to its proper position.','ISO 9897-1:2014','ISO 9897-1 general-purpose container repair codes',1),
('GS','Straighten','Repair by straightening.','ISO 9897-1:2014','ISO 9897-1 general-purpose container repair codes',1),
('GT','Remove glue and tape','Remove glue and tape from the affected surface.','ISO 9897-1:2014','ISO 9897-1 general-purpose container repair codes',1),
('GW','Straighten and weld','Straighten a component and re-weld it into position.','ISO 9897-1:2014','ISO 9897-1 general-purpose container repair codes',1),
('PA','Paint','Apply paint.','ISO 9897-1:2014','ISO 9897-1 general-purpose container repair codes',1),
('PT','Patch','Remove and replace part of a component profile over part of its length and/or width and secure the patch.','ISO 9897-1:2014','ISO 9897-1 general-purpose container repair codes',1),
('RM','Remove without replacement','Remove a component without replacing it.','ISO 9897-1:2014','ISO 9897-1 general-purpose container repair codes',1),
('RP','Replace','Remove and replace the complete cross-sectional profile of a component over its entire length and width.','ISO 9897-1:2014','ISO 9897-1 general-purpose container repair codes',1),
('WD','Weld','Repair by welding.','ISO 9897-1:2014','ISO 9897-1 general-purpose container repair codes',1);

DELETE FROM component_repair_rules
WHERE equipment_type='GP' AND component_code='PAA';

INSERT INTO component_repair_rules
(equipment_type,component_code,repair_code,source_reference,active)
SELECT 'GP','PAA',value,
       'User-provided Tariff_format_1_Location_Filled.xls: PAA EXXX/IXXX, Ctnr_type SD',
       1
FROM json_each('["FT","GS","GT","GW","PA","PT","RM","RP","WD"]');
