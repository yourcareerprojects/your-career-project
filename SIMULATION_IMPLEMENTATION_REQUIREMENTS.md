# Simulation Implementation Requirements (Current)

As-built **APIs**, **results shape**, **path pool**, **inputs**, and **wiring**. **Card actions** (save / dislike / remove): **`SIMULATION_CARD_ACTIONS_HARMONIZED_REQUIREMENTS.md`**.

**Numeric algorithm parameters** (hybrid weights, MMR, exploration, list sizes): canonical **[`CAREER_MATCHING_ALGORITHM_TECHNICAL_OVERVIEW.md`](./CAREER_MATCHING_ALGORITHM_TECHNICAL_OVERVIEW.md)** §3–4 — do not duplicate those constants here; this file references modules and behaviors only.

**Product index:** `requirements.md` §11 **`### 9.6`–`### 9.7`**.

---

## 1. Inputs & Data Flow

| Requirement | Implementation |
|-------------|----------------|
| **Primary source** | `profile.careerSimulationInputs` with section-aligned shape: `structuredUserInfo`, `userIdentity`, `seniority` |
| **Fallback** | If inputs missing/empty and not manually edited, compute on-the-fly via `calculateCareerSimulationInputs(profile)` |
| **Document enrichment** | CV/resume PDF parsed via `getEnrichedSimulationInputs`; skills and related extracted profile signals are merged additively into base CSI fields; 7-day cache |
| **Manual edit** | `PUT /api/profile/career-simulation-inputs`; sets `isManuallyEdited: true`; computed inputs not overwritten |
| **Career goal** | Prefer `careerSimulationInputs.userIdentity.careerGoal`, else `profile.careerGoal`; optional; titles containing the goal are excluded from both lists |
| **User identity (embeddings)** | Cached LLM-compressed identity text (`ensureUserIdentityEmbeddingCachedByUserId`) → `embeddingOptimizedUserIdentityText` + fingerprint; used when building user identity vectors (see `userIdentityEmbeddingTextService.js`) |

---

## 2. Career Path Pool

| Requirement | Implementation |
|-------------|----------------|
| **Source** | ESCO occupations in MongoDB via `escoService.getCachedCareerPaths` |
| **Primary fetch** | Paths whose `requiredSkillKeys` intersect user's normalized skill keys (limit 2000) |
| **Fallback** | If &lt;500 paths, add from full cache up to 2000 total |
| **Skill map** | ESCO skills CSV loaded at startup; 10s timeout; simulation continues if load fails |

---

## 3. Scoring (production simulation)

Live `POST /api/profile/simulation` runs **hybrid vector matching** via **`enrichCareerPathWithHybridScores`** (`careerPathScorer.js`) → **`scoreNextRole` / `scoreOutOfTheBox`** (`roleMatchingScorer.js`). User vectors: **`userProfileVectorBuilder.js`**; embeddings: **`embeddingService.js`** (OpenAI **`text-embedding-3-large`**, 3072-d, L2-normalized).

| Aspect | Implementation |
|--------|----------------|
| **Role side** | Precomputed **`roleVectors`** per career path (structured sub-vectors + **`identity_vector`**) when present; fallback embedding from text when missing |
| **Stored scores per path** | `hybridScoreNextRole`, `hybridCosineNextRole`, `hybridScoreOutOfTheBox`, `hybridCosineOutOfTheBox` |
| **Operational** | **`OPENAI_API_KEY`** required for runtime user/fallback embeddings; simulation fails fast if embeddings cannot be computed |
| **Explainability** | Steps expose hybrid scores, cosines, and enriched path fields (`skillModel`, `keyResponsibilities`, `skillDomains`, `seniority`) for UI/debug |

**Fusion weights, seniority penalty formula, structured sub-channel weights:** [**`CAREER_MATCHING_ALGORITHM_TECHNICAL_OVERVIEW.md`**](./CAREER_MATCHING_ALGORITHM_TECHNICAL_OVERVIEW.md) §3.

---

## 4. Prioritized lists (Phase 2)

**Generator:** **`generatePrioritizedListsPhase2`** (`prioritizedListGenerator.js`) — builds **`prioritizedLists`** (`nextCareerRoles`, `outsideTheBoxRoles`), **`prioritizedListTotals`**, **`currentPositions`**, deterministic **`stepId`** (**`attachDeterministicStepIdsToPrioritizedLists`**; **`id = stepId`** for compatibility).

| Topic | Implementation |
|--------|----------------|
| **Initial cards** | Top **3** per category in **`nextSteps`** / **`outsideTheBox`** |
| **Replacement** | On remove, next item from the same prioritized list; **`currentPositions`** is the cursor |
| **Cross-category** | Outside list excludes titles already in the next list |
| **Runtime list order** | **`prioritizedLists`** order is fixed when the simulation runs (MMR at generation only). **Remove** advances **`currentPositions`** and pulls the next item; there is **no** server-side tail reorder after card actions. |
| **Stored payloads** | Prefer **`prioritizedLists`** + **`currentPositions`**; some documents may include **`replacementPools`** / **`removedSteps`** |
| **List exhaustion** | UI explains when no further item exists |

**MMR parameters, per-mode candidate pool sizes, exploration / novelty rules:** [**`CAREER_MATCHING_ALGORITHM_TECHNICAL_OVERVIEW.md`**](./CAREER_MATCHING_ALGORITHM_TECHNICAL_OVERVIEW.md) §3.7–4.

### 4.1 Step identity and duplicate saves

| Topic | Detail |
|--------|--------|
| **Canonical id** | Backend provides deterministic **`stepId`** (and **`id = stepId`**). Client uses **`stepId`** (fallback **`id`**) for remove, save, navigation, APIs — **`SIMULATION_CARD_ACTIONS_HARMONIZED_REQUIREMENTS.md`**. |
| **Duplicate save (library)** | **`duplicateDetection.js`** (`detectDuplicates`): exact **`stepId`** match, content heuristics, semantic title/description match with default threshold **0.8**; duplicate → **409** with payload from **`POST /api/profile/saved-career-steps`**. Client: clear messaging on **409**. |

---

## 5. Results structure

```javascript
results: {
  simulationId,
  algorithmVersion: '2',      // ALGORITHM_VERSION
  scoringVersion: '2',        // SCORING_VERSION
  embeddingProvider: 'openai', // runtime embeddings via OpenAI API
  embeddingVersion: '1',
  nextSteps: [...],           // top 3 from nextCareerRoles (vectors stripped)
  outsideTheBox: [...],
  furtherAdvice: [...],
  prioritizedLists: { nextCareerRoles, outsideTheBoxRoles },
  prioritizedListTotals: { nextCareerRoles, outsideTheBoxRoles },
  currentPositions: { nextCareerRoles: 3, outsideTheBoxRoles: 3 },
  profileEnrichment: {...}    // if document enrichment applied
}
```

Each step exposes hybrid scores and optional enrichment; `roleVectors` / `hybrid_vector` are **not** sent to the client (stripped in controller).

---

## 6. Profile completion & threshold

| Requirement | Implementation |
|-------------|----------------|
| **Minimum to start** | 60% (`MIN_SIMULATION_PROFILE_COMPLETION_PCT`) |
| **Backend enforcement** | `runSimulation` returns **403** with completion breakdown if below 60% |
| **UI** | Profile page hides "Go to Simulation" when &lt;60% |
| **Calculation** | `computeProfileCompletion` / `GET /api/profile/completion`; same weighting as profile progress |
| **Response** | `profileCompletion` in JSON is the user’s actual overall completion percentage |

---

## 7. Persistence & APIs

**Canonical route table** for the simulation/saved-simulation subset (all paths under **`/api/profile`**, see **`src/server/routes/profile.js`**). **Non-exhaustive** for the whole profile router — other profile endpoints (personal info, CSI, saved career steps, etc.) are in the same file but not listed here. **Documents** use **`/api/documents`** (`src/server/routes/documents.js`).

**Feature docs** should link to this section instead of copying paths: e.g. removal ([**`REMOVE_CAREER_STEPS_FEATURE.md`**](./REMOVE_CAREER_STEPS_FEATURE.md)), save-changes ([**`SAVE_CHANGES_TO_EXISTING_SIMULATIONS_REQUIREMENTS.md`**](./SAVE_CHANGES_TO_EXISTING_SIMULATIONS_REQUIREMENTS.md)).

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
| `POST` | `/simulation/:simulationId/replace-career-step/:stepId` | Replace step (display-limit path) |
| `DELETE` | `/simulation-results/:simulationId/career-steps/:stepId` | Remove step; server may append next from list |
| `PUT` | `/simulation-results/:simulationId` | Update full saved simulation payload (“save changes”) |

---

## 8. Operational & privacy notes

1. **Third-party API**: Live embeddings call OpenAI; policy and key handling are environment-specific—see deployment docs and `embeddingService.js`.
2. **Performance**: Scoring chunks paths (150 per batch) with parallel hybrid calls; full run can take tens of seconds depending on pool size and API latency (controller timeout 3 minutes).
3. **Algorithm constants:** Update **[`CAREER_MATCHING_ALGORITHM_TECHNICAL_OVERVIEW.md`](./CAREER_MATCHING_ALGORITHM_TECHNICAL_OVERVIEW.md)** when scoring/MMR/pool tuning changes — not the tables in §3–4 of this file.
