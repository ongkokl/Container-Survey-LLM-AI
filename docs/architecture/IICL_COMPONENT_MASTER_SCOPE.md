# IICL Component Master Scope

## Authoritative sources

The active GP/RF component master is derived only from:

- **GP / Dry Van:** IICL Dry Van Container component codes reference guide, revised 11 June 2025.
- **RF / Refrigerated:** IICL Refrigerated Containers component codes reference guide, version 7 October 2025.

The active master intentionally does not use COA-only supplemental component codes.

## Master size

| Equipment | Active IICL component codes |
| --- | ---: |
| GP / Dry Van | 66 |
| RF / Refrigerated | 114 |
| Total equipment-scoped rows | 180 |

Equipment scoping is important because the same CEDEX code can have a different meaning by equipment type. In particular, **RF/PAA = Subfloor** in the IICL refrigerated guide, while **GP/PAA = Panel Assembly**.

## Master vs Qwen candidate list

`component_codes` is the complete IICL catalogue for GP/RF.

`component_face_rules` is intentionally narrower. It controls which components may be offered to Qwen for the current six fixed external cameras:

- R = RIGHT
- L = LEFT
- D = DOOR
- F = FRONT
- T = ROOF
- B = FLOOR / underside

A component can therefore exist in the master without being a current Qwen candidate.

This avoids sending markings, interior cargo-space parts, and hidden machinery internals to Qwen when they cannot physically be the pinpointed component in the current external-camera workflow.

## Current candidate counts by fixed-camera face

| Equipment | LEFT | RIGHT | FRONT | DOOR | ROOF | FLOOR |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| GP | 14 | 14 | 10 | 39 | 5 | 17 |
| RF | 6 | 6 | 25 | 26 | 6 | 9 |

These are candidate counts, not master counts.

## Deliberately master-only examples

### GP

The IICL master includes marking/interior-floor codes such as `MSN`, `MMI`, `MST`, `MUI`, `MCH`, `MHT`, `MOL`, `MHC`, `MSD`, `FPP`, `FSP`, `LSB`, and `LSR`.

They remain in `component_codes`, but the current external six-camera classifier does not receive them unless a future inspection mode gives them a valid physical view.

### RF

The IICL master includes cargo-space interior components such as `PIC`, `PSL`, `TFA`, `TFI`, `PBK`, `TCI`, `GLI`, `EPA`, `TFF`, `THH`, `BPS`, `BSC`, `TFH`, `KSS`, `INP`, `TFC`, and `TFS`.

It also includes machinery internals such as `CYH`, `TMC`, `KVC`, `VCC`, `VMA`, `CBR`, `BDA`, `WIR`, `BMN`, `CTF`, `CBM`, `CSK`, `DRN`, `FKN`, `CCB`, `EDX`, `CFV`, `DPA`, `HVC`, `CSV`, `MVS`, `EVS`, `PMI`, and related service components.

They remain master data, but are not exposed to the normal external FRONT camera unless the component is externally visible in the IICL machinery-end overview.

This is also consistent with the IICL refrigerated guide's warning that the machinery section contains common cross-manufacturer components and that manufacturer manuals remain necessary for detailed machine-specific guidance.

## LBG vs HWR

The IICL Dry Van guide identifies both as separate component codes:

- `LBG` = Locking Bar Guide
- `HWR` = Hardware

The classifier therefore keeps both as GP DOOR candidates.

The D1 visual rule added with the full master explicitly tells Qwen:

- select `LBG` when the pinpoint is on the shaped locking-bar guide;
- select `HWR` when the pinpoint is on generic bolts, nuts, fasteners, or securing hardware;
- do not select `HWR` merely because hardware is attached to another identifiable component.

## Future expansion

If the POC later adds an interior-camera mode or a machinery service-panel inspection mode, the master does not need to be rebuilt. New `component_face_rules` (or a future inspection-view dimension) can expose the already-stored IICL components to Qwen.
