# Simulation Requirements (As-Built)

Single reference for **career simulation**: inputs, matching pipeline, results shape, role evaluation (Keep/Skip/Dislike), APIs, persistence, and navigation guard. Product anchors live in **`REQUIREMENTS.md` §11** (`### 9.4`–`### 9.9`).

**Related (outside this doc):** [REQUIREMENTS_PROFILE.md](./REQUIREMENTS_PROFILE.md) (profile inputs, completion gate, profile-update nudge §7), [REQUIREMENTS_CAREER_STEP.md](./REQUIREMENTS_CAREER_STEP.md) (detail pages, enriched fields, synonyms).

---

## 1. Overview

| Item | Detail |
|------|--------|
| Client route | `/simulation` (public route; **run** requires auth + completion gate) |
| Primary API | `POST /api/profile/simulation` |
| Algorithm | Hybrid embeddings + seniority penalty + MMR prioritized lists (§3–4) |
| Post-run UX | **Keep / Skip / Dislike** evaluation per role, then ranked view (§6) |
| Initial API slice | Top **3** per category in `nextSteps` / `outsideTheBox`; evaluation pool up to **10** per category (§6.1) |
| Card actions | **Keep**, **Skip**, **Dislike**, **More**, **Save / Saved** (§6) |
| Completion gate | **≥ 60%** profile completion (`MIN_SIMULATION_PROFILE_COMPLETION_PCT`); **403** below threshold |

### 1.1 Simulation types

| Type | Identity | Persistence |
|------|----------|-------------|
| **Unsaved** | `simulationId` missing or `"local"` | `results` + `evaluationFlow` in session state |
| **Saved** | Stable `User.simulationResults[].id` | Server-backed `results` (including `evaluationFlow`), `prioritizedLists` |

**`stepId`** is the canonical step identity everywhere (`step.stepId` or fallback `step.id`).

### 1.2 Category mapping

| Display (UI) | Prioritized list key |
|--------------|----------------------|
| `nextSteps` | `nextCareerRoles` |
| `outsideTheBox` | `outsideTheBoxRoles` |

### 1.3 Layers & data flow

| Layer | Role | Primary locations |
|--------|------|-------------------|
| **API** | Auth, validation, run, saved results, step removal | `server.js`, `src/server/routes/profile.js`, `profileController.js` |
| **Scoring** | Hybrid NEXT_ROLE / OUT_OF_THE_BOX vectors, seniority penalty | `roleMatchingScorer.js`, `careerPathScorer.js`, `userProfileVectorBuilder.js` |
| **Lists** | MMR, exploration filters, `stepId`, `prioritizedLists` | `prioritizedListGenerator.js`, `generatePrioritizedListsPhase2` |
| **ESCO / pool** | Occupation data in MongoDB, cached paths | `escoService.js`, `scripts/syncEscoOccupations.js` |
| **Client** | Run, evaluation UI, results, saved/unsaved flows, navigation guard | `Simulation.jsx`, `SimulationCategoryEvaluation.jsx`, `SimulationResultDetails.jsx`, `NavigationGuardContext.jsx` |

```mermaid
flowchart TD
  A[User (React)] -- POST simulation / actions --> B[Express API]
  B -- Load profile + ESCO cache --> C[MongoDB]
  B -- Embeddings --> D[OpenAI-compatible API]
  B -- Score + prioritize --> E[Simulation services]
  E --> B
  B -- Read/Write results --> C
  B --> A
  A -- PUT saved sim / DELETE step --> B
```

---

## 2. Inputs & path pool

### 2.1 Career simulation inputs (CSI)

| Topic | Implementation |
|-------|----------------|
| Primary source | `profile.careerSimulationInputs` (`structuredUserInfo`, `userIdentity`, `seniority`) |
| Fallback | `calculateCareerSimulationInputs(profile)` when missing and not manually edited |
| Document enrichment | CV PDF via `getEnrichedSimulationInputs`; additive merge; **7-day** cache |
| Manual edit | `PUT /api/profile/career-simulation-inputs`; sets `isManuallyEdited: true` |
| Career goal | `careerSimulationInputs.userIdentity.careerGoal` → `profile.careerGoal`; optional; titles containing goal excluded from both lists |
| Identity embeddings | Cached LLM-compressed text (`userIdentityEmbeddingTextService.js`) → `embeddingOptimizedUserIdentityText` |

### 2.2 Career path pool

| Topic | Implementation |
|-------|----------------|
| Source | ESCO occupations in MongoDB (`escoService.getCachedCareerPaths`) |
| Primary fetch | Paths whose `requiredSkillKeys` intersect user skill keys (limit **2000**) |
| Fallback | If &lt;500 paths, add from full cache up to **2000** total |
| Skill map | ESCO skills CSV at startup; **10s** timeout; sim continues if load fails |

### 2.3 Profile completion gate

- **Minimum:** 60% (`GET /api/profile/completion` / `computeProfileCompletion`)
- **UI:** Profile hides “Go to Simulation” when below threshold
- **API:** `runSimulation` returns **403** with completion breakdown when below threshold

---

## 3. Matching algorithm

**Entry:** `profileController.runSimulation` → **`enrichCareerPathWithHybridScores`** → **`generatePrioritizedListsPhase2`**.

**Embeddings:** OpenAI **`text-embedding-3-large`**, 3072-d, L2-normalized (`embeddingService.js`). **`OPENAI_API_KEY`** required for runtime user/fallback embeddings.

### 3.1 Phase 1 — Hybrid scoring

Per path, store: `hybridScoreNextRole`, `hybridCosineNextRole`, `hybridScoreOutOfTheBox`, `hybridCosineOutOfTheBox`.

**Fusion (L2-normalized structured + identity):**

| Mode | User/role weights (structured / identity) |
|------|-------------------------------------------|
| NEXT_ROLE | 0.75 / 0.25 |
| OUT_OF_THE_BOX | 0.45 / 0.55 |

**Final score:** `hybridCosine × max(0, 1 − seniorityPenalty)` (`roleMatchingScorer.js`).

**Structured sub-channel weights** (each mode sums to 0.92 before normalization in `structuredTextBuilder.js`):

| Channel | NEXT_ROLE | OUT_OF_THE_BOX |
|---------|-----------|----------------|
| occupation_group | 0.15 | 0.20 |
| skill_domains | 0.30 | 0.25 |
| responsibilities | 0.12 | 0.20 |
| required_skills | 0.30 | 0.15 |
| optional_skills | 0.05 | 0.12 |

**User CSI fields driving vectors:** skills, skills in development, key responsibilities, domains, seniority (penalty only), bio/interests/career goal (identity), cached identity text.

**Role side:** Precomputed `roleVectors` sub-vectors when present; else fallback embedding from title/description/skills.

### 3.2 Phase 2 — Prioritized lists

**Generator:** `prioritizedListGenerator.js` — deterministic **`stepId`** (`id = stepId` for compatibility).

| Topic | Rule |
|-------|------|
| List order | Fixed at simulation time; **remove** advances `currentPositions`; no runtime MMR reorder |
| Cross-category | OOTB excludes titles already in next list |
| Next pool | `hybridScoreNextRole > 0`; top **150** → dedupe → MMR **k=25**, **λ=0.85**, **minNovelty=0.05** |
| OOTB pool | `passesExplorationCriteria` (identity ~relative 60% pass rate; structure bounds **0.40–0.75**); novelty vs next list (p75 threshold); top **150** → MMR **k=25**, **λ=0.65**, **minNovelty=0.15** |
| Client payload | `roleVectors` / `hybrid_vector` **not** sent to client |

**Exploration defaults (`roleMatchingScorer.js`):** `EXPLORATION_IDENTITY_THRESHOLD=0.50`, `EXPLORATION_STRUCTURE_UPPER_BOUND=0.75`, `EXPLORATION_STRUCTURE_LOWER_BOUND=0.40`.

### 3.3 Algorithm modules

| Purpose | Path |
|---------|------|
| Hybrid orchestration | `services/scoring/careerPathScorer.js` |
| Scoring + penalties | `services/embedding/roleMatchingScorer.js` |
| User vectors | `services/embedding/userProfileVectorBuilder.js` |
| Structured text + weights | `services/embedding/structuredTextBuilder.js` |
| Embeddings, MMR | `services/embedding/embeddingService.js` |
| Prioritized lists | `services/simulation/prioritizedListGenerator.js` |
| Simulation entry | `controllers/profileController.js` (`runSimulation`) |

**Tuning note:** When weights, MMR, or exploration constants change, update **§3** and the implementation modules together.

---

## 4. Results structure

```javascript
results: {
  simulationId,
  algorithmVersion: '2',
  scoringVersion: '2',
  embeddingProvider: 'openai',
  embeddingVersion: '1',
  nextSteps: [...],           // top 3 from nextCareerRoles
  outsideTheBox: [...],
  furtherAdvice: [...],
  prioritizedLists: { nextCareerRoles, outsideTheBoxRoles },
  prioritizedListTotals: { nextCareerRoles, outsideTheBoxRoles },
  currentPositions: { nextCareerRoles: 3, outsideTheBoxRoles: 3 },
  evaluationFlow: {              // client-built after run (§6)
    simulationId,
    nextSteps: [...],              // up to 10 eval roles
    outsideTheBox: [...],
    hasStarted: { nextSteps, outsideTheBox },
    phases: { nextSteps: 'eval'|'ranked', outsideTheBox: 'eval'|'ranked' },
    ranked: { nextSteps, outsideTheBox }
  },
  profileEnrichment: {...}    // if document enrichment applied
}
```

**Operational:** Scoring batches ~150 paths; controller timeout **3 minutes**. Performance depends on pool size and API latency.

---

## 5. APIs

**Canonical table** for simulation/saved-simulation routes (all under **`/api/profile`**, see `src/server/routes/profile.js`). Documents use **`/api/documents`**.

| Method | Path (after `/api/profile`) | Purpose |
|--------|-----------------------------|---------|
| `POST` | `/simulation` | Run simulation |
| `GET` | `/simulation/last` | Last simulation result |
| `POST` | `/simulation/save` | Persist new simulation result |
| `GET` | `/simulation/saved` | List saved simulations |
| `GET` | `/simulation/saved/:id` | Get one saved simulation |
| `PUT` | `/simulation/saved/:id` | Update saved simulation metadata |
| `DELETE` | `/simulation/saved/:id` | Delete saved simulation |
| `PUT` | `/simulation/saved/:id/archive` | Archive saved simulation |
| `POST` | `/simulation/settings` | User simulation settings (e.g. auto-save) |
| `PUT` | `/simulation-results/:simulationId` | Update full saved simulation (“save changes”, includes `evaluationFlow`) |
| `POST` | `/simulation/:simulationId/replace-career-step/:stepId` | **Legacy** — replace step (no current client UI) |
| `DELETE` | `/simulation-results/:simulationId/career-steps/:stepId` | **Legacy** — remove step + list replacement (no current client UI) |

---

## 6. Role evaluation & card actions

**Primary UI:** `SimulationCategoryEvaluation.jsx` on `/simulation` and `SavedSimulationDetails.jsx` when `results.evaluationFlow` is present. **Legacy fallback:** saved simulations without `evaluationFlow` may still render `CareerStepCardWithReplacement` (**More** + **Save** only). **Visual layout:** §6.8.

**Logic:** `src/client/utils/simulationRoleRanking.js`; state handlers in `Simulation.jsx` and `SavedSimulationDetails.jsx`.

### 6.1 Evaluation pool

- After a run, the client attaches **`results.evaluationFlow`** via `ensureEvaluationFlow` / `createInitialEvaluationFlow`.
- Per category (`nextSteps`, `outsideTheBox`): up to **10** unique roles (`EVALUATION_ROLES_TARGET`) merged from the initial API slice + `prioritizedLists` — no extra fetch.
- Server still returns top **3** per category in `nextSteps` / `outsideTheBox`; the evaluation pool extends from `prioritizedLists`.

### 6.2 Keep / Skip / Dislike

| Rating | `userEvaluation` | Intent |
|--------|------------------|--------|
| **Keep** | `'keep'` | Strong fit |
| **Skip** | `'skip'` | Not sure |
| **Dislike** | `'dislike'` | Poor fit |

- Stored on each role in `evaluationFlow.{nextSteps|outsideTheBox}`.
- User may change a rating until the ranked view is opened (re-click toggles selection state on the card).
- **Persistence:** updates `results.evaluationFlow` in React state; unsaved runs → session persistence; saved runs → **`PUT /api/profile/simulation-results/:simulationId`** with full `results`. Sets **`simulationState === 'modified'`**.
- Distinct from the legacy server **remove/replace** endpoints (§6.6).

### 6.3 Evaluation phase (`phases.* === 'eval'`)

- Shows **unevaluated** roles only: up to **3** slots on desktop, **1** on mobile (`EVALUATION_VISIBLE_SLOTS_*`).
- After each rating, the next unevaluated role appears in the row.
- Progress: `evaluated / total` per category with a linear progress bar.
- When every role in the category is rated → **See your ranking** (`onSeeRanking`).

### 6.4 Ranking phase (`phases.* === 'ranked'`)

- Opened after **See your ranking**; builds `evaluationFlow.ranked.{category}`.
- Default order (`rankRoles`): **Keep** → **Skip** → **Dislike**, then descending **match score** within the same rating.
- UI: grouped columns (keep / skip / dislike) with drag-and-drop reorder (`@dnd-kit`); order stored via `handleReorderRankedRoles` / `buildRankedRowsFromOrderedRoles`.
- **Edit ratings** returns the category to `eval` without clearing existing `userEvaluation` values.

### 6.5 More

| Action | Behavior |
|--------|----------|
| **More** | Writes `currentStepDetails` to sessionStorage → detail route (`/simulation/result/:stepId` or saved-simulation variant) |

Tooltips and labels: dashboard i18n `simulation.evaluationFlow.tooltips.*` / `actions.*`.

### 6.6 Legacy remove/replace (server only)

`DELETE .../simulation-results/:simulationId/career-steps/:stepId` and `POST .../replace-career-step/:stepId` remain in `profile.js` but have **no wired client UI**. Edit saved simulations via evaluation changes + **Save Changes** (`PUT`).

### 6.8 Card action layout (visual)

Visual and layout reference for action buttons on simulation role **cards**. There is no single shared `ACTION_BUTTON_SX` constant — each surface defines local `sx` (typically `width: '100%'` in grid cells).

#### 6.8.1 Surfaces

| Surface | Component | Actions |
|---------|-----------|---------|
| **Simulation run** (`Simulation.jsx`) | `SimulationCategoryEvaluation.jsx` → `RoleEvaluationCard` | **Keep / Skip / Dislike** (3-col), then **More** (single action row as implemented) |
| **Saved simulation** (with `evaluationFlow`) | Same as above | Same |
| **Saved simulation** (legacy, no `evaluationFlow`) | `CareerStepCardWithReplacement.jsx` | **More** only |

#### 6.8.2 Simulation evaluation (`SimulationCategoryEvaluation.jsx`)

- Category sections: `nextSteps`, `outsideTheBox`, `furtherAdvice`
- **Outside-the-box** actions use the `--color-ootb-action` token family where present
- Evaluation buttons: `variant` toggles outlined ↔ contained; `size="small"`; black border on eval row where styled
- Local constants: `ACTION_BUTTON_SX`, `OOTB_ACTION_BUTTON_SX`, `EVAL_BUTTON_BORDER_SX` in file

#### 6.8.3 Card grid (`CareerStepCardWithReplacement.jsx`)

```jsx
// action grid for role cards
gridTemplateColumns: '1fr', gap: 1
```

- `variant="contained"`, `size="small"`, `startIcon` (not `endIcon`)
- `className="career-step-action-button"` on both buttons
- `CARD_ACTION_BTN_SX = { width: '100%' }` plus category color overrides where needed
- Left border accent per category: `--color-primary` / `--color-warning` / `--color-success`

#### 6.8.4 When changing buttons

1. Match the grid pattern and `size="small"` of the surface you are editing  
2. Keep full-width cells (`width: '100%'`) inside CSS grid  
3. Preserve tooltips + `aria-label` aligned with dashboard i18n keys  
4. For simulation evaluation, keep desktop/mobile interaction patterns aligned across ranking surfaces

---

## 7. Role pool & profile nudge

| Topic | Value / behavior |
|-------|------------------|
| Roles to evaluate per category | **10** max (`EVALUATION_ROLES_TARGET` in `simulationRoleRanking.js`) |
| Initial API slice | **3** per category in `nextSteps` / `outsideTheBox` |
| Visible unevaluated slots | **3** desktop / **1** mobile (`SimulationCategoryEvaluation.jsx`) |
| Profile update nudge | Optional `ProfileUpdateRecommendation` per category on `/simulation` — [REQUIREMENTS_PROFILE.md](./REQUIREMENTS_PROFILE.md) §7 |

**Legacy:** `src/server/config/displayLimits.js` and `categoryDisplayCounts` in session payloads are remnants of the old remove-and-replace card cap; not driving the evaluation UI.

---

## 8. Persistence & navigation

### 8.1 Unsaved simulation state

- States: clean / **modified** / saved (`simulationState === 'modified'` when dirty)
- Session keys for unsaved runs; `results` (including **`evaluationFlow`**) may persist in **sessionStorage**
- **Keep / Skip / Dislike** and ranking edits mark the simulation **modified**

### 8.2 Save changes (existing saved simulation)

- Detect drift: `useChangeDetection` — `JSON.stringify(original.results)` vs current + `name`, `description`, `careerGoal`
- **Save Changes** when dirty → confirmation → **`PUT /api/profile/simulation-results/:simulationId`** (`useUpdateSimulation`) — persists `evaluationFlow` with `results`
- `lastModified` updated; creation **`timestamp`** preserved; no modification-history array

### 8.3 Navigation guard

When **`simulationState === 'modified'`** on `/simulation`:

- **`NavigationGuardProvider`** + **`guardedNavigate`** (`NavigationGuardContext.jsx`)
- **`Layout.jsx`** nav links use `guardedNavigate`
- **`Simulation.jsx`** registers guard with custom copy; optional **Save Changes** in dialog
- Dialog defaults: “Unsaved Changes Detected”; **Leave Anyway** / **Stay on Page**
- **No** `beforeunload` — tab close uses browser default
- **`SavedSimulationDetails.jsx`** does not use this guard
- In-card navigation respects guard when `guardedNavigate` is passed

### 8.4 Simulation page chrome

| Control | Treatment |
|---------|-----------|
| Start Simulation | Primary (contained) |
| Saved Simulations | Secondary — outlined primary, `ViewListIcon`, `guardedNavigate('/simulations')`, tooltip + `aria-label` |
| Save Results | Tertiary — outlined, conditional |

---

## 9. Detail views & evaluation sync

| Topic | Detail |
|-------|--------|
| Detail routes | `SimulationResultDetails.jsx`, `SavedSimulationCareerStepDetails.jsx` — see [REQUIREMENTS_CAREER_STEP.md](./REQUIREMENTS_CAREER_STEP.md) |
| Evaluation on details | `resolveUserEvaluationFromEvaluationFlow` / `applyUserEvaluationToEvaluationFlow` sync ratings when opened from a saved simulation |
| Legacy remove API | `removeCareerStepFromSimulation` in `profileController.js` — server-only; see §6.7 |

---

## 10. Implementation map

| Area | Primary files |
|------|----------------|
| Simulation page | `src/client/components/pages/Simulation.jsx` |
| Evaluation UI | `src/client/components/common/SimulationCategoryEvaluation.jsx` |
| Evaluation logic | `src/client/utils/simulationRoleRanking.js` |
| Saved simulation details | `SavedSimulationDetails.jsx` |
| Legacy card (no eval flow) | `CareerStepCardWithReplacement.jsx` |
| Navigation guard | `NavigationGuardContext.jsx`, `Layout.jsx` |
| Change detection | `useChangeDetection.js` |
| Update simulation | `useUpdateSimulation.js` |
| Profile nudge | `ProfileUpdateRecommendation.jsx` (see REQUIREMENTS_PROFILE §7) |

---

## 11. Acceptance checklist

### Pipeline & APIs
- [x] CSI-driven simulation; hybrid scoring + MMR lists; results shape per §4
- [x] Completion gate at 60%; career goal from profile not pre-run dialog
- [x] API table routes wired in `profile.js`

### Role evaluation & actions
- [x] `evaluationFlow` built after run; up to 10 roles per category (§6.1)
- [x] Keep / Skip / Dislike persisted in `results.evaluationFlow`; marks simulation modified
- [x] Ranking phase with default sort + drag reorder (§6.4)
- [x] More + Save to library independent of evaluations (§6.5)
- [x] Deterministic `stepId`; duplicate library save → 409
- [x] Button layouts per §6.8

### Persistence & guard
- [x] Unsaved modified state + navigation guard on `/simulation`
- [x] Save changes via PUT (includes `evaluationFlow`)
- [x] Saved Simulations button → `/simulations` with guard
