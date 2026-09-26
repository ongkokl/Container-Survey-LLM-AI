-- Phase 5: GP repair recommendation grounded in the user-provided GP.xlsx.
--
-- GP.xlsx is the authoritative source for the allowed component + damage +
-- repair-code combinations used by this phase. The depot tariff is not used
-- to determine repair applicability.
--
-- Initial scope remains GP / PAA because that is the component currently
-- enabled for verified damage classification in the POC.

INSERT OR REPLACE INTO repair_codes
(repair_code,repair_name,description,standard_version,source_reference,active)
VALUES
('CC','Chemical clean',NULL,'GP.xlsx','User-provided IICL ECS GP.xlsx',1),
('GS','Straighten',NULL,'GP.xlsx','User-provided IICL ECS GP.xlsx',1),
('GT','Remove glue and tape',NULL,'GP.xlsx','User-provided IICL ECS GP.xlsx',1),
('GW','Straighten and weld',NULL,'GP.xlsx','User-provided IICL ECS GP.xlsx',1),
('IT','Insert',NULL,'GP.xlsx','User-provided IICL ECS GP.xlsx',1),
('PS','Surface prep. and paint',NULL,'GP.xlsx','User-provided IICL ECS GP.xlsx',1),
('PT','Patch',NULL,'GP.xlsx','User-provided IICL ECS GP.xlsx',1),
('RC','Recondition / refurbish',NULL,'GP.xlsx','User-provided IICL ECS GP.xlsx',1),
('RM','Remove (without replacement)',NULL,'GP.xlsx','User-provided IICL ECS GP.xlsx',1),
('RP','Replace',NULL,'GP.xlsx','User-provided IICL ECS GP.xlsx',1),
('SC','Steamclean',NULL,'GP.xlsx','User-provided IICL ECS GP.xlsx',1),
('SE','Seal / Reseal',NULL,'GP.xlsx','User-provided IICL ECS GP.xlsx',1),
('SN','Section',NULL,'GP.xlsx','User-provided IICL ECS GP.xlsx',1),
('WD','Weld',NULL,'GP.xlsx','User-provided IICL ECS GP.xlsx',1),
('WW','WaterWash',NULL,'GP.xlsx','User-provided IICL ECS GP.xlsx',1);

DELETE FROM component_damage_repair_rules
WHERE equipment_type='GP'
  AND component_code='PAA'
  AND standard_version='GP.xlsx';

INSERT INTO component_damage_repair_rules
(id,equipment_type,component_code,damage_code,repair_code,standard_version,effective_from,effective_to,source_reference,active)
VALUES
('gp-paa-BN-IT','GP','PAA','BN','IT','GP.xlsx',NULL,NULL,'User-provided IICL ECS GP.xlsx',1),
('gp-paa-BN-PS','GP','PAA','BN','PS','GP.xlsx',NULL,NULL,'User-provided IICL ECS GP.xlsx',1),
('gp-paa-BN-PT','GP','PAA','BN','PT','GP.xlsx',NULL,NULL,'User-provided IICL ECS GP.xlsx',1),
('gp-paa-BN-RC','GP','PAA','BN','RC','GP.xlsx',NULL,NULL,'User-provided IICL ECS GP.xlsx',1),
('gp-paa-BN-RP','GP','PAA','BN','RP','GP.xlsx',NULL,NULL,'User-provided IICL ECS GP.xlsx',1),
('gp-paa-BN-SN','GP','PAA','BN','SN','GP.xlsx',NULL,NULL,'User-provided IICL ECS GP.xlsx',1),
('gp-paa-CD-GS','GP','PAA','CD','GS','GP.xlsx',NULL,NULL,'User-provided IICL ECS GP.xlsx',1),
('gp-paa-CD-IT','GP','PAA','CD','IT','GP.xlsx',NULL,NULL,'User-provided IICL ECS GP.xlsx',1),
('gp-paa-CD-PT','GP','PAA','CD','PT','GP.xlsx',NULL,NULL,'User-provided IICL ECS GP.xlsx',1),
('gp-paa-CD-RP','GP','PAA','CD','RP','GP.xlsx',NULL,NULL,'User-provided IICL ECS GP.xlsx',1),
('gp-paa-CD-SE','GP','PAA','CD','SE','GP.xlsx',NULL,NULL,'User-provided IICL ECS GP.xlsx',1),
('gp-paa-CD-SN','GP','PAA','CD','SN','GP.xlsx',NULL,NULL,'User-provided IICL ECS GP.xlsx',1),
('gp-paa-CK-GW','GP','PAA','CK','GW','GP.xlsx',NULL,NULL,'User-provided IICL ECS GP.xlsx',1),
('gp-paa-CK-IT','GP','PAA','CK','IT','GP.xlsx',NULL,NULL,'User-provided IICL ECS GP.xlsx',1),
('gp-paa-CK-PT','GP','PAA','CK','PT','GP.xlsx',NULL,NULL,'User-provided IICL ECS GP.xlsx',1),
('gp-paa-CK-RP','GP','PAA','CK','RP','GP.xlsx',NULL,NULL,'User-provided IICL ECS GP.xlsx',1),
('gp-paa-CK-SN','GP','PAA','CK','SN','GP.xlsx',NULL,NULL,'User-provided IICL ECS GP.xlsx',1),
('gp-paa-CK-WD','GP','PAA','CK','WD','GP.xlsx',NULL,NULL,'User-provided IICL ECS GP.xlsx',1),
('gp-paa-CO-IT','GP','PAA','CO','IT','GP.xlsx',NULL,NULL,'User-provided IICL ECS GP.xlsx',1),
('gp-paa-CO-PS','GP','PAA','CO','PS','GP.xlsx',NULL,NULL,'User-provided IICL ECS GP.xlsx',1),
('gp-paa-CO-PT','GP','PAA','CO','PT','GP.xlsx',NULL,NULL,'User-provided IICL ECS GP.xlsx',1),
('gp-paa-CO-RC','GP','PAA','CO','RC','GP.xlsx',NULL,NULL,'User-provided IICL ECS GP.xlsx',1),
('gp-paa-CO-RP','GP','PAA','CO','RP','GP.xlsx',NULL,NULL,'User-provided IICL ECS GP.xlsx',1),
('gp-paa-CO-WD','GP','PAA','CO','WD','GP.xlsx',NULL,NULL,'User-provided IICL ECS GP.xlsx',1),
('gp-paa-CT-CC','GP','PAA','CT','CC','GP.xlsx',NULL,NULL,'User-provided IICL ECS GP.xlsx',1),
('gp-paa-CT-PS','GP','PAA','CT','PS','GP.xlsx',NULL,NULL,'User-provided IICL ECS GP.xlsx',1),
('gp-paa-CT-RC','GP','PAA','CT','RC','GP.xlsx',NULL,NULL,'User-provided IICL ECS GP.xlsx',1),
('gp-paa-CT-RP','GP','PAA','CT','RP','GP.xlsx',NULL,NULL,'User-provided IICL ECS GP.xlsx',1),
('gp-paa-CT-SC','GP','PAA','CT','SC','GP.xlsx',NULL,NULL,'User-provided IICL ECS GP.xlsx',1),
('gp-paa-CT-SN','GP','PAA','CT','SN','GP.xlsx',NULL,NULL,'User-provided IICL ECS GP.xlsx',1),
('gp-paa-CU-GW','GP','PAA','CU','GW','GP.xlsx',NULL,NULL,'User-provided IICL ECS GP.xlsx',1),
('gp-paa-CU-IT','GP','PAA','CU','IT','GP.xlsx',NULL,NULL,'User-provided IICL ECS GP.xlsx',1),
('gp-paa-CU-PT','GP','PAA','CU','PT','GP.xlsx',NULL,NULL,'User-provided IICL ECS GP.xlsx',1),
('gp-paa-CU-RP','GP','PAA','CU','RP','GP.xlsx',NULL,NULL,'User-provided IICL ECS GP.xlsx',1),
('gp-paa-CU-SN','GP','PAA','CU','SN','GP.xlsx',NULL,NULL,'User-provided IICL ECS GP.xlsx',1),
('gp-paa-CU-WD','GP','PAA','CU','WD','GP.xlsx',NULL,NULL,'User-provided IICL ECS GP.xlsx',1),
('gp-paa-DT-GS','GP','PAA','DT','GS','GP.xlsx',NULL,NULL,'User-provided IICL ECS GP.xlsx',1),
('gp-paa-DT-IT','GP','PAA','DT','IT','GP.xlsx',NULL,NULL,'User-provided IICL ECS GP.xlsx',1),
('gp-paa-DT-PT','GP','PAA','DT','PT','GP.xlsx',NULL,NULL,'User-provided IICL ECS GP.xlsx',1),
('gp-paa-DT-RP','GP','PAA','DT','RP','GP.xlsx',NULL,NULL,'User-provided IICL ECS GP.xlsx',1),
('gp-paa-DT-SN','GP','PAA','DT','SN','GP.xlsx',NULL,NULL,'User-provided IICL ECS GP.xlsx',1),
('gp-paa-DY-CC','GP','PAA','DY','CC','GP.xlsx',NULL,NULL,'User-provided IICL ECS GP.xlsx',1),
('gp-paa-DY-SC','GP','PAA','DY','SC','GP.xlsx',NULL,NULL,'User-provided IICL ECS GP.xlsx',1),
('gp-paa-DY-WW','GP','PAA','DY','WW','GP.xlsx',NULL,NULL,'User-provided IICL ECS GP.xlsx',1),
('gp-paa-GD-PS','GP','PAA','GD','PS','GP.xlsx',NULL,NULL,'User-provided IICL ECS GP.xlsx',1),
('gp-paa-GD-RC','GP','PAA','GD','RC','GP.xlsx',NULL,NULL,'User-provided IICL ECS GP.xlsx',1),
('gp-paa-IR-GS','GP','PAA','IR','GS','GP.xlsx',NULL,NULL,'User-provided IICL ECS GP.xlsx',1),
('gp-paa-IR-GW','GP','PAA','IR','GW','GP.xlsx',NULL,NULL,'User-provided IICL ECS GP.xlsx',1),
('gp-paa-IR-IT','GP','PAA','IR','IT','GP.xlsx',NULL,NULL,'User-provided IICL ECS GP.xlsx',1),
('gp-paa-IR-PS','GP','PAA','IR','PS','GP.xlsx',NULL,NULL,'User-provided IICL ECS GP.xlsx',1),
('gp-paa-IR-PT','GP','PAA','IR','PT','GP.xlsx',NULL,NULL,'User-provided IICL ECS GP.xlsx',1),
('gp-paa-IR-RC','GP','PAA','IR','RC','GP.xlsx',NULL,NULL,'User-provided IICL ECS GP.xlsx',1),
('gp-paa-ME-IT','GP','PAA','ME','IT','GP.xlsx',NULL,NULL,'User-provided IICL ECS GP.xlsx',1),
('gp-paa-ME-PS','GP','PAA','ME','PS','GP.xlsx',NULL,NULL,'User-provided IICL ECS GP.xlsx',1),
('gp-paa-ME-PT','GP','PAA','ME','PT','GP.xlsx',NULL,NULL,'User-provided IICL ECS GP.xlsx',1),
('gp-paa-ME-SE','GP','PAA','ME','SE','GP.xlsx',NULL,NULL,'User-provided IICL ECS GP.xlsx',1),
('gp-paa-ME-SN','GP','PAA','ME','SN','GP.xlsx',NULL,NULL,'User-provided IICL ECS GP.xlsx',1),
('gp-paa-ME-WD','GP','PAA','ME','WD','GP.xlsx',NULL,NULL,'User-provided IICL ECS GP.xlsx',1),
('gp-paa-ML-GT','GP','PAA','ML','GT','GP.xlsx',NULL,NULL,'User-provided IICL ECS GP.xlsx',1),
('gp-paa-ML-PS','GP','PAA','ML','PS','GP.xlsx',NULL,NULL,'User-provided IICL ECS GP.xlsx',1),
('gp-paa-ML-RM','GP','PAA','ML','RM','GP.xlsx',NULL,NULL,'User-provided IICL ECS GP.xlsx',1),
('gp-paa-MX-CC','GP','PAA','MX','CC','GP.xlsx',NULL,NULL,'User-provided IICL ECS GP.xlsx',1),
('gp-paa-MX-GS','GP','PAA','MX','GS','GP.xlsx',NULL,NULL,'User-provided IICL ECS GP.xlsx',1),
('gp-paa-MX-GW','GP','PAA','MX','GW','GP.xlsx',NULL,NULL,'User-provided IICL ECS GP.xlsx',1),
('gp-paa-MX-IT','GP','PAA','MX','IT','GP.xlsx',NULL,NULL,'User-provided IICL ECS GP.xlsx',1),
('gp-paa-MX-PS','GP','PAA','MX','PS','GP.xlsx',NULL,NULL,'User-provided IICL ECS GP.xlsx',1),
('gp-paa-MX-PT','GP','PAA','MX','PT','GP.xlsx',NULL,NULL,'User-provided IICL ECS GP.xlsx',1),
('gp-paa-NI-GS','GP','PAA','NI','GS','GP.xlsx',NULL,NULL,'User-provided IICL ECS GP.xlsx',1),
('gp-paa-NI-GW','GP','PAA','NI','GW','GP.xlsx',NULL,NULL,'User-provided IICL ECS GP.xlsx',1),
('gp-paa-NI-IT','GP','PAA','NI','IT','GP.xlsx',NULL,NULL,'User-provided IICL ECS GP.xlsx',1),
('gp-paa-NI-PT','GP','PAA','NI','PT','GP.xlsx',NULL,NULL,'User-provided IICL ECS GP.xlsx',1),
('gp-paa-NI-RP','GP','PAA','NI','RP','GP.xlsx',NULL,NULL,'User-provided IICL ECS GP.xlsx',1),
('gp-paa-NI-SN','GP','PAA','NI','SN','GP.xlsx',NULL,NULL,'User-provided IICL ECS GP.xlsx',1),
('gp-paa-PF-PS','GP','PAA','PF','PS','GP.xlsx',NULL,NULL,'User-provided IICL ECS GP.xlsx',1),
('gp-paa-PF-RC','GP','PAA','PF','RC','GP.xlsx',NULL,NULL,'User-provided IICL ECS GP.xlsx',1);