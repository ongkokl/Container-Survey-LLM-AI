-- Phase 4.4: D1-driven component visual knowledge.
--
-- This replaces hard-coded component-specific prompt rules with data that can be
-- expanded independently of TypeScript. Face applicability remains in
-- component_face_rules; this table adds visual cues, common confusions and
-- optional position-based review guards.

CREATE TABLE IF NOT EXISTS component_visual_rules (
  equipment_type TEXT NOT NULL CHECK (equipment_type IN ('GP','RF')),
  component_code TEXT NOT NULL,
  container_face TEXT NOT NULL CHECK (
    container_face IN ('LEFT','RIGHT','FRONT','DOOR','ROOF','FLOOR','ANY')
  ),
  overview_zone TEXT NOT NULL CHECK (
    overview_zone IN ('TOP_EDGE','BOTTOM_EDGE','LEFT_EDGE','RIGHT_EDGE','CENTRAL_FIELD','UNKNOWN','ANY')
  ),
  visual_definition TEXT NOT NULL,
  positive_cues TEXT,
  negative_cues TEXT,
  confusable_with TEXT,
  force_review INTEGER NOT NULL DEFAULT 0 CHECK (force_review IN (0,1)),
  source_reference TEXT NOT NULL,
  priority INTEGER NOT NULL DEFAULT 100,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  PRIMARY KEY (equipment_type,component_code,container_face,overview_zone)
);

CREATE INDEX IF NOT EXISTS idx_component_visual_rules_lookup
ON component_visual_rules(equipment_type,container_face,overview_zone,active,component_code);

-- Generic GP visual profiles. These are deliberately concise and based on the
-- supplied IICL Dry Van component reference guide (revised 11 June 2025).
INSERT OR REPLACE INTO component_visual_rules
(equipment_type,component_code,container_face,overview_zone,visual_definition,positive_cues,negative_cues,confusable_with,force_review,source_reference,priority,active)
VALUES
('GP','PAA','ANY','ANY','Panel assembly forming the broad corrugated container sheet/panel surface.','Continuous corrugated sheet; damage remains within the panel field.','A corrugation ridge, horizontal dent line, shadow or pressed profile is not a separate rail.','RLA,RDP',0,'IICL Dry Van component guide 2025-06-11, pp.1,3,4,10,16',100,1),
('GP','RLA','ANY','ANY','Distinct structural rail assembly forming part of the container frame or perimeter.','Separate structural member at an edge or frame line.','Do not classify ordinary corrugated panel sheet, its ridges/valleys or a dent line as a rail.','PAA,RDP,RLG',0,'IICL Dry Van component guide 2025-06-11, pp.1,3,4,10,12,16',100,1),
('GP','CFG','ANY','ANY','Corner fitting located at a container corner.','Block-like corner casting at the meeting of structural edges.','Not the adjacent panel sheet, rail or corner-post surface.','CPA,RLA',0,'IICL Dry Van component guide 2025-06-11, pp.1,3,10,16',100,1),
('GP','CPA','ANY','ANY','Corner post assembly: the vertical structural post at a container end/corner.','Distinct vertical corner/end structural member.','Not the broad corrugated wall field.','CPO,CFG,PAA',0,'IICL Dry Van component guide 2025-06-11, pp.3,16',100,1),
('GP','CPO','ANY','ANY','Corner post outer piece: the outer piece of the corner-post structure.','Outer vertical corner-post surface/piece.','Not the ordinary side-wall panel field.','CPA,PAA',0,'IICL Dry Van component guide 2025-06-11, pp.1,3,19-20',100,1),
('GP','RCI','ANY','ANY','Rail corner protector recess at the rail/corner recess area.','Localized recessed/protected rail-corner feature.','Not a broad wall or floor panel.','RLA,CFG',0,'IICL Dry Van component guide 2025-06-11, pp.1,5',100,1),
('GP','RLG','ANY','ANY','Rail gusset: a localized reinforcing gusset associated with a rail/underframe connection.','Small reinforcing gusset/plate at a structural joint.','Not a broad panel and not the full rail assembly.','RLA,RDP',0,'IICL Dry Van component guide 2025-06-11, pp.10-12,16',100,1),
('GP','RDP','ANY','ANY','Rail doubling plate: a localized reinforcing/doubling plate attached to a rail.','Distinct added plate on a rail section.','Do not use for the full rail or for corrugated wall sheet.','RLA,RLG,PAA',0,'IICL Dry Van component guide 2025-06-11, p.10',100,1),
('GP','HEP','ANY','ANY','Header extension plate at the upper end/header structure.','Plate associated with the header at the upper end.','Not a general roof or side panel.','RLA,RCG',0,'IICL Dry Van component guide 2025-06-11, pp.4,10',100,1),
('GP','RCG','ANY','ANY','Roof corner gusset reinforcing the roof-corner structure.','Localized gusset at the upper roof corner.','Not the broad roof panel or header extension plate.','HEP,RLA',0,'IICL Dry Van component guide 2025-06-11, p.4',100,1),
('GP','MHC','ANY','ANY','High-cube identification stripes/marking feature.','High-cube stripe marking itself is the target.','Do not use when the damage is to underlying panel or structure rather than the marking.','PAA,RLA',0,'IICL Dry Van component guide 2025-06-11, pp.4,13,16',100,1),
('GP','VRA','ANY','ANY','Ventilator unit fitted to the container wall.','Visible ventilator opening/unit is the damaged object.','Do not use merely because a ventilator is near damage on the surrounding panel.','PAA',0,'IICL Dry Van component guide 2025-06-11, p.1',100,1),

-- GP door hardware visible in the IICL door reference pages.
('GP','HGA','DOOR','ANY','Complete door hinge assembly.','Damage involves the hinge as an assembled unit.','Use a subcomponent code when only the blade, pin or lug is specifically damaged.','HGB,HGP,CPL',0,'IICL Dry Van component guide 2025-06-11, pp.13,15',110,1),
('GP','HGB','DOOR','ANY','Hinge blade: the blade/leaf portion of the door hinge.','Target is the flat hinge blade attached to the door.','Not the hinge pin, hinge lug or whole hinge assembly when a subpart is identifiable.','HGA,HGP,CPL',0,'IICL Dry Van component guide 2025-06-11, pp.13,15',110,1),
('GP','HGP','DOOR','ANY','Hinge pin: the pin joining the hinge parts.','Target is the cylindrical hinge pin.','Not the blade or corner-post hinge lug.','HGA,HGB,CPL',0,'IICL Dry Van component guide 2025-06-11, p.15',110,1),
('GP','CPL','DOOR','ANY','Corner-post hinge lug supporting the hinge pin at the post.','Target is the hinge lug fixed to the corner-post structure.','Not the hinge blade or pin.','HGA,HGB,HGP',0,'IICL Dry Van component guide 2025-06-11, p.15',110,1),
('GP','LBR','DOOR','ANY','Locking bar rod: the long vertical locking rod on the door.','Damage is on the rod itself.','Not the bracket, guide, cam or handle.','LBB,LBG,LBC,LBH',0,'IICL Dry Van component guide 2025-06-11, p.13',110,1),
('GP','LBB','DOOR','ANY','Locking bar bracket supporting the locking-bar system.','Target is a bracket retaining/supporting the rod.','Not the long rod, guide, cam or handle.','LBR,LBG,LBC,LBH',0,'IICL Dry Van component guide 2025-06-11, p.13',110,1),
('GP','LBG','DOOR','ANY','Locking bar guide guiding the locking-bar rod.','Target is the guide through/along which the rod runs.','Not the bracket or rod itself.','LBR,LBB',0,'IICL Dry Van component guide 2025-06-11, p.13',110,1),
('GP','LBC','DOOR','ANY','Locking bar cam at the end of the locking mechanism.','Target is the cam-shaped locking end component.','Not the long rod or guide.','LBR,LBG',0,'IICL Dry Van component guide 2025-06-11, pp.13,20',110,1),
('GP','LBH','DOOR','ANY','Locking bar handle used to operate the locking bar.','Target is the hand-operated handle.','Not the rod, bracket, guide or handle hub.','LBR,LBB,LBG,LHH',0,'IICL Dry Van component guide 2025-06-11, p.13',110,1),
('GP','LHH','DOOR','ANY','Locking-bar handle hub at the handle pivot.','Target is the handle hub/pivot component.','Not the complete handle or locking rod.','LBH,LBR',0,'IICL Dry Van component guide 2025-06-11, p.13',110,1),
('GP','GTA','DOOR','ANY','Door gasket assembly forming the flexible perimeter seal.','Target is the gasket/seal itself.','Not the adjacent door panel or hinge component.','HGA',0,'IICL Dry Van component guide 2025-06-11, p.15',110,1),

-- D1 position rules replacing the former hard-coded GP side-wall guard.
('GP','PAA','LEFT','CENTRAL_FIELD','Central side-wall location is normally the corrugated panel field.','PAA is strongly supported when the target lies on continuous corrugated sheet.','If a clearly separate fitted component is visible, classify that component instead.','RLA,VRA',0,'IICL Dry Van component guide 2025-06-11, pp.1,3',200,1),
('GP','PAA','RIGHT','CENTRAL_FIELD','Central side-wall location is normally the corrugated panel field.','PAA is strongly supported when the target lies on continuous corrugated sheet.','If a clearly separate fitted component is visible, classify that component instead.','RLA,VRA',0,'IICL Dry Van component guide 2025-06-11, pp.1,3',200,1),
('GP','RLA','LEFT','CENTRAL_FIELD','A central side-wall point is inconsistent with RLA unless a distinct structural rail is visibly present.','Require a separate rail member, not a panel profile.','Horizontal dent lines, shadows and corrugation geometry are not rails.','PAA',1,'Component QA rule derived from IICL Dry Van guide 2025-06-11 side-wall diagrams',220,1),
('GP','RLA','RIGHT','CENTRAL_FIELD','A central side-wall point is inconsistent with RLA unless a distinct structural rail is visibly present.','Require a separate rail member, not a panel profile.','Horizontal dent lines, shadows and corrugation geometry are not rails.','PAA',1,'Component QA rule derived from IICL Dry Van guide 2025-06-11 side-wall diagrams',220,1),
('GP','RDP','LEFT','CENTRAL_FIELD','A rail doubling plate should not be selected in the central wall field without a distinct rail-mounted plate.','Require a localized plate attached to a rail.','Do not infer a doubling plate from panel deformation.','PAA,RLA',1,'Component QA rule derived from IICL Dry Van guide 2025-06-11 p.10',220,1),
('GP','RDP','RIGHT','CENTRAL_FIELD','A rail doubling plate should not be selected in the central wall field without a distinct rail-mounted plate.','Require a localized plate attached to a rail.','Do not infer a doubling plate from panel deformation.','PAA,RLA',1,'Component QA rule derived from IICL Dry Van guide 2025-06-11 p.10',220,1),
('GP','RLG','LEFT','CENTRAL_FIELD','A rail gusset should not be selected in the central wall field without a visible structural gusset.','Require a localized reinforcing gusset at a structural joint.','Do not infer a gusset from corrugation or dents.','PAA,RLA',1,'Component QA rule derived from IICL Dry Van guide 2025-06-11 pp.10-12,16',220,1),
('GP','RLG','RIGHT','CENTRAL_FIELD','A rail gusset should not be selected in the central wall field without a visible structural gusset.','Require a localized reinforcing gusset at a structural joint.','Do not infer a gusset from corrugation or dents.','PAA,RLA',1,'Component QA rule derived from IICL Dry Van guide 2025-06-11 pp.10-12,16',220,1),
('GP','CFG','LEFT','CENTRAL_FIELD','A central side-wall point is not a corner fitting.','Corner fitting requires the target to be at a container corner.','Do not infer CFG from nearby structural lines.','PAA,CPA',1,'Component QA rule derived from IICL Dry Van guide 2025-06-11 corner diagrams',220,1),
('GP','CFG','RIGHT','CENTRAL_FIELD','A central side-wall point is not a corner fitting.','Corner fitting requires the target to be at a container corner.','Do not infer CFG from nearby structural lines.','PAA,CPA',1,'Component QA rule derived from IICL Dry Van guide 2025-06-11 corner diagrams',220,1),
('GP','CPA','LEFT','CENTRAL_FIELD','A central side-wall point is not normally the corner-post assembly.','Require the target to lie on the vertical corner/end post structure.','Do not classify the central corrugated wall sheet as CPA.','PAA,CPO',1,'Component QA rule derived from IICL Dry Van guide 2025-06-11 pp.3,16',220,1),
('GP','CPA','RIGHT','CENTRAL_FIELD','A central side-wall point is not normally the corner-post assembly.','Require the target to lie on the vertical corner/end post structure.','Do not classify the central corrugated wall sheet as CPA.','PAA,CPO',1,'Component QA rule derived from IICL Dry Van guide 2025-06-11 pp.3,16',220,1),
('GP','CPO','LEFT','CENTRAL_FIELD','A central side-wall point is not normally the corner-post outer piece.','Require the target to lie on the outer corner-post structure.','Do not classify the central corrugated wall sheet as CPO.','PAA,CPA',1,'Component QA rule derived from IICL Dry Van guide 2025-06-11 pp.1,3',220,1),
('GP','CPO','RIGHT','CENTRAL_FIELD','A central side-wall point is not normally the corner-post outer piece.','Require the target to lie on the outer corner-post structure.','Do not classify the central corrugated wall sheet as CPO.','PAA,CPA',1,'Component QA rule derived from IICL Dry Van guide 2025-06-11 pp.1,3',220,1),

-- RF visual profiles from the supplied IICL Refrigerated Containers guide,
-- version 7 October 2025. RF/PAA is Subfloor in this application.
('RF','PAA','ANY','ANY','Subfloor structure beneath the refrigerated container floor.','Target is on the underside/subfloor structure.','Do not use for the visible interior T-floor assembly or individual T-floor strips.','TFA,TFI,CMA',0,'IICL Refrigerated component guide 2025-10-07, pp.21-23',100,1),
('RF','POC','ANY','ANY','Panel outer cladding: the external skin of a refrigerated panel assembly.','Damage is on the external cladding/skin.','Not the inner liner, insulation or internal stiffener.','PIC,PIM,PIS',0,'IICL Refrigerated component guide 2025-10-07, p.9; COA CEDEX V2.0 p.77',100,1),
('RF','PIC','ANY','ANY','Panel inner cladding: the internal liner/cladding surface of a refrigerated panel.','Damage is on the visible interior cladding/liner.','Not the outer skin or exposed insulation.','POC,PIM,PIS',0,'IICL Refrigerated component guide 2025-10-07, p.4; COA CEDEX V2.0 p.77',100,1),
('RF','RLA','ANY','ANY','Distinct structural rail assembly.','Separate structural rail member is visibly targeted.','Do not infer a rail from panel seams, shadows or T-floor strip lines.','POC,PIC,TFA',0,'IICL Refrigerated component guide 2025-10-07, pp.9-10,19',100,1),
('RF','CPA','ANY','ANY','Corner post assembly at a refrigerated container end/corner.','Target lies on the vertical corner-post structure.','Not the broad panel cladding.','POC,PIC,CFG',0,'IICL Refrigerated component guide 2025-10-07, p.9',100,1),
('RF','CFG','ANY','ANY','Corner fitting at a refrigerated container corner.','Block-like corner casting is the damaged object.','Not adjacent rail, panel or corner post.','CPA,RLA',0,'IICL Refrigerated component guide 2025-10-07, pp.2,9-10',100,1),
('RF','MHC','ANY','ANY','High-cube identification stripes/marking feature.','The high-cube stripe marking itself is the target.','Do not use for underlying panel damage.','POC,PIC',0,'IICL Refrigerated component guide 2025-10-07, pp.2-3,9-10',100,1),
('RF','RCG','ANY','ANY','Roof corner gusset reinforcing the roof-corner structure.','Localized roof-corner gusset is visible.','Not the general roof panel or header extension plate.','HEP,RLA',0,'IICL Refrigerated component guide 2025-10-07, pp.9-10',100,1),
('RF','HEP','ANY','ANY','Header extension plate at the upper header/end structure.','Target is the distinct header extension plate.','Not the general roof panel or roof corner gusset.','RCG,RLA',0,'IICL Refrigerated component guide 2025-10-07, pp.9-10',100,1),
('RF','TFA','ANY','ANY','T-floor assembly: the complete interior T-floor structure.','Damage affects the T-floor assembly as a whole rather than one identifiable strip.','If one individual strip is clearly isolated, consider TFI.','TFI,TFD',0,'IICL Refrigerated component guide 2025-10-07, pp.4,19',100,1),
('RF','TFI','ANY','ANY','T-floor strip: an individual strip/profile within the T-floor.','A single identifiable T-floor strip is the damaged object.','Do not use for the whole floor assembly or drain.','TFA,TFD',0,'IICL Refrigerated component guide 2025-10-07, pp.4,19',100,1),
('RF','TFD','ANY','ANY','T-floor drain located at the floor/drain area.','The drain opening/component itself is damaged.','Not the surrounding T-floor strip or assembly.','TFA,TFI,DKK',0,'IICL Refrigerated component guide 2025-10-07, p.4',100,1),
('RF','PSL','ANY','ANY','Scuff plate / lining along the lower interior wall area.','Target is the scuff/lining plate itself.','Not the adjacent inner cladding or T-floor.','PIC,TFA',0,'IICL Refrigerated component guide 2025-10-07, p.4',100,1),
('RF','CPJ','ANY','ANY','Corner-post J-bar at the refrigerated container corner/interior edge.','J-shaped corner-post edge member is the target.','Not the broad inner cladding or hinge hardware.','PIC,CPA',0,'IICL Refrigerated component guide 2025-10-07, pp.4,7',100,1),
('RF','CMA','ANY','ANY','Crossmember assembly: transverse underframe member beneath the floor.','Target is a transverse structural crossmember.','Not the broad subfloor sheet or tunnel rail.','PAA,RTL,TUB',0,'IICL Refrigerated component guide 2025-10-07, pp.21-22',100,1),
('RF','DKK','ANY','ANY','Self-opening drain on the refrigerated container underside.','Target is the self-opening drain component.','Not the T-floor drain or surrounding subfloor.','TFD,PAA',0,'IICL Refrigerated component guide 2025-10-07, pp.21,23',100,1),
('RF','TUB','ANY','ANY','Tunnel bolster in the refrigerated container understructure.','Target is the distinct tunnel bolster structure.','Not the tunnel plate or gooseneck tunnel rail.','RTL,TUP,CMA',0,'IICL Refrigerated component guide 2025-10-07, pp.21-23',100,1),
('RF','RTL','ANY','ANY','Gooseneck tunnel rail in the refrigerated container understructure.','Target follows the longitudinal tunnel rail member.','Not the tunnel plate, bolster or crossmember.','TUP,TUB,CMA',0,'IICL Refrigerated component guide 2025-10-07, pp.21-23',100,1),
('RF','TUP','ANY','ANY','Tunnel plate forming the plate surface of the gooseneck tunnel.','Target is on the tunnel plate surface.','Not the tunnel rail or bolster.','RTL,TUB',0,'IICL Refrigerated component guide 2025-10-07, pp.22-23',100,1),
('RF','PIM','ANY','ANY','Insulation material within a refrigerated panel assembly.','Exposed insulation material itself is the damaged object.','Not the inner or outer cladding skin.','PIC,POC,PIS',0,'COA CEDEX Syntax Visualisation Component Codes V2.0, p.77',100,1),
('RF','PIS','ANY','ANY','Panel internal stiffener within a refrigerated panel assembly.','Exposed internal stiffener is the damaged object.','Not insulation or cladding skin.','PIC,POC,PIM',0,'COA CEDEX Syntax Visualisation Component Codes V2.0, p.77',100,1),

-- RF side-wall central-field guard for structural edge components.
('RF','RLA','LEFT','CENTRAL_FIELD','A central reefer side-wall point is inconsistent with RLA unless a separate structural rail is clearly visible.','Require a distinct structural rail.','Do not infer a rail from panel seams or shadow lines.','POC,PIC',1,'Component QA rule derived from IICL Refrigerated guide 2025-10-07 p.9',210,1),
('RF','RLA','RIGHT','CENTRAL_FIELD','A central reefer side-wall point is inconsistent with RLA unless a separate structural rail is clearly visible.','Require a distinct structural rail.','Do not infer a rail from panel seams or shadow lines.','POC,PIC',1,'Component QA rule derived from IICL Refrigerated guide 2025-10-07 p.9',210,1),
('RF','CPA','LEFT','CENTRAL_FIELD','A central reefer side-wall point is not normally the corner-post assembly.','Require visible corner/end post structure.','Do not classify broad cladding as CPA.','POC,PIC',1,'Component QA rule derived from IICL Refrigerated guide 2025-10-07 p.9',210,1),
('RF','CPA','RIGHT','CENTRAL_FIELD','A central reefer side-wall point is not normally the corner-post assembly.','Require visible corner/end post structure.','Do not classify broad cladding as CPA.','POC,PIC',1,'Component QA rule derived from IICL Refrigerated guide 2025-10-07 p.9',210,1),
('RF','CFG','LEFT','CENTRAL_FIELD','A central reefer side-wall point is not a corner fitting.','Corner fitting requires a container corner.','Do not infer CFG from nearby structural lines.','POC,CPA',1,'Component QA rule derived from IICL Refrigerated guide 2025-10-07 pp.9-10',210,1),
('RF','CFG','RIGHT','CENTRAL_FIELD','A central reefer side-wall point is not a corner fitting.','Corner fitting requires a container corner.','Do not infer CFG from nearby structural lines.','POC,CPA',1,'Component QA rule derived from IICL Refrigerated guide 2025-10-07 pp.9-10',210,1);
