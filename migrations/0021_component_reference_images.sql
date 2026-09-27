-- Phase 5.x: verified component reference-image library.
--
-- The current component classifier uses D1 text guidance plus the survey images.
-- This table adds a curated image-reference layer without making the reference
-- images authoritative. Images remain in R2; D1 stores only metadata and the R2 key.
--
-- 0020 is reserved by PR #55 (LBL visual guidance), so this migration is 0021.

CREATE TABLE IF NOT EXISTS component_reference_images (
  id TEXT PRIMARY KEY,
  equipment_type TEXT NOT NULL CHECK (equipment_type IN ('GP','RF')),
  component_code TEXT NOT NULL,
  container_face TEXT NOT NULL CHECK (
    container_face IN ('LEFT','RIGHT','FRONT','DOOR','ROOF','FLOOR','ANY')
  ),
  overview_zone TEXT NOT NULL DEFAULT 'ANY' CHECK (
    overview_zone IN ('TOP_EDGE','BOTTOM_EDGE','LEFT_EDGE','RIGHT_EDGE','CENTRAL_FIELD','UNKNOWN','ANY')
  ),
  r2_key TEXT NOT NULL UNIQUE,
  content_type TEXT NOT NULL DEFAULT 'image/jpeg',
  caption TEXT,
  visual_descriptor TEXT,
  source_reference TEXT NOT NULL,
  verification_status TEXT NOT NULL DEFAULT 'VERIFIED'
    CHECK (verification_status IN ('PENDING','VERIFIED','REJECTED')),
  embedding_status TEXT NOT NULL DEFAULT 'NOT_INDEXED'
    CHECK (embedding_status IN ('NOT_INDEXED','PENDING','INDEXED','FAILED')),
  vector_id TEXT,
  priority INTEGER NOT NULL DEFAULT 100,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_component_reference_lookup
ON component_reference_images(
  equipment_type,container_face,overview_zone,verification_status,active,priority DESC
);

CREATE INDEX IF NOT EXISTS idx_component_reference_code
ON component_reference_images(equipment_type,component_code,verification_status,active);

CREATE UNIQUE INDEX IF NOT EXISTS ux_component_reference_vector_id
ON component_reference_images(vector_id)
WHERE vector_id IS NOT NULL;
