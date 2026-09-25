# Container Survey LLM AI — POC Architecture

## Architectural rule

The application does **not** use the pattern:

`Photo -> LLM -> four CEDEX codes`

It uses:

`Evidence -> Observation -> Classification -> Rules -> Recommendation -> Human Decision -> Learning`

## Bounded contexts

1. **Identification**
   - Door photo
   - Container number OCR
   - ISO 6346 check-digit validation
   - ISO size/type lookup
   - GP/RF and physical dimensions

2. **Survey**
   - Gate-in cycle
   - Survey session
   - Findings
   - Photos
   - Annotations

3. **Vision**
   - Component recognition
   - Damage recognition
   - Ranked candidates and confidence
   - Pluggable model provider

4. **CEDEX**
   - Component codes
   - Damage codes
   - Repair codes
   - Valid component/damage/repair combinations
   - Deterministic location rules

5. **Decision**
   - Surveyor approve/reject/correct
   - Final survey value kept separate from original AI prediction

6. **Learning**
   - Corrections become training candidates
   - QA verification before training truth
   - Similar approved cases can be retrieved before model retraining

## Core domain hierarchy

```
Container Asset
  1 -> many Gate Cycles
          1 -> Survey
                1 -> many Findings
                        -> Photos
                        -> Annotations
                        -> AI Predictions
                        -> Surveyor Decisions
```

A container number identifies the physical equipment. A gate-cycle ID identifies one depot visit.

## Patterns used

- Domain/analysis model: Container, GateCycle, Survey, Finding, Evidence, Prediction, Decision.
- State pattern: lifecycle statuses instead of unrelated booleans.
- Repository pattern: D1 SQL remains behind repository interfaces.
- Service layer: route handlers call application services.
- Strategy/Adapter: Vision providers will be swappable (Cloudflare Qwen, OpenAI, specialist model).
- Table-driven rules: CEDEX validity is stored in D1, not hard-coded in prompts.
- Immutable prediction history: AI output is never overwritten by human correction.
- Candidate-list pattern: store top-N predictions, not only rank 1.
- Snapshot pattern: ISO/type observed at each gate cycle is preserved even when the master container record changes.
- Case-based reasoning: verified historical examples can be retrieved for future inference.
- Human-in-the-loop: surveyor remains final authority during POC.

## POC phase sequence

### Phase 1 — foundation
- Cloudflare Worker shell
- Mobile-first camera UI
- D1 normalized schema
- Container/gate-cycle model
- ISO 6346 validation
- Common ISO size/type reference seed
- Start/resume survey API

### Phase 2 — door OCR
- Upload door image to R2
- Vision OCR extracts container number + ISO size/type
- Check-digit validation
- ISO table decode
- Confirm/resume gate cycle

### Phase 3 — finding capture
- Overview photo
- Container-face annotation
- Damage location annotation
- Close-up photo
- Component and damage boxes/polygons

### Phase 4 — CEDEX AI
- Component candidate prediction
- Damage prediction
- Rule-based valid repairs
- Deterministic location code
- Single approval/edit screen

### Phase 5 — learning loop
- Store corrections
- Similar-case retrieval
- Evaluation dataset
- Versioned training export
