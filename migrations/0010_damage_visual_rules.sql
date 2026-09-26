-- Phase 4.5: D1-driven damage visual QA knowledge.
--
-- The IICL damage code names and component/damage applicability remain in the
-- existing damage_codes and component_damage_rules tables. This table adds
-- operational visual cues and evidence requirements for AI classification.
-- These cues are not intended to redefine the underlying IICL codes.

CREATE TABLE IF NOT EXISTS damage_visual_rules (
  equipment_type TEXT NOT NULL CHECK (equipment_type IN ('GP','RF')),
  component_code TEXT NOT NULL,
  damage_code TEXT NOT NULL,
  visual_definition TEXT NOT NULL,
  positive_cues TEXT,
  negative_cues TEXT,
  confusable_with TEXT,
  evidence_requirement TEXT NOT NULL DEFAULT 'VISUAL' CHECK (
    evidence_requirement IN ('VISUAL','VISUAL_CONTEXT','MEASUREMENT','HISTORY_CONTEXT')
  ),
  force_review INTEGER NOT NULL DEFAULT 0 CHECK (force_review IN (0,1)),
  source_reference TEXT NOT NULL,
  priority INTEGER NOT NULL DEFAULT 100,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  PRIMARY KEY (equipment_type,component_code,damage_code)
);

CREATE INDEX IF NOT EXISTS idx_damage_visual_rules_lookup
ON damage_visual_rules(equipment_type,component_code,active,damage_code);

-- Initial GP/PAA operational QA cues for the 15 verified damage codes already
-- allowed by migration 0007 (source master: user-provided IICL ECS GP.xlsx).
INSERT OR REPLACE INTO damage_visual_rules
(equipment_type,component_code,damage_code,visual_definition,positive_cues,negative_cues,confusable_with,evidence_requirement,force_review,source_reference,priority,active)
VALUES
('GP','PAA','BN','Visible heat/burn damage affecting the panel surface.','Charring, scorching, heat discoloration or melted/heat-distorted coating/material.','Do not use for ordinary dark dirt, rust staining or paint discoloration without heat evidence.','CO,DY,PF','VISUAL',0,'Operational QA cue for BN from user-provided IICL ECS GP.xlsx damage master',100,1),
('GP','PAA','CD','Combined or consequential damage where more than one damage mechanism is materially involved and a single simpler morphology does not describe the finding.','Clearly linked multiple damage effects within the same marked finding.','Do not use merely because minor incidental paint loss, dirt or staining appears next to a dominant dent, cut or gouge.','DT,GD,PF,CO','VISUAL_CONTEXT',1,'Operational QA cue for CD from user-provided IICL ECS GP.xlsx damage master',100,1),
('GP','PAA','CK','Visible crack or fracture line in the panel material/coating system where the substrate is actually cracked.','Distinct fracture line, split-like crack propagation or opened crack.','Do not confuse scratches, paint lines, seams or shadows with a material crack.','CU,GD,PF','VISUAL',0,'Operational QA cue for CK from user-provided IICL ECS GP.xlsx damage master',100,1),
('GP','PAA','CO','Visible corrosion or rust affecting the panel.','Orange/brown rust, corrosion scale, pitting or unmistakable oxidized metal.','Pale discoloration, dirt, water marks or isolated paint chips without visible corrosion are insufficient.','PF,DY,CT','VISUAL',0,'Operational QA cue for CO from user-provided IICL ECS GP.xlsx damage master',110,1),
('GP','PAA','CT','Visible contamination or foreign substance affecting the panel where contamination, not ordinary dirt, is the relevant finding.','Distinct foreign substance/residue with context indicating contamination.','Do not infer contamination type or hazardous nature from color/staining alone; ordinary grime belongs under DY when appropriate.','DY,OS,CO','VISUAL_CONTEXT',1,'Operational QA cue for CT from user-provided IICL ECS GP.xlsx damage master',100,1),
('GP','PAA','CU','A cut through or sharply incised into the panel material.','Sharp linear opening/incision, severed sheet edge or clear cut penetration.','Do not use for superficial scratches/gouges or crack lines without evidence of a cut.','CK,GD,HO','VISUAL',0,'Operational QA cue for CU from user-provided IICL ECS GP.xlsx damage master',110,1),
('GP','PAA','DT','Permanent denting or bending/deformation of the panel profile.','Inward/outward depression, displaced corrugation, buckling or local bending from the original panel shape.','Incidental paint chips, scratches, dirt or light discoloration around a clear deformation do not change the primary code from DT.','GD,PF,CO','VISUAL',0,'Operational QA cue for DT from user-provided IICL ECS GP.xlsx damage master',120,1),
('GP','PAA','DY','Ordinary visible dirt or soiling on the panel surface.','Surface grime, mud, dust or removable-looking soiling.','Do not use when the primary finding is corrosion, contamination, paint failure or structural deformation.','CT,CO,PF','VISUAL',0,'Operational QA cue for DY from user-provided IICL ECS GP.xlsx damage master',100,1),
('GP','PAA','GD','Gouge or scratch damage to the panel surface.','Linear abrasion, scoring, scraped groove or surface material removal without dominant panel deformation.','Do not classify a clear dent/bend as GD merely because scratch marks occur on the dented area.','DT,CU,PF','VISUAL',0,'Operational QA cue for GD from user-provided IICL ECS GP.xlsx damage master',110,1),
('GP','PAA','IR','A previous repair appears improper or non-conforming.','Visible repair patch, weld, inserted piece or prior repair workmanship appears to be the subject of the finding.','A photo can show suspicious repair appearance but cannot by itself establish all conformity requirements.','ME,PF,CD','HISTORY_CONTEXT',1,'Operational QA cue for IR from user-provided IICL ECS GP.xlsx damage master',100,1),
('GP','PAA','ME','Finding appears related to an existing manufacturing-origin defect rather than service damage.','Repeatable fabrication/forming/weld feature that may indicate manufacturing origin.','Do not infer manufacturing origin solely from appearance when service history or provenance is unavailable.','IR,DT,CK','HISTORY_CONTEXT',1,'Operational QA cue for ME from user-provided IICL ECS GP.xlsx damage master',100,1),
('GP','PAA','ML','Damage or deficiency involving markings or labels on the panel.','Missing, damaged, illegible, misplaced or affected marking/label is itself the target.','Do not use merely because a marking is visible near unrelated panel damage.','PF,DY','VISUAL',0,'Operational QA cue for ML from user-provided IICL ECS GP.xlsx damage master',100,1),
('GP','PAA','MX','Misuse-related damage classification requiring the relevant IICL technical-bulletin/context determination.','Visible damage may be consistent with misuse, but causal classification requires supporting operational/context evidence.','Do not infer misuse/cause from damage shape alone.','DT,GD,CD','HISTORY_CONTEXT',1,'Operational QA cue for MX from user-provided IICL ECS GP.xlsx damage master',100,1),
('GP','PAA','NI','Condition where the component/container is outside applicable ISO dimensional limits.','Photo may show obvious distortion suggesting dimensional non-conformance.','Do not confirm dimensional non-conformance from an uncalibrated photo; measurement is required.','DT','MEASUREMENT',1,'Operational QA cue for NI from user-provided IICL ECS GP.xlsx damage master',100,1),
('GP','PAA','PF','Paint/coating failure where loss or failure of the coating itself is the primary finding.','Peeling, flaking, blistering, delamination or coating loss without a more dominant structural damage.','Minor paint chips at the edge of a dent, cut or gouge are incidental and should not outrank the primary physical damage.','CO,GD,DT','VISUAL',0,'Operational QA cue for PF from user-provided IICL ECS GP.xlsx damage master',120,1);
