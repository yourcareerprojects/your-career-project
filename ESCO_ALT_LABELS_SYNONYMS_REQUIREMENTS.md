# ESCO altLabels Synonyms Requirements

## Overview

ESCO occupations include `altLabels` (alternative labels) and `hiddenLabels` which can be used as **synonyms** for a role title.

This document defines requirements for:
- Where synonyms are stored in the backend data model
- How synonyms are exposed via API for search/autocomplete and details pages
- Where synonyms are displayed in the UI
- Whether synonyms influence simulation matching/scoring (and how, if at all)

## Goals

- **Improve findability**: Users can find the right occupation even if they type a non-canonical title.
- **Improve UX clarity**: Users can see that a role has multiple names (“Also known as …”).
- **Preserve data integrity**: One canonical role per ESCO occupation (`escoId`); synonyms never create duplicates.
- **Avoid performance regressions**: Do not ship large synonym payloads to the client unnecessarily.

## Non-Goals

- Building a full taxonomy browser (ISCO hierarchy navigation).
- Replacing ESCO titles with curated titles everywhere.
- Using synonyms as a primary scoring signal for the simulation (Phase 1).

---

## Data Model Requirements

### 1) Persist synonyms on `CareerPath`
- **Requirement**: The `CareerPath` model must store ESCO occupation synonyms as arrays:
  - `altTitles: string[]` (from ESCO `altLabels`)
  - `hiddenTitles: string[]` (from ESCO `hiddenLabels`)
- **Requirement**: Synonym strings must be:
  - Trimmed
  - De-duplicated within each array
  - Preserved as human-readable strings (no URI encoding)
- **Acceptance Criteria**:
  - Imported occupations contain `altTitles` for roles where ESCO provides `altLabels`.
  - No empty strings exist in `altTitles`/`hiddenTitles`.

### 2) Provenance
- **Requirement**: `CareerPath.importedFrom` and `sourceVersion` must be maintained so synonym behavior can be audited by dataset version.

---

## Import / Ingestion Requirements

### 3) CSV import populates synonym fields
- **Requirement**: `scripts/importEscoOccupations.js` (or equivalent ingestion) must map:
  - `occupations_en.csv.altLabels` → `CareerPath.altTitles`
  - `occupations_en.csv.hiddenLabels` → `CareerPath.hiddenTitles`
- **Acceptance Criteria**:
  - A sample imported occupation with multiline `altLabels` results in multiple entries in `altTitles`.

---

## API Requirements

### 4) Occupation title search (recommended primary integration)
**Problem**: Returning *all* titles + synonyms to the client does not scale well and creates noisy autocomplete lists.

- **Requirement**: Implement a server-side search endpoint for occupation titles that matches against:
  - `title` (primary)
  - `altTitles` (synonyms)
  - (optional) `hiddenTitles` (only if needed; lower priority)

**Implemented endpoint**:
- `GET /api/occupations/search?q=<text>&limit=<n>` (optional `includeHidden=1` — see `src/server/routes/occupations.js`)

**Response shape**:
```json
{
  "success": true,
  "results": [
    {
      "escoId": "http://data.europa.eu/esco/occupation/…",
      "title": "technical director",
      "matchedBy": "title|altTitles|hiddenTitles",
      "matchedValue": "head of technical",
      "synonymsPreview": ["head of technical", "technical manager"]
    }
  ]
}
```

- **Acceptance Criteria**:
  - Searching for a synonym returns the canonical occupation `title`.
  - The response indicates whether the match was via synonym (`matchedBy !== 'title'`).
  - The endpoint supports a `limit` to prevent overly large responses.

### 5) Backward-compatible titles endpoint
- **Requirement**: `GET /api/occupations/titles` must remain backward compatible for existing UI usage.
- **Optional Enhancement**: Add `includeSynonyms=1` query param if needed later, but **default must remain titles-only**.

### 6) Occupation lookup includes synonyms for detail pages
- **Requirement**: `GET /api/occupations/lookup?escoId=…|title=…` should return `altTitles` and `hiddenTitles` when present.
- **Acceptance Criteria**:
  - When a result details page enriches from `/lookup`, it receives synonyms without requiring additional calls.

---

## UI Requirements

### 7) Simulation page: Career Goal dropdown uses synonym-aware search
- **Requirement**: The “Career Goal” field autocomplete must match user input against:
  - Canonical titles
  - Synonyms (`altTitles`)
- **Requirement**: Suggestions must display:
  - **Primary label**: canonical `title`
  - **Secondary hint** (when matched by synonym): “Also known as: <matchedValue>”
- **Performance Requirement**:
  - Autocomplete should use **server-side search** (`/api/occupations/search`) with debouncing.

**Acceptance Criteria**:
- Typing “head of technical” suggests “technical director” and indicates the matched synonym.
- Selecting a suggestion stores/uses the canonical `title` (and `escoId` where possible).

### 8) Career step details pages: display synonyms (context-independent)
Pages:
- Unsaved simulation detail (`SimulationResultDetails`)
- Saved simulation career step detail (`SavedSimulationCareerStepDetails`)
- Saved career step detail (`SavedCareerStepDetails`)

- **Requirement**: Add an “Also known as” section when `altTitles.length > 0`.
- **Requirement**: Display rules:
  - Show first 5 synonyms inline (chips or comma-separated)
  - Provide “Show more” to expand if more exist
  - Do **not** show `hiddenTitles` by default (advanced; optional toggle)

**Acceptance Criteria**:
- A role with synonyms shows an “Also known as” section.
- A role without synonyms shows nothing (no empty section).

### 9) Career step cards (optional)
- **Optional Requirement**: In list cards, show synonyms via tooltip (“Also known as …”) to avoid clutter.

---

## Simulation Integration Requirements

### 10) Phase 1 (default): synonyms do not affect scoring
- **Requirement**: Synonyms must **not** change ranking/scoring behavior in the simulation by default.
- **Rationale**: Synonyms are primarily for findability and display; scoring should remain driven by required skills and canonical fields to avoid noise.

### 11) Phase 2 (optional): synonyms as low-weight text signal
If needed to improve matching for sparse profiles:
- **Requirement**: Synonyms may be included in the “combined text” match, but weighted lower than:
  - Required skills matches
  - Title matches
  - Description matches

**Acceptance Criteria**:
- Turning on synonym scoring does not dominate required-skill matching.
- The system remains explainable (matched inputs can indicate “matched via synonym”).

---

## Quality & Testing Requirements

### 12) Data quality checks
- **Requirement**: A data quality report must track synonym coverage:
  - % roles with `altTitles.length > 0`
  - Top roles by synonym count (to detect outliers/noise)

### 13) UX tests
- Autocomplete results are stable and performant with debounced server search.
- Detail pages render synonym chips correctly and handle long lists gracefully.

---

## Rollout & Backward Compatibility

### 14) Safe rollout path
- Keep `/api/occupations/titles` intact for existing UI until the new search-based autocomplete is deployed.
- Add UI synonym display behind a simple conditional (`altTitles?.length`).

