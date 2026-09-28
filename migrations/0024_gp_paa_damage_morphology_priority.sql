-- Stage 4B: refine GP/PAA photo morphology distinctions using surveyor-confirmed POC benchmark.
-- Benchmark signal (2026-09-28): CK->DT 3/3, CU->DT 1/1, DT->PF 3 cases, DT->CO 1 case.
-- These are operational visual QA cues only; IICL code applicability remains governed by the verified master.

UPDATE damage_visual_rules
SET positive_cues='A true substrate fracture/split line, opened crack, or visible material discontinuity at the pinpoint. Local bending may coexist but does not replace CK when the target is the fracture itself.',
    negative_cues='Do not use CK for a continuous bent/depressed panel with no material discontinuity; that is DT. Do not confuse paint lines, seams, shadows or superficial scratches with a crack.',
    confusable_with='CU,GD,DT,PF',
    priority=150
WHERE equipment_type='GP' AND component_code='PAA' AND damage_code='CK' AND active=1;

UPDATE damage_visual_rules
SET positive_cues='A sharp incision, severed sheet edge, open cut or clear cut penetration at the pinpoint.',
    negative_cues='Do not use CU for continuous dent/bend deformation without a sharp material opening; that is DT. Use CK for a fracture/split when cut morphology is not established, and GD for superficial scoring without penetration.',
    confusable_with='CK,GD,DT',
    priority=150
WHERE equipment_type='GP' AND component_code='PAA' AND damage_code='CU' AND active=1;

UPDATE damage_visual_rules
SET positive_cues='Permanent inward/outward depression, displaced corrugation, buckling or bending where the panel material remains visually continuous at the pinpoint.',
    negative_cues='If the pinpoint is on a true crack/fracture or sharp cut/opening, CK or CU outranks DT. Incidental paint loss, rust, dirt or scratches on an otherwise clear deformation do not change the primary code from DT.',
    confusable_with='CK,CU,GD,PF,CO',
    priority=145
WHERE equipment_type='GP' AND component_code='PAA' AND damage_code='DT' AND active=1;

UPDATE damage_visual_rules
SET positive_cues='Peeling, flaking, blistering, delamination or coating loss where coating failure itself is the dominant target morphology.',
    negative_cues='Do not use PF when paint loss is incidental to a clear dent/bend, crack, cut or gouge. Structural morphology at the pinpoint outranks secondary coating loss.',
    confusable_with='DT,GD,CO,CK,CU',
    priority=125
WHERE equipment_type='GP' AND component_code='PAA' AND damage_code='PF' AND active=1;

UPDATE damage_visual_rules
SET positive_cues='Orange/brown rust, corrosion scale, pitting or unmistakable oxidized metal where corrosion itself is the primary target condition.',
    negative_cues='Do not use CO merely because rust/staining appears on a clearly dented, cracked or cut area; structural damage at the pinpoint outranks secondary corrosion. Pale discoloration or dirt is insufficient.',
    confusable_with='DT,PF,DY',
    priority=120
WHERE equipment_type='GP' AND component_code='PAA' AND damage_code='CO' AND active=1;

UPDATE damage_visual_rules
SET positive_cues='Linear abrasion, scoring, scraped groove or surface material removal where gouge/scratch morphology itself is dominant and no stronger structural break/deformation is present.',
    negative_cues='Do not use GD for a true crack/cut or for a clear panel dent/bend merely because abrasion occurs on it.',
    confusable_with='CK,CU,DT,PF',
    priority=120
WHERE equipment_type='GP' AND component_code='PAA' AND damage_code='GD' AND active=1;
