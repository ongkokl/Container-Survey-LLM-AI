-- Phase 4 corrective migration: retire superseded component definitions.
-- The IICL equipment-specific ECS guide is authoritative for the app's active
-- equipment-scoped master where an older generic COA visualisation conflicts.
--
-- In the supplied IICL Refrigerated Containers reference guide (2025-10-07),
-- RF/PAA is Subfloor. Retire the older active COA 2.0 RF/PAA = Panel Assembly
-- row so classification never receives two meanings for the same active code.

UPDATE component_codes
SET active=0, effective_to='2025-10-06'
WHERE equipment_type='RF'
  AND component_code='PAA'
  AND standard_version='2.0'
  AND component_name='Panel Assembly';

-- Defensive invariant for the current classifier: one active semantic meaning
-- per equipment type + component code. Historical rows remain queryable.
CREATE INDEX IF NOT EXISTS idx_component_codes_active_lookup
ON component_codes(equipment_type, component_code, active);
