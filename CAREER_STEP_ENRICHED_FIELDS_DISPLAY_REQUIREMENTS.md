# Career Step Enriched Fields Display Requirements

## 1. Overview

### 1.1 Objective

Surface five enrichment-backed areas on the career step detail pages so users see seniority, responsibilities, skill domains, required/core skills, optional skills, and “also known as” data when present. Data originates on `CareerPath` and flows through simulation / save APIs; **Phases 1–3 are implemented** in `SavedCareerStepDetails.jsx`, `SimulationResultDetails.jsx`, and `SavedSimulationCareerStepDetails.jsx`.

### 1.2 Fields in Scope

| # | User-Facing Label | Schema Source | Data Shape |
|---|-------------------|---------------|------------|
| 1 | **Seniority** | `CareerPath.seniority` | `{ seniority_level (0–6), seniority_label, seniority_reasoning }` |
| 2 | **Key Responsibilities** | `CareerPath.keyResponsibilities` | `{ responsibilities: String[] }` (3–6 verb-led statements) |
| 3 | **Skill Domains** | `CareerPath.skillDomains` | `{ skill_domains: [{ domain, importance, mapped_items }] }` (4–12 clusters) |
| 4 | **Skills Required** (core) | `CareerPath.skillModel.core_skills` | `String[]` (essential skills) |
| 5 | **Skills Optional** | `CareerPath.skillModel.optional_skills` | `String[]` (beneficial but not required) |

### 1.3 Affected Components

All three career step detail pages implement the same patterns (per `CAREER_STEP_DETAILS_CONSISTENCY_REQUIREMENTS.md`):

| Component | Route |
|-----------|-------|
| `SavedCareerStepDetails.jsx` | `/saved-career-step/:stepId` |
| `SimulationResultDetails.jsx` | `/simulation/result/:resultId` |
| `SavedSimulationCareerStepDetails.jsx` | `/saved-simulation/:simulationId/career-step/:stepId` |

---

## 2. Requirements

### 2.1 Data Pipeline — Backend

Enrichment fields live on the `CareerPath` MongoDB document. In **production simulation**, each path object (still carrying its `CareerPath` fields) is scored with hybrid embeddings, then **`buildStepObject`** in the prioritized list generator maps a **client-safe** subset onto every step in `results.prioritizedLists` / initial slices.

#### 2.1.1 Prioritized list generator — `buildStepObject`

**File:** `src/server/services/simulation/prioritizedListGenerator.js`

**Function:** `buildStepObject(scoredPath, { category })` (not `mapScoredPath`). It receives the scored path object, which is the original **`CareerPath` document fields** plus hybrid score fields (`hybridScoreNextRole`, etc.) from `enrichCareerPathWithHybridScores` in `careerPathScorer.js`.

The step object passed to the client must include enrichment as a **safe subset** (same shape as today’s implementation):

```javascript
// Illustrative — see `buildStepObject` in prioritizedListGenerator.js
{
  // ... title, description, hybrid scores, matchedSkills, escoId, etc. ...

  altTitles: safeArray(scoredPath.altTitles),
  seniority: /* client-safe: level, label, reasoning only */,
  keyResponsibilities: /* { responsibilities: [...] } only */,
  skillDomains: /* skill_domains with domain, importance, mapped_items */,
  skillModel: scoredPath.skillModel
    ? {
        core_skills: safeArray(scoredPath.skillModel.core_skills),
        optional_skills: safeArray(scoredPath.skillModel.optional_skills)
      }
    : null
}
```

**Important notes:**
- Only pass the sub-fields needed for display (`core_skills`, `optional_skills`). Do **not** send `skill_weights` or `extraction_confidence` to the client (internal/sensitive data).
- For `seniority`, include `seniority_level`, `seniority_label`, and `seniority_reasoning`. Do **not** send `extraction_confidence` or `built_with` to the client.
- For `keyResponsibilities`, include `responsibilities` array only.
- For `skillDomains`, include the full `skill_domains` array (domain, importance, mapped_items). Do **not** send `extraction_confidence` or `built_with`.
- `profileController.runSimulation` strips `roleVectors` / `hybrid_vector` from steps before the JSON response; enrichment fields above are **not** stripped.

#### 2.1.2 Saved Career Step API

**File:** `src/server/controllers/profileController.js`

Saved career steps persist enrichment alongside core fields (`seniority`, `keyResponsibilities`, `skillDomains`, `skillModel`, `altTitles`, `requiredSkills`, etc.) so the saved career step detail page can render without a separate `CareerPath` lookup.

**Persisted shape (illustrative):**

```javascript
const newStep = {
  // ... existing fields ...
  seniority: req.body.seniority || null,
  keyResponsibilities: req.body.keyResponsibilities || null,
  skillDomains: req.body.skillDomains || null,
  skillModel: req.body.skillModel || null,
  altTitles: req.body.altTitles || [],
  requiredSkills: req.body.requiredSkills || []
};
```

#### 2.1.3 Graceful Degradation

- All enrichment fields default to `null` (objects) or `[]` (arrays) when not yet populated for a given career path.
- The frontend must treat missing/null values as "not available" and hide the corresponding section rather than showing empty or broken UI.
- Career paths that were imported before the enrichment pipeline was run will lack these fields; the UI must handle this gracefully.
- **No field should be marked as "required"** — they are all progressive enhancements.

---

### 2.2 UI Display — Frontend

#### 2.2.1 "Role Insights" card

The **Role Insights** card sits between **Role Description** and **Matched Profile Inputs** and groups seniority, key responsibilities, and skill domains.

**Section order (as-built):**

1. Role Description *(existing)*
2. **Role Insights** *(Seniority, Key Responsibilities, Skill Domains)*
3. Matched Profile Inputs *(existing)*
4. Role Details *(existing — contains Required Skills (core), Optional Skills (new sub-section), Also known as)*

> **Design rationale:** Grouping enrichment into "Role Insights" keeps the page scannable. **Required Skills** prefers `skillModel.core_skills` when present, with fallback to top-level `requiredSkills`.

#### 2.2.2 Seniority Display

**Location:** First item inside the "Role Insights" card.

**Layout:**

```
Seniority
┌─────────────────────────────────────────────────────┐
│  [Chip: "Senior (Level 4)"]                         │
│                                                     │
│  "This role requires significant domain expertise   │
│   and typically involves mentoring junior staff."   │
└─────────────────────────────────────────────────────┘
```

**Specifications:**

| Element | Component | Details |
|---------|-----------|---------|
| Section label | `Typography variant="subtitle1"` | Bold, text: **"Seniority"** |
| Level chip | `Chip` | Label format: `"{seniority_label} (Level {seniority_level})"`. Color by level: 0–1 = `default`, 2–3 = `info`, 4–5 = `warning`, 6 = `error` (to indicate increasing seniority visually). |
| Reasoning | `Typography variant="body2"` | Italic, `color="text.secondary"`. Display `seniority_reasoning`. |
| Fallback | — | If `seniority` is `null`, hide entire sub-section (do not render). |

#### 2.2.3 Key Responsibilities Display

**Location:** Second item inside the "Role Insights" card (below Seniority).

**Layout:**

```
Key Responsibilities
┌─────────────────────────────────────────────────────┐
│  • Lead cross-functional project teams              │
│  • Define and track key performance indicators      │
│  • Manage stakeholder communication                 │
│  • Oversee budget planning and resource allocation  │
└─────────────────────────────────────────────────────┘
```

**Specifications:**

| Element | Component | Details |
|---------|-----------|---------|
| Section label | `Typography variant="subtitle1"` | Bold, text: **"Key Responsibilities"** |
| List | Unordered list (`<ul>`) or MUI `List` | Each responsibility as a list item. Use `Typography variant="body2"` for each item. |
| Fallback | — | If `keyResponsibilities` is `null` or `responsibilities` is empty, hide entire sub-section. |
| Truncation | — | Not needed; typically 3–6 items. If more than 6, show all (no show more/less). |

#### 2.2.4 Skill Domains Display

**Location:** Third item inside the "Role Insights" card (below Key Responsibilities).

**Layout:**

```
Skill Domains
┌─────────────────────────────────────────────────────┐
│  [Chip: ★ Data Analysis]  [Chip: ★ Project Mgmt]   │
│  [Chip: ◆ Stakeholder Comm]  [Chip: ◆ Budgeting]   │
│  [Chip: ○ Documentation]  [Chip: ○ Reporting]       │
└─────────────────────────────────────────────────────┘
```

**Specifications:**

| Element | Component | Details |
|---------|-----------|---------|
| Section label | `Typography variant="subtitle1"` | Bold, text: **"Skill Domains"** |
| Domain chips | `Chip` (wrapped in flex container) | Label: domain name. Visual distinction by importance level — see color mapping below. |
| Importance colors | `Chip color` prop | `core` → `primary` (filled), `important` → `secondary` (outlined), `supporting` → `default` (outlined) |
| Tooltip | Chip `title` or MUI `Tooltip` | On hover, show mapped items: `"Includes: skill1, skill2, skill3"` |
| Ordering | — | Display chips sorted by importance: `core` first, then `important`, then `supporting`. Within each group, preserve original order. |
| Show more/less | `Button` toggle | Show first **8** domains by default. If more than 8, show "Show more" / "Show less" toggle (consistent with existing pattern). |
| Fallback | — | If `skillDomains` is `null` or `skill_domains` is empty, hide entire sub-section. |

#### 2.2.5 Skills Required (Core Skills) Display

**Location:** Inside the existing "Role Details" card. **Required Skills** uses `skillModel.core_skills` when available, otherwise falls back to the flat **`requiredSkills`** list on the path object.

**Specifications:**

| Element | Details |
|---------|---------|
| Section label | **"Required Skills"** (unchanged label for user familiarity) |
| Data source | Use `skillModel.core_skills` when available; fall back to top-level `requiredSkills` array |
| Display | Chips in a flex-wrap container (same styling as current Required Skills) |
| Show more/less | Show first **5** by default; toggle for the rest (existing behavior, `MAX_VISIBLE_REQUIRED_SKILLS`) |
| Fallback | If both `skillModel.core_skills` and `requiredSkills` are empty/null, show "No required skills listed for this role." |

#### 2.2.6 Skills Optional Display

**Location:** Inside the existing "Role Details" card, as a new sub-section between "Required Skills" and "Also known as".

**Layout:**

```
Optional Skills
┌─────────────────────────────────────────────────────┐
│  [Chip: Negotiation]  [Chip: Public Speaking]       │
│  [Chip: Data Visualization]  [Chip: Agile Methods]  │
│  [Show more]                                        │
└─────────────────────────────────────────────────────┘
```

**Specifications:**

| Element | Component | Details |
|---------|-----------|---------|
| Section label | `Typography variant="subtitle1"` | Bold, text: **"Optional Skills"** |
| Chips | `Chip variant="outlined" size="small"` | Same styling as current "Also known as" chips (small, outlined). Distinguishes them visually from required skills which use `variant="outlined"` (default size). |
| Show more/less | `Button` toggle | Show first **5** by default. Toggle for the rest (same pattern as Required Skills / Also known as). Use a new constant `MAX_VISIBLE_OPTIONAL_SKILLS = 5`. |
| Fallback | — | If `skillModel.optional_skills` is `null` or empty, hide entire sub-section. |
| Conditional rendering | — | Only render this sub-section when `skillModel` is not null and `optional_skills` has at least one entry. |

#### 2.2.7 "Role Insights" Card — Conditional Rendering

The entire "Role Insights" card should only be rendered when **at least one** of the three sub-sections (Seniority, Key Responsibilities, Skill Domains) has data to display. If all three are null/empty, do not render the card at all.

```javascript
const hasRoleInsights =
  (stepDetails.seniority && stepDetails.seniority.seniority_label) ||
  (stepDetails.keyResponsibilities && stepDetails.keyResponsibilities.responsibilities?.length > 0) ||
  (stepDetails.skillDomains && stepDetails.skillDomains.skill_domains?.length > 0);
```

#### 2.2.8 "Role Insights" Card — Icon

Use the MUI `Insights` icon (from `@mui/icons-material/Insights`) as the section icon, consistent with the icon-prefixed pattern used by other cards (e.g., `Work` for Role Description, `Psychology` for Matched Profile Inputs, `School` for Role Details).

```jsx
import Insights from '@mui/icons-material/Insights';

<Typography variant="h6" sx={{ fontWeight: 600, mb: 2 }}>
  <Insights sx={{ mr: 1, verticalAlign: 'middle' }} />
  Role Insights
</Typography>
```

---

### 2.3 Print Layout

The enrichment fields must be included in the print layout:

- **Seniority**: Print the chip as plain text (label + level) followed by reasoning.
- **Key Responsibilities**: Print as a bulleted list.
- **Skill Domains**: Print as a grouped list by importance (Core, Important, Supporting) with domain names. Mapped items can be omitted for brevity.
- **Skills Required / Optional**: Print all skills (no truncation) as comma-separated lists.
- The "Role Insights" card should use the `avoid-break` CSS class (consistent with other cards).

---

### 2.4 Consistency Requirements

Per the existing `CAREER_STEP_DETAILS_CONSISTENCY_REQUIREMENTS.md`:

1. **All three detail pages** must display the enrichment fields identically.
2. The same section order, styling, and conditional rendering logic must be used across all three components.
3. State variables for show more/less toggles must follow the same naming convention:
   - `showAllSkillDomains` / `setShowAllSkillDomains`
   - `showAllOptionalSkills` / `setShowAllOptionalSkills`
4. Constants must follow the same pattern:
   - `MAX_VISIBLE_SKILL_DOMAINS = 8`
   - `MAX_VISIBLE_OPTIONAL_SKILLS = 5`

---

## 3. Data Flow Summary (production simulation)

```
┌──────────────────────────────────────────────────────────────┐
│  CareerPath (MongoDB)                                        │
│  ┌─────────────────────────────────────────────────────────┐ │
│  │ skillModel, seniority, keyResponsibilities, skillDomains, │ │
│  │ altTitles, title, description, roleVectors, …           │ │
│  └─────────────────────────────────────────────────────────┘ │
└──────────────┬───────────────────────────────────────────────┘
               │
               ▼
┌──────────────────────────────────────────────────────────────┐
│  profileController.js — runSimulation()                      │
│  • load paths from escoService                               │
│  • enrichCareerPathWithHybridScores() — careerPathScorer.js   │
│    (adds hybrid scores; path still carries CareerPath fields) │
│  • generatePrioritizedListsPhase2()                           │
└──────────────┬───────────────────────────────────────────────┘
               │
               ▼
┌──────────────────────────────────────────────────────────────┐
│  prioritizedListGenerator.js — buildStepObject()             │
│  (Client-safe enrichment + scores; strip vectors in controller)│
└──────────────┬───────────────────────────────────────────────┘
               │
               ▼
┌──────────────────────────────────────────────────────────────┐
│  API response / User.lastSimulationResult / saved simulations │
└──────────────┬───────────────────────────────────────────────┘
               │
               ▼
┌──────────────────────────────────────────────────────────────┐
│  Frontend Detail Pages                                       │
│  SavedCareerStepDetails · SimulationResultDetails ·            │
│  SavedSimulationCareerStepDetails                             │
└──────────────────────────────────────────────────────────────┘
```

---

## 4. Acceptance Criteria

### 4.1 Backend

- [x] `buildStepObject()` in `prioritizedListGenerator.js` includes enrichment fields in each simulation step (client-safe subset only — no `extraction_confidence`, `built_with`, or `skill_weights`).
- [x] Enrichment for simulation steps comes from the `CareerPath` document through the object passed into `buildStepObject` after hybrid scoring.
- [x] Saved career step save endpoint persists the enrichment fields.
- [x] Saved career step GET endpoint returns the enrichment fields.
- [x] Simulation results API response includes the enrichment fields for each career step.
- [x] Null/missing enrichment fields do not cause errors or 500 responses.

### 4.2 Frontend — "Role Insights" Card

- [x] A "Role Insights" card appears between "Role Description" and "Matched Profile Inputs" on all three detail pages.
- [x] The card is only rendered when at least one enrichment sub-section has data.
- [x] **Seniority** displays as a colored chip with label and level, plus reasoning text below.
- [x] **Key Responsibilities** displays as a bulleted list of verb-led statements.
- [x] **Skill Domains** displays as colored chips sorted by importance (core → important → supporting), with tooltips showing mapped items.
- [x] Skill domains show first 8 by default with show more/less toggle when more exist.
- [x] Each sub-section hides independently when its data is null/empty.

### 4.3 Frontend — "Role Details" Card Updates

- [x] "Required Skills" uses `skillModel.core_skills` when available, falling back to `requiredSkills`.
- [x] **Optional Skills** sub-section appears between "Required Skills" and "Also known as".
- [x] Optional Skills shows first 5 by default with show more/less toggle.
- [x] Optional Skills sub-section hides when data is null/empty.

### 4.4 Cross-Cutting

- [x] All three detail pages display the enrichment fields with the same structure and behavior.
- [x] Print flow includes detail content (dedicated print windows / styles on the detail pages).
- [x] Layout uses responsive grids consistent with the rest of the detail pages.
- [x] Save, share, print, and navigation remain available; pre-enrichment or partial data degrades gracefully (sections hidden when empty).

---

## 5. Implementation status

**Phases 1–3 (backend data flow, Role Insights, Role Details updates): complete** in production code paths described in §2–§3.

**Phase 4 (print & polish):** print and responsive layout are implemented on the detail pages; treat cross-browser QA as ongoing regression coverage rather than an open functional gap.

---

## 6. Edge Cases

| Scenario | Expected Behavior |
|----------|-------------------|
| Career path has no enrichment data at all | "Role Insights" card not rendered; "Required Skills" falls back to top-level `requiredSkills`; "Optional Skills" not rendered. |
| Only `seniority` is populated | "Role Insights" card renders with only the Seniority sub-section visible. |
| `seniority_reasoning` is null but `seniority_label` exists | Display chip without reasoning text. |
| `skill_domains` has > 8 entries | Show first 8 with "Show more" toggle. |
| `core_skills` is populated but `optional_skills` is empty | "Required Skills" uses `core_skills`; "Optional Skills" sub-section hidden. |
| `skillModel` exists but `core_skills` is empty | Fall back to top-level `requiredSkills` for "Required Skills" display. |
| `keyResponsibilities.responsibilities` has 1 item | Display as a single-item list (no special handling). |
| Saved career step was saved before enrichment fields existed | All enrichment sub-sections hidden; existing saved data displays normally. |
| `mapped_items` on a skill domain is empty | Tooltip says "No specific skills mapped" or is omitted. |

---

## 7. Future Considerations

1. **Skill Domain Expansion**: Click a skill domain chip to see its mapped skills in a popover or expanded section (beyond tooltip).
2. **Seniority Filter**: Allow users to filter simulation results by seniority level.
3. **Skill Gap Analysis Integration**: Cross-reference required/optional skills with user profile skills to highlight gaps directly on the detail page.
4. **Responsibility Matching**: Highlight responsibilities that overlap with the user's work experience.
5. **Component Extraction**: If the "Role Insights" card grows in complexity, extract it into a shared component used by all three detail pages to reduce code duplication.

---

**Status:** **As-built** — Phases 1–3 shipped; §7 lists optional future enhancements only.

**Related Documents:**
- `CAREER_STEP_DETAILS_CONSISTENCY_REQUIREMENTS.md` — Layout consistency across detail pages
- `CAREER_STEP_DISPLAY_LIMIT_REQUIREMENTS.md` — Display limit requirements
- `ARCHITECTURE.md` — System architecture
- `src/server/models/CareerPath.js` — Schema definition
- `src/server/services/simulation/prioritizedListGenerator.js` — `buildStepObject`
- `SIMULATION_IMPLEMENTATION_REQUIREMENTS.md` — hybrid-only simulation pipeline
