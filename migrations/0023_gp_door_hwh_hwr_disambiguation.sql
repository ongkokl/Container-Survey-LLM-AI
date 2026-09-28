-- Tighten GP door HWH vs HWR discrimination after pinpoint POC testing.
-- Goal: do not infer HWH from a generic round fastener head alone.

UPDATE component_visual_rules
SET visual_definition='Hardware - Huckbolt: the specific Huckbolt fastener identified as HWH in the IICL door-hardware reference.',
    positive_cues='The pinpoint is directly on a fastener whose visible construction can be positively distinguished as the Huckbolt represented by HWH in the IICL reference.',
    negative_cues='A round fastener head alone is insufficient evidence for HWH. Do not use HWH for generic or visually indeterminate fastening/mounting hardware; use HWR when Huckbolt-specific identification cannot be established. Do not use HWH for the larger LBB bracket body.',
    confusable_with='HWR,LBB,LBG,LBR,LBC,RCK',
    priority=190
WHERE equipment_type='GP' AND component_code='HWH'
  AND container_face='DOOR' AND overview_zone='ANY' AND active=1;

UPDATE component_visual_rules
SET visual_definition='Hardware: generic or associated door-locking fastening/mounting hardware, including hardware that cannot be positively distinguished as a Huckbolt.',
    positive_cues='The pinpoint is on a bolt, fastener, securing item, mounting/backing hardware, or other associated hardware. If only a generic/round fastener head is visible and Huckbolt-specific identification is not established, prefer HWR over HWH.',
    negative_cues='Do not use HWR when the pinpoint is clearly on the central LBB bracket body, long rod (LBR), guide (LBG), cam (LBC), keeper (RCK), or when the fastener is positively identifiable as HWH.',
    confusable_with='HWH,LBB,LBR,LBG,LBC,RCK',
    priority=180
WHERE equipment_type='GP' AND component_code='HWR'
  AND container_face='DOOR' AND overview_zone='ANY' AND active=1;
