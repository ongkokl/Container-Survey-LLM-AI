-- Refine GP Door visual distinctions for closely adjacent locking-bar components.
--
-- Authoritative visual source:
-- IICL Dry Van Container component codes reference guide, revised 11 June 2025.
-- Relevant illustrated pages:
--   p.20: LBC Locking Bar Cam, RCK Cam Keeper, HWR Hardware, LBB Locking Bar Bracket
--   p.21: LBG Locking Bar Guide, HWR Hardware, HWH Hardware-Huckbolt,
--         LBR Locking Bar Rod, LBH/LBL/LHH and related handle hardware
--
-- The purpose of this migration is to stop generic "bracket" or "hardware"
-- wording from swallowing a surveyor pinpoint that falls on a neighbouring
-- but separately labelled IICL component.

INSERT OR REPLACE INTO component_visual_rules
(equipment_type,component_code,container_face,overview_zone,visual_definition,positive_cues,negative_cues,confusable_with,force_review,source_reference,priority,active)
VALUES

('GP','LBB','DOOR','ANY',
 'Locking Bar Bracket: the distinct central bracket/sleeve body that retains and supports the vertical locking-bar rod.',
 'The surveyor pinpoint is on the main bracket/sleeve body surrounding or retaining the rod, not merely on a neighbouring side plate or fastener.',
 'Do not use LBB when the pinpoint is on separately identifiable associated hardware/mounting plate (HWR), an individual Huckbolt/fastener (HWH), the rod shaft (LBR), guide (LBG), cam (LBC), or keeper (RCK).',
 'HWR,HWH,LBR,LBG,LBC,RCK',
 0,
 'IICL Dry Van component guide 2025-06-11, pp.13,20-21',
 150,
 1),

('GP','HWR','DOOR','ANY',
 'Hardware: separately identified associated door-locking hardware or mounting/backing hardware adjacent to another locking-bar component.',
 'The surveyor pinpoint is on the IICL-labelled associated hardware or side/mounting/backing hardware area rather than on the central LBB bracket body or rod.',
 'Do not require the target to be only a bolt or nut. Do not use HWR when the pinpoint is clearly on the central LBB bracket body, the long rod (LBR), guide (LBG), cam (LBC), keeper (RCK), or an individually identifiable Huckbolt classified as HWH.',
 'LBB,HWH,LBR,LBG,LBC,RCK',
 0,
 'IICL Dry Van component guide 2025-06-11, pp.20-21',
 160,
 1),

('GP','HWH','DOOR','ANY',
 'Hardware - Huckbolt: an individual Huckbolt/fastener specifically identified as HWH in the IICL door-hardware reference.',
 'The pinpoint is directly on the identifiable Huckbolt/fastener itself.',
 'Do not use HWH for a larger mounting/backing hardware piece labelled HWR or for the central locking-bar bracket body labelled LBB.',
 'HWR,LBB',
 0,
 'IICL Dry Van component guide 2025-06-11, p.21',
 160,
 1),

('GP','LBR','DOOR','ANY',
 'Locking Bar Rod: the long vertical rod/shaft running through the locking-bar guides and brackets.',
 'The pinpoint is on the cylindrical/elongated rod shaft itself.',
 'Do not use LBR when the pinpoint is on the surrounding bracket body (LBB), associated mounting hardware (HWR), individual Huckbolt (HWH), guide (LBG), cam (LBC), keeper (RCK), or handle assembly.',
 'LBB,HWR,HWH,LBG,LBC,RCK,LBH',
 0,
 'IICL Dry Van component guide 2025-06-11, pp.13,21',
 150,
 1),

('GP','LBG','DOOR','ANY',
 'Locking Bar Guide: the shaped guide component through/along which the locking-bar rod is guided.',
 'The pinpoint is on the guide body itself, visibly distinct from the rod and its mounting hardware.',
 'Do not use LBG when the pinpoint is on the rod shaft (LBR), central bracket body (LBB), associated hardware/mounting plate (HWR), or an individual Huckbolt (HWH).',
 'LBR,LBB,HWR,HWH',
 0,
 'IICL Dry Van component guide 2025-06-11, pp.13,21',
 150,
 1),

('GP','LBC','DOOR','ANY',
 'Locking Bar Cam: the moving cam-shaped locking end attached to the end of the locking-bar mechanism.',
 'The pinpoint is on the shaped rotating/moving cam at the end of the locking bar.',
 'Do not use LBC for the stationary receiver/keeper that the cam engages (RCK), the rod shaft (LBR), bracket body (LBB), or nearby hardware (HWR/HWH).',
 'RCK,LBR,LBB,HWR,HWH',
 0,
 'IICL Dry Van component guide 2025-06-11, pp.13,20',
 160,
 1),

('GP','RCK','DOOR','ANY',
 'Cam Keeper: the stationary keeper/receiver fixed to the door/header structure that receives or restrains the locking-bar cam.',
 'The pinpoint is on the fixed keeper/receiver adjacent to the cam, not on the moving cam itself.',
 'Do not use RCK for the moving locking-bar cam (LBC), rod (LBR), bracket body (LBB), or nearby hardware (HWR/HWH).',
 'LBC,LBR,LBB,HWR,HWH',
 0,
 'IICL Dry Van component guide 2025-06-11, p.20',
 160,
 1);
