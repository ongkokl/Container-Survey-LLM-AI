# Component Reference Image Library

## Purpose

Component recognition currently combines:

1. equipment type (GP / RF),
2. recorded container face,
3. face-filtered CEDEX component candidates,
4. D1 component visual rules,
5. overview position,
6. the target damage close-up,
7. Qwen vision classification,
8. independent confidence / review guards.

This phase adds a **verified reference-image layer**. It does not replace the
existing rules and does not make reference images authoritative.

## Storage design

### D1

`component_reference_images` stores metadata only:

- equipment type
- CEDEX component code
- container face
- optional overview zone
- R2 object key
- caption
- optional visual descriptor
- source reference
- verification status
- future embedding status / vector ID
- priority

### R2

The actual verified images are stored under:

```text
component-reference/{equipment}/{component}/{face}/{reference-id}.{ext}
```

Survey images continue to use the existing survey/finding prefixes.

## Qwen classification flow

```text
Target survey finding
        |
        +-- equipment + face
        |
        +-- D1 allowed components
        |
        +-- D1 component_visual_rules
        |
        +-- overview position
        |
        +-- target close-up
        |
        +-- up to 3 verified R2 reference examples
        v
Qwen component classification
        |
        +-- backend confidence threshold
        +-- visual-rule review guards
        v
Surveyor confirmation
```

Reference examples are explicitly labelled as **comparison only**. The prompt
also states that lack of a reference example is not negative evidence for a
component code.

Only references whose component code is already in the face-filtered allowed
list can reach Qwen.

## Uploading a verified reference image

The upload endpoint is disabled until an admin token is configured.

Set the secret:

```bash
npx wrangler secret put COMPONENT_REFERENCE_ADMIN_TOKEN
```

Upload endpoint:

```text
POST /api/admin/component-reference-image
Authorization: Bearer <COMPONENT_REFERENCE_ADMIN_TOKEN>
Content-Type: multipart/form-data
```

Form fields:

| Field | Required | Example |
|---|---|---|
| photo | yes | reference image |
| equipmentType | yes | GP |
| componentCode | yes | LBR |
| containerFace | yes | DOOR |
| overviewZone | no | ANY |
| sourceReference | yes | IICL Dry Van component guide 2025-06-11 p.13 |
| caption | no | Vertical locking bar rod on dry container door |
| visualDescriptor | no | Long vertical cylindrical rod mounted to door leaf |
| priority | no | 100 |

The backend validates that the component is allowed for the chosen equipment
type and face before the D1 record is created.

If the D1 insert fails after the R2 upload, the uploaded R2 object is deleted so
the operation does not leave an orphaned file.

## Reference image curation rules

A reference image should be added only when:

- its component identity has been independently verified,
- the source/provenance is recorded,
- the target component is clearly visible,
- the image does not intentionally teach a wrong or ambiguous label,
- copyrighted source material is used only when storage/use is permitted.

Do not promote ordinary survey images automatically into the verified reference
library. Surveyor-approved production findings can become training candidates,
but verification should remain a separate step.

## Vector similarity — next phase

The schema already contains:

- `visual_descriptor`
- `embedding_status`
- `vector_id`

so the next phase can add retrieval without another reference-library redesign.

Cloudflare Vectorize supports storing/querying embeddings, and the current
Workers AI catalog provides text-embedding models such as
`@cf/baai/bge-base-en-v1.5` (768 dimensions).

A Cloudflare-native POC path is:

```text
verified reference image
        |
        v
Qwen produces controlled visual descriptor
        |
        v
text embedding model (768d)
        |
        v
Vectorize
        |
        +-----------------------------+
                                      |
target close-up                       |
        |                             |
        v                             |
Qwen controlled visual descriptor    |
        |                             |
        v                             |
same text embedding model            |
        |                             |
        v                             |
Vectorize similarity search ---------+
        |
        v
top verified examples
        |
        v
Qwen final component classification
```

This is deliberately separated from this phase. Adding a Vectorize binding
before the index exists would break deployment.

Cloudflare documentation:

- https://developers.cloudflare.com/vectorize/
- https://developers.cloudflare.com/vectorize/get-started/embeddings/
- https://developers.cloudflare.com/workers-ai/models/
