-- Add the missing GP Door visual rule for LBL (Locking Bar Lug).
--
-- LBL is already an active GP component code and is allowed on the DOOR face,
-- but without a component_visual_rules row Qwen receives less explicit guidance
-- for this candidate than for the surrounding locking-bar hardware.

INSERT OR REPLACE INTO component_visual_rules
(equipment_type,component_code,container_face,overview_zone,visual_definition,positive_cues,negative_cues,confusable_with,force_review,source_reference,priority,active)
VALUES
(
  'GP',
  'LBL',
  'DOOR',
  'ANY',
  'Locking bar lug: a localized fixed component of the door locking-bar hardware.',
  'Target is the distinct locking-bar lug itself, visibly separate from the long vertical locking rod and adjacent hardware.',
  'Do not classify the locking bar rod, bracket, guide, cam, handle or handle hub as the lug.',
  'LBR,LBB,LBG,LBC,LBH,LHH',
  0,
  'IICL Dry Van component guide 2025-06-11, door locking-bar hardware; COA CEDEX Syntax Visualisation Component Codes V2.0',
  110,
  1
);
