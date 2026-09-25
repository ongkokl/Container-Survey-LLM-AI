# Data Model

## Identity rule

**Never use `container_no` as the survey primary key.**

The same container can return to the depot repeatedly. The model distinguishes:

- **Container asset** — long-lived physical equipment.
- **Gate cycle** — one depot visit / gate-in event.
- **Survey** — inspection work for that gate cycle.
- **Finding** — one physical damage/condition.

## Example

```
TLLU1234567
  Gate Cycle 1
    2026-09-01 08:15
    Survey A
      Finding 1
      Finding 2

  Gate Cycle 2
    2026-10-18 14:32
    Survey B
      Finding 1
```

No earlier survey is overwritten.

## Active-cycle duplicate prevention

When door OCR returns a container number:

1. Validate ISO 6346 check digit.
2. Look for an active gate cycle.
3. If active cycle exists, return it and resume the existing survey.
4. If none exists, create the next cycle sequence and a new survey.

The database also has a partial unique index so a container cannot accidentally have two active gate cycles.

## Master vs snapshot

`containers.latest_iso_size_type` is a convenience value.

The authoritative historical observation is stored on each gate cycle:

- `observed_iso_code`
- `observed_container_type`
- `observed_length_ft`
- `observed_height_description`

This preserves what was actually read from the door during that visit.

## CEDEX reference data

Reference tables are version-aware. A component is looked up by at least:

`equipment_type + component_code + standard_version`

This avoids assuming a three-letter component code has the same meaning for GP and RF equipment.

## AI audit model

Original prediction and final surveyor result are separate records.

Example:

```
AI prediction:
  CPL / DT / GS

Surveyor final:
  HGB / DT / RP
```

The correction is retained as evidence for evaluation and future learning.
