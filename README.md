# Container Survey LLM AI

Mobile-first Cloudflare POC for depot container surveying with Vision LLM assistance and CEDEX/ECS code validation.

## POC objective

The app will help an IICL-trained surveyor:

1. Photograph the container door.
2. OCR the ISO 6346 container number and ISO size/type code.
3. Validate the check digit and derive GP/RF + container dimensions.
4. Capture an overview photo and mark the damage location.
5. Capture a close-up photo and mark the component/damage.
6. Suggest CEDEX component, damage, repair and location codes.
7. Let the surveyor approve or correct every result.
8. Preserve corrections for retrieval/evaluation and later retraining.

## Architecture principle

```
Evidence
  -> Observation
  -> Classification
  -> CEDEX rules
  -> Recommendation
  -> Surveyor decision
  -> Learning
```

The system does not rely on one unconstrained prompt to invent four codes.

## Implemented

### Phase 1 — foundation

- Cloudflare Worker + static mobile UI
- D1 normalized data model
- Container asset vs repeated gate-cycle model
- ISO 6346 container-number validation
- Common GP/RF ISO size/type seed data
- Start/resume survey API
- R2/Workers AI bindings prepared
- Architecture and data-model documentation
- ISO 6346 unit tests

### Phase 2 — door Vision OCR

- Mobile door-camera upload
- Client-side image optimisation for OCR
- Door photo stored in R2
- Qwen 3.8 27B vision provider
- Extracts container number + ISO size/type
- ISO 6346 check-digit validation
- D1 ISO size/type lookup
- Surveyor review/edit before confirmation
- Creates or resumes the correct gate-in cycle
- Preserves the original OCR attempt and final confirmed identity separately
- Door photo linked to the survey evidence
- CI workflow for TypeScript + unit tests

## Cloudflare resources

Create:

```bash
npx wrangler d1 create container-survey-db
npx wrangler r2 bucket create container-survey-photos
```

Copy the D1 database ID into `wrangler.jsonc`, replacing:

```
REPLACE_WITH_D1_DATABASE_ID
```

Then:

```bash
npm install
npm run db:migrate:local
npm run dev
```

For the deployed database:

```bash
npm run db:migrate:remote
```

## Vision model

Phase 2 uses Cloudflare Workers AI:

```
@cf/qwen/qwen3.8-27b
```

The model is used only to read visible markings. Application code performs ISO 6346 validation and database lookup rather than trusting model interpretation.

## Current API

### Health

```
GET /api/health
```

### Analyse door photo

```
POST /api/door/identify
Content-Type: multipart/form-data

doorPhoto=<image>
```

Returns the OCR observation, confidence, deterministic validation result, and derived GP/RF/container dimensions when the ISO code exists in D1.

### Confirm door identity

```
POST /api/door/confirm
Content-Type: application/json

{
  "attemptId": "...",
  "containerNo": "MSCU6639870",
  "isoSizeType": "45G1",
  "depotCode": "POC"
}
```

Confirmation creates a new gate cycle or resumes the existing active gate cycle for the same container.

### Validate identity manually

```
POST /api/container/validate
Content-Type: application/json
```

### Start/resume manually

```
POST /api/surveys/start
Content-Type: application/json
```

## Data handling

The container number is the long-lived asset identity, not the survey key.

```
Container
  -> Gate Cycle 1 -> Survey
  -> Gate Cycle 2 -> Survey
  -> Gate Cycle 3 -> Survey
```

Door OCR is also treated as evidence rather than truth:

```
Door photo
  -> AI OCR observation
  -> ISO validation
  -> Surveyor confirmation/edit
  -> final gate-cycle identity
```

## Documentation

- `docs/architecture/POC_ARCHITECTURE.md`
- `docs/data-model/DATA_MODEL.md`

## Next phase

Phase 3 will add finding capture:

- overview photo of the relevant container face
- surveyor-drawn container-face boundary
- damage location marker
- close-up component photo
- component and damage annotations
- R2 + D1 persistence ready for CEDEX vision analysis
