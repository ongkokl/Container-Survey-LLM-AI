# Component review and master-data updates

## Deployment order

Apply migration 0008 before deploying this Worker. On a checkout containing this PR:

```bash
npm run db:migrate:remote
npm run deploy
```

The new runtime rejects every duplicate active equipment/code pair rather than hiding older active rows. Deploying it before migration 0008 can temporarily block classification or component confirmation for equipment with the existing duplicates. No findings, photos, AI predictions or surveyor decisions are changed by the migration.

Migration 0008 retires only the known COA 2.0 GP/RLA, RF/PIC and RF/POC rows when their exact equipment-specific IICL successors are active. It retains the old rows with end dates. RF/PAA was already addressed in migration 0006. Unknown conflicts cause the unique-index creation to fail; investigate and explicitly resolve them, then rerun the migration. Do not bypass the index or choose an arbitrary date-tie winner.

Review the live master before migration if it has been edited outside the committed migrations:

```sql
SELECT equipment_type, component_code, COUNT(*) AS active_versions,
       GROUP_CONCAT(standard_version || ': ' || component_name, ' | ') AS definitions
FROM component_codes
WHERE active = 1
GROUP BY equipment_type, component_code
HAVING COUNT(*) > 1;
```

## Review threshold

`COMPONENT_REVIEW_THRESHOLD` in `wrangler.jsonc` defaults to `"0.80"`. Values must be greater than 0 and at most 1; missing/invalid settings fall back to 0.80. Below-threshold confidence, missing confidence, no selected code, or a model review request triggers review. Exactly 0.80 passes the confidence rule but cannot override the model's review request. All component suggestions still require a surveyor decision.

The threshold is a provisional workflow setting, not a calibrated accuracy boundary. A low-confidence suggestion remains visible and can be confirmed or corrected. The API exposes `reviewThreshold` and `reviewReasons`, and the run records these values for audit. Failed or incomplete AI responses keep their existing error handling.

## Future master changes

There is no component-master import endpoint in this POC. Deliver changes through a reviewed new migration, or an atomic D1 batch in a future importer. Do not edit/replay historical seed migrations and do not use INSERT OR REPLACE / UPDATE OR REPLACE for this table. Triggers reject attempts to replace existing versions or competing active rows because REPLACE can delete history.

For a semantic revision:

1. Verify the source, equipment, code, meaning, version and effective date. Explicitly identify the version being superseded; a later date alone does not establish authority.
2. In one migration/batch, retire that exact current row (`active=0`, with an appropriate `effective_to`) and INSERT the new version as active.
3. Retain the old version's meaning and provenance. Use a new version key for revised definitions. An existing version key must not be reinserted.
4. If an unexpected active version exists, the unique index / triggers must reject the update. Resolve it deliberately instead of disabling the protections.

The database enforces one active definition per equipment/code. The runtime also detects conflicts, including equal/null dates, if the database invariant is missing or the deployment is out of order. It returns `COMPONENT_MASTER_CONFLICT` before inference or confirmation. Face filtering remains equipment-only until a verified many-to-many face mapping is available.
