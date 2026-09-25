-- Phase 4 POC seed.
-- Component names below are limited to codes verified against the supplied
-- IICL/COA component reference material. This is intentionally not a complete
-- CEDEX master.

INSERT OR REPLACE INTO component_codes
(equipment_type,component_code,component_name,description,standard_name,standard_version,effective_from,source_reference,active)
VALUES
('GP','PAA','Panel Assembly',NULL,'IICL ECS','2025-06-11','2025-06-11','IICL Dry Van ECS revised 11 June 2025',1),
('GP','PSC','Panel Steel Corrugated',NULL,'COA CEDEX Syntax','2.0',NULL,'COA CEDEX Syntax Visualisation Component Codes V2.0',1),
('GP','HGA','Hinge Assembly',NULL,'COA CEDEX Syntax','2.0',NULL,'COA CEDEX Syntax Visualisation Component Codes V2.0',1),
('GP','HGB','Hinge Blade',NULL,'COA CEDEX Syntax','2.0',NULL,'COA CEDEX Syntax Visualisation Component Codes V2.0',1),
('GP','HGP','Hinge Pin',NULL,'COA CEDEX Syntax','2.0',NULL,'COA CEDEX Syntax Visualisation Component Codes V2.0',1),
('GP','CPL','Corner Post Hinge Lug',NULL,'COA CEDEX Syntax','2.0',NULL,'COA CEDEX Syntax Visualisation Component Codes V2.0',1),
('GP','LBR','Locking Bar Rod',NULL,'COA CEDEX Syntax','2.0',NULL,'COA CEDEX Syntax Visualisation Component Codes V2.0',1),
('GP','LBB','Locking Bar Bracket',NULL,'COA CEDEX Syntax','2.0',NULL,'COA CEDEX Syntax Visualisation Component Codes V2.0',1),
('GP','LBG','Locking Bar Guide',NULL,'COA CEDEX Syntax','2.0',NULL,'COA CEDEX Syntax Visualisation Component Codes V2.0',1),
('GP','LBC','Locking Bar Cam',NULL,'COA CEDEX Syntax','2.0',NULL,'COA CEDEX Syntax Visualisation Component Codes V2.0',1),
('GP','LBH','Locking Bar Handle',NULL,'COA CEDEX Syntax','2.0',NULL,'COA CEDEX Syntax Visualisation Component Codes V2.0',1),
('GP','LBL','Locking Bar Lug',NULL,'COA CEDEX Syntax','2.0',NULL,'COA CEDEX Syntax Visualisation Component Codes V2.0',1),
('GP','LHH','Locking bar handle hub',NULL,'COA CEDEX Syntax','2.0',NULL,'COA CEDEX Syntax Visualisation Component Codes V2.0',1),
('GP','GTA','Gasket Assembly',NULL,'COA CEDEX Syntax','2.0',NULL,'COA CEDEX Syntax Visualisation Component Codes V2.0',1),
('GP','RLA','Rail Assembly',NULL,'COA CEDEX Syntax','2.0',NULL,'COA CEDEX Syntax Visualisation Component Codes V2.0',1),
('RF','PAA','Panel Assembly',NULL,'COA CEDEX Syntax','2.0',NULL,'COA CEDEX Syntax Visualisation Component Codes V2.0 - Reefer Box',1),
('RF','PIC','Panel Inner Cladding',NULL,'COA CEDEX Syntax','2.0',NULL,'COA CEDEX Syntax Visualisation Component Codes V2.0 - Reefer Box',1),
('RF','POC','Panel Outer Cladding',NULL,'COA CEDEX Syntax','2.0',NULL,'COA CEDEX Syntax Visualisation Component Codes V2.0 - Reefer Box',1),
('RF','PIM','Insulation Material',NULL,'COA CEDEX Syntax','2.0',NULL,'COA CEDEX Syntax Visualisation Component Codes V2.0 - Reefer Box',1),
('RF','PIS','Panel Internal Stiffener',NULL,'COA CEDEX Syntax','2.0',NULL,'COA CEDEX Syntax Visualisation Component Codes V2.0 - Reefer Box',1);

CREATE INDEX IF NOT EXISTS idx_component_codes_equipment_active
ON component_codes(equipment_type,active,component_code);
