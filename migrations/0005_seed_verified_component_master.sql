-- Phase 4: verified CEDEX/ECS component master seed (initial visual subset)
-- Source: IICL Dry Van Container component codes reference guide, revised 11 June 2025.
-- Source: IICL Refrigerated Containers component codes reference guide, version 7 October 2025.
-- Equipment-scoped by design. This seed intentionally contains only codes explicitly
-- verified from the supplied reference material; expand from the source documents,
-- never from model-generated codes.

INSERT OR REPLACE INTO component_codes
(equipment_type,component_code,component_name,description,standard_name,standard_version,effective_from,source_reference,active)
VALUES
('GP','PAA','Panel Assembly',NULL,'IICL ECS','2025-06-11','2025-06-11','IICL Dry Van Container component codes reference guide, revised 11 June 2025',1),
('GP','RLA','Rail Assembly',NULL,'IICL ECS','2025-06-11','2025-06-11','IICL Dry Van Container component codes reference guide, revised 11 June 2025',1),
('GP','CFG','Corner Fitting',NULL,'IICL ECS','2025-06-11','2025-06-11','IICL Dry Van Container component codes reference guide, revised 11 June 2025',1),
('GP','CPA','Corner Post Assembly',NULL,'IICL ECS','2025-06-11','2025-06-11','IICL Dry Van Container component codes reference guide, revised 11 June 2025',1),
('GP','CPO','Corner Post Outer Piece',NULL,'IICL ECS','2025-06-11','2025-06-11','IICL Dry Van Container component codes reference guide, revised 11 June 2025',1),
('GP','RCI','Rail Corner Protector Recess',NULL,'IICL ECS','2025-06-11','2025-06-11','IICL Dry Van Container component codes reference guide, revised 11 June 2025',1),
('GP','RLG','Rail Gusset',NULL,'IICL ECS','2025-06-11','2025-06-11','IICL Dry Van Container component codes reference guide, revised 11 June 2025',1),
('GP','RDP','Rail Doubling Plate',NULL,'IICL ECS','2025-06-11','2025-06-11','IICL Dry Van Container component codes reference guide, revised 11 June 2025',1),
('GP','HEP','Header Extension Plate',NULL,'IICL ECS','2025-06-11','2025-06-11','IICL Dry Van Container component codes reference guide, revised 11 June 2025',1),
('GP','RCG','Roof Corner Gusset',NULL,'IICL ECS','2025-06-11','2025-06-11','IICL Dry Van Container component codes reference guide, revised 11 June 2025',1),
('GP','MHC','High Cube Stripes',NULL,'IICL ECS','2025-06-11','2025-06-11','IICL Dry Van Container component codes reference guide, revised 11 June 2025',1),
('GP','VRA','Ventilator',NULL,'IICL ECS','2025-06-11','2025-06-11','IICL Dry Van Container component codes reference guide, revised 11 June 2025',1),

('RF','PAA','Subfloor',NULL,'IICL ECS','2025-10-07','2025-10-07','IICL Refrigerated Containers component codes reference guide, version 7 October 2025',1),
('RF','POC','Panel - Outer Cladding',NULL,'IICL ECS','2025-10-07','2025-10-07','IICL Refrigerated Containers component codes reference guide, version 7 October 2025',1),
('RF','PIC','Panel Inner Cladding',NULL,'IICL ECS','2025-10-07','2025-10-07','IICL Refrigerated Containers component codes reference guide, version 7 October 2025',1),
('RF','RLA','Rail Assembly',NULL,'IICL ECS','2025-10-07','2025-10-07','IICL Refrigerated Containers component codes reference guide, version 7 October 2025',1),
('RF','CPA','Corner Post Assembly',NULL,'IICL ECS','2025-10-07','2025-10-07','IICL Refrigerated Containers component codes reference guide, version 7 October 2025',1),
('RF','CFG','Corner Fitting',NULL,'IICL ECS','2025-10-07','2025-10-07','IICL Refrigerated Containers component codes reference guide, version 7 October 2025',1),
('RF','MHC','High cube strips',NULL,'IICL ECS','2025-10-07','2025-10-07','IICL Refrigerated Containers component codes reference guide, version 7 October 2025',1),
('RF','RCG','Roof Corner Gusset',NULL,'IICL ECS','2025-10-07','2025-10-07','IICL Refrigerated Containers component codes reference guide, version 7 October 2025',1),
('RF','HEP','Header Extension Plate',NULL,'IICL ECS','2025-10-07','2025-10-07','IICL Refrigerated Containers component codes reference guide, version 7 October 2025',1),
('RF','TFA','T-Floor Assembly',NULL,'IICL ECS','2025-10-07','2025-10-07','IICL Refrigerated Containers component codes reference guide, version 7 October 2025',1),
('RF','TFI','T-floor Strip',NULL,'IICL ECS','2025-10-07','2025-10-07','IICL Refrigerated Containers component codes reference guide, version 7 October 2025',1),
('RF','TFD','T-Floor Drain',NULL,'IICL ECS','2025-10-07','2025-10-07','IICL Refrigerated Containers component codes reference guide, version 7 October 2025',1),
('RF','PSL','Scuff Plate / Lining',NULL,'IICL ECS','2025-10-07','2025-10-07','IICL Refrigerated Containers component codes reference guide, version 7 October 2025',1),
('RF','CPJ','Corner Post J-bar',NULL,'IICL ECS','2025-10-07','2025-10-07','IICL Refrigerated Containers component codes reference guide, version 7 October 2025',1),
('RF','CMA','Crossmember assembly',NULL,'IICL ECS','2025-10-07','2025-10-07','IICL Refrigerated Containers component codes reference guide, version 7 October 2025',1),
('RF','DKK','Self-opening Drain',NULL,'IICL ECS','2025-10-07','2025-10-07','IICL Refrigerated Containers component codes reference guide, version 7 October 2025',1),
('RF','TUB','Tunnel Bolster',NULL,'IICL ECS','2025-10-07','2025-10-07','IICL Refrigerated Containers component codes reference guide, version 7 October 2025',1),
('RF','RTL','Gooseneck Tunnel Rail',NULL,'IICL ECS','2025-10-07','2025-10-07','IICL Refrigerated Containers component codes reference guide, version 7 October 2025',1),
('RF','TUP','Tunnel plate',NULL,'IICL ECS','2025-10-07','2025-10-07','IICL Refrigerated Containers component codes reference guide, version 7 October 2025',1);
