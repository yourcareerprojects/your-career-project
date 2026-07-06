# Career Step Requirements (As-Built)

Single reference for **career step detail pages**: shared layout across three contexts, enriched role fields, ESCO synonyms (`altTitles` / `hiddenTitles`), data pipeline, and save/navigation behavior. Product anchors live in **`REQUIREMENTS.md` §11** (`### 9.8`, `### 9.9`, `### 9.11`).

**Related (outside this doc):** [REQUIREMENTS_SIMULATION.md](./REQUIREMENTS_SIMULATION.md) §4 (results shape), §6 (card actions, layout §6.8), §8 (navigation guard); [REQUIREMENTS_PROFILE.md](./REQUIREMENTS_PROFILE.md) (career goal from profile).

---

## 1. Detail page contexts

Three routes render the same detail layout (blue header, two-column grid, shared role sections) with context-specific navigation and save behavior. Also: `RoleDetails.jsx` (`/role/:escoId`), `SharedResult.jsx` (share links).

| Route | Component | Data source | Back navigation |
|-------|-----------|-------------|-----------------|
| `/simulation/result/:resultId` | `SimulationResultDetails.jsx` | sessionStorage (`currentStepDetails`) | `/simulation` |
| `/saved-simulation/:simulationId/career-step/:stepId` | `SavedSimulationCareerStepDetails.jsx` | `GET /api/profile/simulation/saved/:id` | `/simulation/:simulationId` |
| `/saved-career-step/:stepId` | `SavedCareerStepDetails.jsx` | sessionStorage or `GET /api/profile/saved-career-steps/:stepId` | `/saved-steps` (or `/simulation` when opened from a sim) |

**Card → detail routing:** **More** on cards stores `currentStepDetails` in sessionStorage and routes via `getDetailRoute` / `detectContext` (`CareerStepCardWithReplacement.jsx`).

---

## 2. Shared layout

- **Header:** `Paper` with `primary.light`, title, context line, match score (`LinearProgress`), Save/Unsave, Share, Print
- **Grid:** Main **8/12** (description + insights + matched inputs + role details), sidebar **4/12** (actions, metadata) — stacks on small screens
- **Breadcrumbs** and context chips (“Simulation Result”, “Saved Career Step”, etc.)
- **Print:** Where implemented, print uses a new window + print styles on the detail components

### 2.1 Section order

1. Role Description  
2. **Role Insights** — seniority, key responsibilities, skill domains  
3. Matched Profile Inputs  
4. **Role Details** — required skills, optional skills, also known as  

All insight and detail sub-sections live in **`CareerStepRoleSections.jsx`** (`CareerStepRoleInsightsCard`, `CareerStepRoleDetailsCard`).

Simulation result details pass `maxVisibleSkillDomains={8}` to collapse long domain lists; saved-step detail pages show all domains.

---

## 3. Enriched fields

Enrichment from `CareerPath` — seniority, responsibilities, skill domains, core/optional skills, synonyms — is shown on **detail pages only** (not list cards). Missing/null fields degrade gracefully: sub-sections hide; Role Insights shows a short empty-state line when all three insight fields are absent.

| UI label | Source on `CareerPath` / step | Notes |
|----------|-------------------------------|--------|
| **Seniority** | `seniority` | Chip: label + level; `seniority_reasoning` sent to client but not rendered today |
| **Key Responsibilities** | `keyResponsibilities.responsibilities` | Bulleted list; DE merge when localized |
| **Skill Domains** | `skillDomains.skill_domains` | Outlined chips + tooltip for mapped items |
| **Required Skills** | `skillModel.core_skills` → fallback `requiredSkills` | First **5** + show more |
| **Optional Skills** | `skillModel.optional_skills` | First **5** + show more; hidden when empty |
| **Also known as** | `altTitles`, `hiddenTitles` | See §4 |

---

## 4. ESCO synonyms (`altTitles` / `hiddenTitles`)

ESCO `altLabels` and `hiddenLabels` are stored as **`altTitles`** and **`hiddenTitles`** on `CareerPath` for findability (search) and display (“Also known as …”). One canonical title per `escoId`; synonyms never create duplicate occupations.

### 4.1 Data model & import

| ESCO source | `CareerPath` field |
|-------------|-------------------|
| `altLabels` | `altTitles: string[]` |
| `hiddenLabels` | `hiddenTitles: string[]` |

- Strings are trimmed and de-duplicated per array; localized arrays `altTitlesDe` / `hiddenTitlesDe` when present.
- ESCO sync: `scripts/syncEscoOccupations.js` (`npm run sync:esco`) populates occupation data including synonym arrays.
- Synonyms are persisted on simulation/saved-step payloads so detail views work without a live lookup.

### 4.2 Search APIs (`/api/occupations`)

| Endpoint | Role |
|----------|------|
| `GET /search?q=&limit=` | **Primary** synonym-aware search — matches `title`, `altTitles` (and `altTitlesDe`); optional `includeHidden=1` for `hiddenTitles`. Returns `matchedBy`, `matchedValue`, `synonymsPreview`. |
| `GET /lookup?escoId=\|title=\|careerPathId=` | Full occupation payload including `altTitles` / `hiddenTitles` when present. Used to enrich step payloads when synonyms are missing. |
| `GET /titles` | Canonical titles only (backward compatible; no synonym bulk payload). |

**Tests:** `src/server/tests/occupationsSearch.test.js`.

### 4.3 UI surfaces

| Surface | Behavior |
|---------|----------|
| **Role search** (`RoleSearch.jsx`) | Debounced (`useOccupationSearch` → `/search`); shows canonical title + synonym hint when `matchedBy !== 'title'`. |
| **Career step details** (`CareerStepRoleSections.jsx`) | “Also known as” chips when `altTitles.length > 0`; first **5** + show more/less. Separate section for `hiddenTitles` when present. |
| **List cards** | No synonym tooltip (not implemented). |

Career goal for simulation comes from **profile** / `careerSimulationInputs`, not a synonym autocomplete on the simulation page.

### 4.4 Simulation & scoring

- **Ranking:** Synonyms do **not** affect hybrid simulation scores or list order.
- **Role identity text:** Up to **3** merged alt/hidden titles may feed role embedding text (`roleIdentityComposer.js`) — low-weight display/identity signal, not a primary match channel.
- **Exclusion:** When a career goal is set, matching uses the canonical goal title; synonym overlap does not bypass goal exclusion rules.

---

## 5. Context-specific save behavior

| Context | Save control in header | Library API |
|---------|------------------------|-------------|
| Unsaved simulation result | Save to / remove from saved career steps | `POST` / `DELETE` `/api/profile/saved-career-steps` |
| Saved simulation step | Same | Same |
| Saved career step | Remove from saved list | `DELETE` `/api/profile/saved-career-steps/:stepId` |

---

## 6. Data lookup & backend pipeline

### 6.1 Client step lookup

- URL `stepId` values: **`decodeURIComponent`** before match
- Search categories: `nextSteps`, `outsideTheBox`, `furtherAdvice` (and embedded list fallbacks on saved runs)
- Match by `stepId` / `id`, normalized title, and fuzzy fallbacks when primary lookup fails
- Optional `/api/occupations/lookup` enriches `altTitles` when missing on the step payload

### 6.2 Step builder

`CareerPath` fields flow through hybrid scoring unchanged, then **`buildStepObject`** in `prioritizedListGenerator.js` maps a **client-safe subset** onto each simulation step:

- **Include:** `seniority` (level, label, reasoning), `keyResponsibilities` (`responsibilities` only), `skillDomains` (`skill_domains` with `domain`, `importance`, `mapped_items`), `skillModel` (`core_skills`, `optional_skills` only), `altTitles`, `hiddenTitles`
- **Exclude from client:** `extraction_confidence`, `built_with`, `skill_weights`, `roleVectors` / `hybrid_vector` (stripped in controller)

Saved career steps persist the same enrichment via `POST /api/profile/saved-career-steps` (`profileController.js`) so `/saved-career-step/:stepId` renders without a live `CareerPath` lookup.

---

## 7. Implementation map

| Area | Location |
|------|----------|
| Unsaved sim details | `SimulationResultDetails.jsx` |
| Saved sim step details | `SavedSimulationCareerStepDetails.jsx` |
| Saved library step details | `SavedCareerStepDetails.jsx` |
| Shared role sections | `CareerStepRoleSections.jsx` |
| Card → detail routing | `CareerStepCardWithReplacement.jsx` |
| Step builder | `prioritizedListGenerator.js` — `buildStepObject` |
| Saved-step API | `profileController.js` |
| Schema | `CareerPath.js` |
| Search / lookup routes | `src/server/routes/occupations.js` |
| Client search hook | `useOccupationSearch.js` |
| Role search page | `RoleSearch.jsx` |
| Skill label helpers | `requiredSkillsUtils.js` |
| Localization | `localizedResponse.js` |
| ESCO sync | `scripts/syncEscoOccupations.js` |
