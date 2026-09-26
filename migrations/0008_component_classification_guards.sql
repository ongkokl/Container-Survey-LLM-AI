-- Phase 4.3: component-classification guards.
--
-- Goals:
-- 1) enforce one active semantic meaning per equipment type + component code;
-- 2) make ambiguous same-date/null duplicates fail the migration instead of silently
--    leaking contradictory meanings into the LVLM prompt;
-- 3) scope component candidates by the recorded container face.
--
-- Existing strictly older active definitions are retired first. If two active rows
-- still tie on effective_from, the unique index below intentionally fails so the
-- conflict must be resolved explicitly instead of choosing an arbitrary meaning.

UPDATE component_codes AS current
SET active = 0,
    effective_to = COALESCE(
      current.effective_to,
      (
        SELECT date(MIN(newer.effective_from), '-1 day')
        FROM component_codes newer
        WHERE newer.equipment_type = current.equipment_type
          AND newer.component_code = current.component_code
          AND newer.active = 1
          AND COALESCE(newer.effective_from, '0000-00-00')
              > COALESCE(current.effective_from, '0000-00-00')
      )
    )
WHERE current.active = 1
  AND EXISTS (
    SELECT 1
    FROM component_codes newer
    WHERE newer.equipment_type = current.equipment_type
      AND newer.component_code = current.component_code
      AND newer.active = 1
      AND COALESCE(newer.effective_from, '0000-00-00')
          > COALESCE(current.effective_from, '0000-00-00')
  );

CREATE UNIQUE INDEX IF NOT EXISTS ux_component_codes_one_active
ON component_codes(equipment_type, component_code)
WHERE active = 1;

CREATE TABLE IF NOT EXISTS component_face_rules (
  equipment_type TEXT NOT NULL CHECK (equipment_type IN ('GP','RF')),
  component_code TEXT NOT NULL,
  container_face TEXT NOT NULL CHECK (
    container_face IN ('LEFT','RIGHT','FRONT','DOOR','ROOF','FLOOR')
  ),
  source_reference TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  PRIMARY KEY (equipment_type, component_code, container_face)
);

CREATE INDEX IF NOT EXISTS idx_component_face_rules_lookup
ON component_face_rules(equipment_type, container_face, active, component_code);

-- GP face applicability is seeded conservatively from the supplied IICL
-- Dry Van Container component-code reference guide, revised 11 June 2025.
INSERT OR REPLACE INTO component_face_rules
(equipment_type,component_code,container_face,source_reference,active)
VALUES
('GP','PAA','LEFT','IICL Dry Van component guide 2025-06-11, pp.1,3,4,10,16',1),
('GP','PAA','RIGHT','IICL Dry Van component guide 2025-06-11, pp.1,3,4,10,16',1),
('GP','PAA','FRONT','IICL Dry Van component guide 2025-06-11, pp.3,16',1),
('GP','PAA','ROOF','IICL Dry Van component guide 2025-06-11, p.4',1),

('GP','RLA','LEFT','IICL Dry Van component guide 2025-06-11, pp.1,3,4,10,12,16',1),
('GP','RLA','RIGHT','IICL Dry Van component guide 2025-06-11, pp.1,3,4,10,12,16',1),
('GP','RLA','FRONT','IICL Dry Van component guide 2025-06-11, pp.3,16',1),
('GP','RLA','DOOR','IICL Dry Van component guide 2025-06-11, pp.1,4,13',1),
('GP','RLA','ROOF','IICL Dry Van component guide 2025-06-11, p.4',1),
('GP','RLA','FLOOR','IICL Dry Van component guide 2025-06-11, pp.5,10-12',1),

('GP','CFG','LEFT','IICL Dry Van component guide 2025-06-11, pp.1,3,10,16',1),
('GP','CFG','RIGHT','IICL Dry Van component guide 2025-06-11, pp.1,3,10,16',1),
('GP','CFG','FRONT','IICL Dry Van component guide 2025-06-11, pp.3,16',1),
('GP','CFG','DOOR','IICL Dry Van component guide 2025-06-11, p.1',1),
('GP','CFG','ROOF','IICL Dry Van component guide 2025-06-11, pp.4,10',1),
('GP','CFG','FLOOR','IICL Dry Van component guide 2025-06-11, pp.10,16',1),

('GP','CPA','LEFT','IICL Dry Van component guide 2025-06-11, pp.3,16',1),
('GP','CPA','RIGHT','IICL Dry Van component guide 2025-06-11, pp.3,16',1),
('GP','CPA','FRONT','IICL Dry Van component guide 2025-06-11, pp.3,16',1),
('GP','CPA','DOOR','IICL Dry Van component guide 2025-06-11, door-end corner structure',1),
('GP','CPO','LEFT','IICL Dry Van component guide 2025-06-11, pp.1,3',1),
('GP','CPO','RIGHT','IICL Dry Van component guide 2025-06-11, pp.1,3',1),
('GP','CPO','FRONT','IICL Dry Van component guide 2025-06-11, p.3',1),
('GP','CPO','DOOR','IICL Dry Van component guide 2025-06-11, end corner-post structure',1),

('GP','RCI','FRONT','IICL Dry Van component guide 2025-06-11, end rail-corner structure',1),
('GP','RCI','DOOR','IICL Dry Van component guide 2025-06-11, pp.1,5',1),
('GP','RCI','FLOOR','IICL Dry Van component guide 2025-06-11, p.5',1),

('GP','RLG','LEFT','IICL Dry Van component guide 2025-06-11, pp.10-12,16',1),
('GP','RLG','RIGHT','IICL Dry Van component guide 2025-06-11, pp.10-12,16',1),
('GP','RLG','FRONT','IICL Dry Van component guide 2025-06-11, p.16',1),
('GP','RLG','DOOR','IICL Dry Van component guide 2025-06-11, end/bottom rail gusset',1),
('GP','RLG','FLOOR','IICL Dry Van component guide 2025-06-11, pp.10-12',1),
('GP','RDP','LEFT','IICL Dry Van component guide 2025-06-11, p.10',1),
('GP','RDP','RIGHT','IICL Dry Van component guide 2025-06-11, p.10',1),
('GP','RDP','FLOOR','IICL Dry Van component guide 2025-06-11, p.10',1),

('GP','HEP','FRONT','IICL Dry Van component guide 2025-06-11, pp.4,10',1),
('GP','HEP','DOOR','IICL Dry Van component guide 2025-06-11, pp.4,10',1),
('GP','HEP','ROOF','IICL Dry Van component guide 2025-06-11, pp.4,10',1),
('GP','RCG','FRONT','IICL Dry Van component guide 2025-06-11, p.4',1),
('GP','RCG','DOOR','IICL Dry Van component guide 2025-06-11, p.4',1),
('GP','RCG','ROOF','IICL Dry Van component guide 2025-06-11, p.4',1),

('GP','MHC','LEFT','IICL Dry Van component guide 2025-06-11, pp.4,13,16',1),
('GP','MHC','RIGHT','IICL Dry Van component guide 2025-06-11, pp.4,13,16',1),
('GP','MHC','FRONT','IICL Dry Van component guide 2025-06-11, p.16',1),
('GP','MHC','DOOR','IICL Dry Van component guide 2025-06-11, pp.4,13',1),
('GP','MHC','ROOF','IICL Dry Van component guide 2025-06-11, p.4',1),
('GP','VRA','LEFT','IICL Dry Van component guide 2025-06-11, p.1',1),
('GP','VRA','RIGHT','IICL Dry Van component guide 2025-06-11, p.1',1),

('GP','HGA','DOOR','IICL Dry Van component guide 2025-06-11, pp.13,15',1),
('GP','HGB','DOOR','IICL Dry Van component guide 2025-06-11, pp.13,15',1),
('GP','HGP','DOOR','IICL Dry Van component guide 2025-06-11, p.15',1),
('GP','CPL','DOOR','IICL Dry Van component guide 2025-06-11, p.15',1),
('GP','LBR','DOOR','IICL Dry Van component guide 2025-06-11, p.13',1),
('GP','LBB','DOOR','IICL Dry Van component guide 2025-06-11, p.13',1),
('GP','LBG','DOOR','IICL Dry Van component guide 2025-06-11, p.13',1),
('GP','LBC','DOOR','IICL Dry Van component guide 2025-06-11, p.13',1),
('GP','LBH','DOOR','IICL Dry Van component guide 2025-06-11, p.13',1),
('GP','LBL','DOOR','IICL Dry Van component guide 2025-06-11, door locking-bar hardware',1),
('GP','LHH','DOOR','IICL Dry Van component guide 2025-06-11, p.13',1),
('GP','GTA','DOOR','IICL Dry Van component guide 2025-06-11, p.15',1),

-- RF applicability uses the supplied IICL Refrigerated Containers guide,
-- version 7 October 2025. RF/PAA follows that guide: PAA = Subfloor.
('RF','PAA','FLOOR','IICL Refrigerated component guide 2025-10-07, pp.21-23',1),
('RF','POC','LEFT','IICL Refrigerated component guide 2025-10-07, p.9',1),
('RF','POC','RIGHT','IICL Refrigerated component guide 2025-10-07, p.9',1),
('RF','POC','FRONT','IICL Refrigerated component guide 2025-10-07, exterior panel structure',1),
('RF','POC','ROOF','IICL Refrigerated component guide 2025-10-07, exterior panel structure',1),
('RF','PIC','LEFT','IICL Refrigerated component guide 2025-10-07, p.4',1),
('RF','PIC','RIGHT','IICL Refrigerated component guide 2025-10-07, p.4',1),
('RF','PIC','FRONT','IICL Refrigerated component guide 2025-10-07, interior panel structure',1),
('RF','PIC','ROOF','IICL Refrigerated component guide 2025-10-07, interior panel structure',1),

('RF','RLA','LEFT','IICL Refrigerated component guide 2025-10-07, pp.9-10,19',1),
('RF','RLA','RIGHT','IICL Refrigerated component guide 2025-10-07, pp.9-10,19',1),
('RF','RLA','FRONT','IICL Refrigerated component guide 2025-10-07, pp.9-10',1),
('RF','RLA','DOOR','IICL Refrigerated component guide 2025-10-07, door-end rail structure',1),
('RF','RLA','ROOF','IICL Refrigerated component guide 2025-10-07, pp.9-10',1),
('RF','RLA','FLOOR','IICL Refrigerated component guide 2025-10-07, p.19',1),
('RF','CPA','LEFT','IICL Refrigerated component guide 2025-10-07, p.9',1),
('RF','CPA','RIGHT','IICL Refrigerated component guide 2025-10-07, p.9',1),
('RF','CPA','FRONT','IICL Refrigerated component guide 2025-10-07, end corner-post structure',1),
('RF','CPA','DOOR','IICL Refrigerated component guide 2025-10-07, door-end corner-post structure',1),

('RF','CFG','LEFT','IICL Refrigerated component guide 2025-10-07, pp.2,9-10',1),
('RF','CFG','RIGHT','IICL Refrigerated component guide 2025-10-07, pp.2,9-10',1),
('RF','CFG','FRONT','IICL Refrigerated component guide 2025-10-07, pp.9-10',1),
('RF','CFG','DOOR','IICL Refrigerated component guide 2025-10-07, pp.2-3',1),
('RF','CFG','ROOF','IICL Refrigerated component guide 2025-10-07, pp.9-10',1),
('RF','CFG','FLOOR','IICL Refrigerated component guide 2025-10-07, lower corner structure',1),

('RF','MHC','LEFT','IICL Refrigerated component guide 2025-10-07, pp.2-3,9-10',1),
('RF','MHC','RIGHT','IICL Refrigerated component guide 2025-10-07, pp.2-3,9-10',1),
('RF','MHC','FRONT','IICL Refrigerated component guide 2025-10-07, pp.9-10',1),
('RF','MHC','DOOR','IICL Refrigerated component guide 2025-10-07, pp.2-3,9',1),
('RF','MHC','ROOF','IICL Refrigerated component guide 2025-10-07, pp.9-10',1),
('RF','RCG','FRONT','IICL Refrigerated component guide 2025-10-07, pp.9-10',1),
('RF','RCG','DOOR','IICL Refrigerated component guide 2025-10-07, pp.9-10',1),
('RF','RCG','ROOF','IICL Refrigerated component guide 2025-10-07, pp.9-10',1),
('RF','HEP','FRONT','IICL Refrigerated component guide 2025-10-07, pp.9-10',1),
('RF','HEP','DOOR','IICL Refrigerated component guide 2025-10-07, pp.9-10',1),
('RF','HEP','ROOF','IICL Refrigerated component guide 2025-10-07, pp.9-10',1),

('RF','TFA','FLOOR','IICL Refrigerated component guide 2025-10-07, pp.4,19',1),
('RF','TFI','FLOOR','IICL Refrigerated component guide 2025-10-07, pp.4,19',1),
('RF','TFD','FLOOR','IICL Refrigerated component guide 2025-10-07, p.4',1),
('RF','TFD','DOOR','IICL Refrigerated component guide 2025-10-07, p.4 threshold/drain area',1),
('RF','PSL','LEFT','IICL Refrigerated component guide 2025-10-07, p.4',1),
('RF','PSL','RIGHT','IICL Refrigerated component guide 2025-10-07, p.4',1),
('RF','PSL','FRONT','IICL Refrigerated component guide 2025-10-07, interior lining/scuff structure',1),
('RF','CPJ','LEFT','IICL Refrigerated component guide 2025-10-07, pp.4,7',1),
('RF','CPJ','RIGHT','IICL Refrigerated component guide 2025-10-07, pp.4,7',1),
('RF','CPJ','FRONT','IICL Refrigerated component guide 2025-10-07, interior corner structure',1),
('RF','CPJ','DOOR','IICL Refrigerated component guide 2025-10-07, pp.4,7',1),

('RF','CMA','FLOOR','IICL Refrigerated component guide 2025-10-07, pp.21-22',1),
('RF','DKK','FLOOR','IICL Refrigerated component guide 2025-10-07, pp.21,23',1),
('RF','TUB','FLOOR','IICL Refrigerated component guide 2025-10-07, pp.21-23',1),
('RF','RTL','FLOOR','IICL Refrigerated component guide 2025-10-07, pp.21-23',1),
('RF','TUP','FLOOR','IICL Refrigerated component guide 2025-10-07, pp.22-23',1),

-- These two supplementary RF panel internals are present in the current COA
-- master and are visually located within reefer panel assemblies.
('RF','PIM','LEFT','COA CEDEX Syntax Visualisation Component Codes V2.0, p.77',1),
('RF','PIM','RIGHT','COA CEDEX Syntax Visualisation Component Codes V2.0, p.77',1),
('RF','PIM','FRONT','COA CEDEX Syntax Visualisation Component Codes V2.0, p.77',1),
('RF','PIM','ROOF','COA CEDEX Syntax Visualisation Component Codes V2.0, p.77',1),
('RF','PIS','LEFT','COA CEDEX Syntax Visualisation Component Codes V2.0, p.77',1),
('RF','PIS','RIGHT','COA CEDEX Syntax Visualisation Component Codes V2.0, p.77',1),
('RF','PIS','FRONT','COA CEDEX Syntax Visualisation Component Codes V2.0, p.77',1),
('RF','PIS','ROOF','COA CEDEX Syntax Visualisation Component Codes V2.0, p.77',1);
