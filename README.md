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

## Phase 1 foundation

Implemented on branch `poc-phase-1-foundation`:

- Cloudflare Worker + static mobile UI
- D1 normalized data model
- Container asset vs repeated gate-cycle model
- ISO 6346 container-number validation
- Common GP/RF ISO size/type seed data
- Start/resume survey API
- R2/Workers AI bindings prepared
- Architecture and data-model documentation
- ISO 6346 unit tests

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

## Current API

### Health

```
GET /api/health
```

### Validate container identity

```
POST /api/container/validate
Content-Type: application/json

{
  "containerNo": "MSCU6639870",
  "isoSizeType": "45G1"
}
```

### Start or resume gate cycle

```
POST /api/surveys/start
Content-Type: application/json

{
  "containerNo": "MSCU6639870",
  "isoSizeType": "45G1",
  "depotCode": "POC"
}
```

If the same container already has an active gate cycle, the API returns that existing survey instead of creating a duplicate cycle.

## Documentation

- `docs/architecture/POC_ARCHITECTURE.md`
- `docs/data-model/DATA_MODEL.md`

## Next phase

Phase 2 will connect the door-camera image to Vision OCR, store the image in R2, extract container number + ISO size/type, validate them, and create/resume the gate cycle automatically.
