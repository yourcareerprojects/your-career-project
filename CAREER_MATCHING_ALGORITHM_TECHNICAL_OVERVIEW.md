# Career Matching Algorithm — Technical Overview (Production Simulation)

**Purpose:** Document the **live** matching pipeline for `POST /api/profile/simulation`: hybrid embedding scores and diversity-aware prioritized lists.

**Canonical for:** Numeric parameters (fusion weights, MMR λ / minNovelty / k, candidate pool sizes, exploration thresholds), scoring formulas, and step-by-step list construction. **When these values change, update this file first**; other docs should point here rather than restate constants.

**See also:** **`requirements.md`** §11 **`### 9.7`** (product summary), **`SIMULATION_IMPLEMENTATION_REQUIREMENTS.md`** (path pool fetch limits, results JSON shape, HTTP APIs, module/file map).

---

## 1. System objective

### 1.1 Primary optimization goal

Production simulation runs in **two phases**:

- **Phase 1 (Scoring):** For each career path with usable vectors, compute **NEXT_ROLE** and **OUT_OF_THE_BOX** hybrid scores: OpenAI **`text-embedding-3-large`** (3072-d), L2-normalized **structured** and **identity** user↔role embeddings, cosine similarity, then **`computeSeniorityPenalty`** so stored values are `cosine × max(0, 1 − penalty)` (`roleMatchingScorer.js`). Entry point: **`enrichCareerPathWithHybridScores`** in **`services/scoring/careerPathScorer.js`**.
- **Phase 2 (Prioritization):** Build per-category pools from hybrid scores, apply **exploration / novelty** rules for OOTB, then **MMR** for diversity. Lists are produced **once** at simulation time; user **remove** advances **`currentPositions`** in **`prioritizedLists`** (product summary: **`requirements.md`** §11 **`### 9.9.8`**). **Numeric parameters:** §3.7–4 below.

### 1.2 User experience design

| Aspect | Design |
|--------|--------|
| **Next career roles** | Skill-adjacent, logical next steps; stronger structural channel in hybrid fusion |
| **Out-of-the-box roles** | Identity-aligned structural shift; exploration band on identity vs structure |
| **Initial display** | Top 3 per category (configurable) |
| **List size** | Default 25 per category in list output (see implementation) |
| **Replacement** | Sequential pull from **`prioritizedLists`** + **`currentPositions`** |
| **Runtime reorder** | None: list order is determined when lists are built (§4); card actions do not re-run MMR on the tail. |

### 1.3 Matching modes

| Mode | Goal | Primary signal | Filter | Ranking |
|------|------|----------------|--------|---------|
| **NEXT_ROLE** | Skill-adjacent next step | `hybridScoreNextRole` | `hybridScoreNextRole > 0` | Top pool by hybrid → MMR |
| **OUT_OF_THE_BOX** | Identity-aligned shift | Hybrid + exploration geometry | `passesExplorationCriteria` | Hybrid-ranked pool → MMR (structured novelty) |
| **HYBRID** | Not a separate user-facing mode | — | — | Fusion weights differ per mode (below) |

**Exploration constants (`roleMatchingScorer.js`; overridable from `generatePrioritizedListsPhase2`):**

```javascript
EXPLORATION_IDENTITY_THRESHOLD = 0.50   // fallback absolute identity floor
EXPLORATION_STRUCTURE_UPPER_BOUND = 0.75
EXPLORATION_STRUCTURE_LOWER_BOUND = 0.40
```

**OOTB identity cutoff (default):** `prioritizedListGenerator.js` often uses a **relative** threshold (~60% pass rate over the batch) from a quantile over `identitySimilarity`, unless `explorationIdentityThreshold` is passed explicitly.

---

## 2. Data model

### 2.1 User inputs (`careerSimulationInputs`)

Computed from the profile (and edits). These fields drive **structured** and **identity** text/vectors in production.

| Order | Field | Path | Role in hybrid pipeline |
|-------|-------|------|-------------------------|
| 1 | Skills | `structuredUserInfo.skills[]` | Structured: required_skills channel |
| 2 | Skills in development | `structuredUserInfo.skillsInDevelopment[]` | Structured: optional_skills channel |
| 3 | Key responsibilities | `structuredUserInfo.keyResponsibilities[]` | Structured: skill_domains, responsibilities |
| 4 | Domains | `structuredUserInfo.domains[]` (free-form domains) | Structured: **occupation_group** (domain embedding + inferred ISCO embedding) |
| 5 | Seniority | `seniority` object | **Penalty** in `roleMatchingScorer` (not a fused structured sub-vector) |
| 6 | Bio | `userIdentity.bio` | Identity narrative / LLM identity input |
| 7 | Interests | `userIdentity.interests[]` | Identity narrative / LLM identity input |
| 8 | Career goal | `userIdentity.careerGoal` | Identity + **exclusion** from lists if title contains goal |
| — | Cached identity text | `embeddingOptimizedUserIdentityText` | Preferred input for identity embedding when present |
| 9 | Seniority mirrors | `seniority.{currentStatus,yearsOfExperience,highestDegree,mostSeniorWorkExperience}` | Penalty and fallback context in matching |

**Seniority level (0–6) encoding (typical labels):**

| Level | Label |
|-------|-------|
| 0 | Entry / Intern / Trainee |
| 1 | Junior |
| 2 | Junior–Mid |
| 3 | Mid-level |
| 4 | Senior |
| 5 | Lead / Principal |
| 6 | Head / Director / Expert |

**User seniority inference (summary):** weighted blend of `mostSeniorWorkExperience`, years of experience bands, degree level, `currentStatus`; title keyword fallback via **`seniorityService.analyzeTitleKeywords`**.

**Derived structured channels:** skill-domain heuristics (**`skillDomainExtractor`**), ISCO → labels (**`iscoMapping.resolveIscoToLabels`**). **Identity text:** prefer cached LLM-compressed identity (**`userIdentityEmbeddingTextService.js`**); else deterministic composite (**`buildUserIdentityTextLegacy`**).

**Text normalization (representative):** **`structuredTextBuilder.js`** `canonicalize`; skill keys normalized where required for ESCO / path pool selection (see codebase).

---

### 2.2 Role model (`CareerPath`)

| Field | Type | Use in production matching |
|-------|------|------------------------------|
| `escoId` | string | Dedup, metadata |
| `title`, `description` | string | Fallback embedding text if vectors missing; seniority hints |
| `requiredSkillKeys` | string[] | **Path pool selection** (intersection with user skills), not a separate table score |
| `requiredSkills`, `requiredSkillUris` | arrays | Enrichment / display / fallbacks |
| `iscoGroup` | string | Feeds **occupation_group** structured channel (embedding), not ISCO prefix table scoring in live sim |
| `skillModel` | object | Enrichment for responsibilities/skills text used in vectors and UI |
| `seniority` | object | **Seniority penalty** target level |
| `keyResponsibilities`, `skillDomains`, `roleIdentity` | objects | Structured and identity **embedding sources** |
| `roleVectors` | object | Precomputed **3072-d** sub-vectors (see below) |

**`roleVectors` sub-vectors (3072-d unless noted):**

| Sub-vector | Description |
|------------|-------------|
| `structured_vector_occupation_group` | Occupation / ISCO-related structured embedding |
| `structured_vector_skill_domains` | Skill domains |
| `structured_vector_responsibilities` | Responsibilities |
| `structured_vector_required_skills` | Core skills |
| `structured_vector_optional_skills` | Optional skills |
| `structured_vector_seniority` | Deprecated / unused in structured fusion |
| `identity_vector` | Role identity text embedding |
| `hybrid_vector` | May exist on document; **mode-specific hybrid is fused at score time** from structured + identity |

**Structured fusion order (users and roles):** `occupation_group` → `skill_domains` → `responsibilities` → `required_skills` → `optional_skills`.

**Role seniority inference:** ISCO major group, title/description keywords, skill complexity — **`seniorityService.js`**.

---

## 3. Scoring logic (production)

### 3.1 Pipeline overview

- **Controller:** `profileController.runSimulation` scores candidates with **`enrichCareerPathWithHybridScores`**.
- **Output per path:** `hybridScoreNextRole`, `hybridCosineNextRole`, `hybridScoreOutOfTheBox`, `hybridCosineOutOfTheBox`.
- **Lists:** **`generatePrioritizedListsPhase2`** — next and OOTB pipelines in **§3.7–4** (exact λ, k, pool sizes).

### 3.2 Hybrid vector scoring (`roleMatchingScorer.js`)

**NEXT_ROLE:**

```javascript
userHybrid = weightedFusion(userStructured, userIdentity, { 0.75, 0.25 })  // L2-normalized
roleHybrid = weightedFusion(roleStructured, roleIdentity, { 0.75, 0.25 })
hybridCosine = cosineSimilarity(userHybrid, roleHybrid)
penalty = computeSeniorityPenalty(roleLevel - userLevel, 'NEXT_ROLE')
hybridScoreFinal = hybridCosine * max(0, 1 - penalty)
```

**OUT_OF_THE_BOX:**

```javascript
userHybrid = weightedFusion(userStructured, userIdentity, { 0.45, 0.55 })
roleHybrid = weightedFusion(roleStructured, roleIdentity, { 0.45, 0.55 })
hybridCosine = cosineSimilarity(userHybrid, roleHybrid)
penalty = computeSeniorityPenalty(roleLevel - userLevel, 'OUT_OF_THE_BOX')
hybridScoreFinal = hybridCosine * max(0, 1 - penalty)
// Also exposes structuredSimilarity and identitySimilarity for exploration filters
```

### 3.3 Structured channel weights (`structuredTextBuilder.js`)

**NEXT_ROLE:**

```javascript
WEIGHTS_NEXT_ROLE = {
  occupation_group: 0.15 / 0.92,
  skill_domains: 0.30 / 0.92,
  responsibilities: 0.12 / 0.92,
  required_skills: 0.30 / 0.92,
  optional_skills: 0.05 / 0.92
}
```

**OUT_OF_THE_BOX:**

```javascript
WEIGHTS_OUT_OF_THE_BOX = {
  occupation_group: 0.20 / 0.92,
  skill_domains: 0.25 / 0.92,
  responsibilities: 0.20 / 0.92,
  required_skills: 0.15 / 0.92,
  optional_skills: 0.12 / 0.92
}
```

### 3.4 Exploration note

The OOTB MMR input pool is ranked by **`hybridScoreOutOfTheBox`** after **`passesExplorationCriteria`** and the **novelty-vs-next** structured filter (not by a separate weighted `explorationScore` line in **`prioritizedListGenerator.js`**).

### 3.5 Cosine similarity (`embeddingService.js`)

```javascript
function cosineSimilarity(a, b) {
  if (!a || !b || a.length !== b.length) return 0;
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
  if (dot > 1) return 1;
  if (dot < -1) return -1;
  return dot;
}
// Vectors are L2-normalized; dot product equals cosine
```

### 3.6 Embeddings (`embeddingService.js`)

**Model:** OpenAI **`text-embedding-3-large`**, 3072 floats, L2-normalized after fetch. Batched requests with LRU caching. **`OPENAI_API_KEY`** required at runtime for user/fallback text; precomputed role vectors avoid re-embedding roles when present.

### 3.7 Prioritized list filtering (`prioritizedListGenerator.js`)

**Next roles**

- `hybridScoreNextRole > 0`
- Exclude if title contains career goal (case-insensitive)
- Top **150** by hybrid → dedupe by title → MMR (λ=0.85, minNovelty=0.05, k=25)

**Out-of-the-box**

- **`passesExplorationCriteria`** on batch `identitySimilarity` / `structuredSimilarity` (bounds configurable; identity threshold often **relative** ~60% pass rate)
- Exclude titles in next list and titles containing career goal
- **Novelty vs next:** structured max similarity to finalized next list; threshold from **p75** of pairwise next↔next similarities (with fallback)
- Sort by `hybridScoreOutOfTheBox`, top **150**, MMR (λ=0.65, minNovelty=0.15) using structured embeddings for novelty

---

## 4. Career path generation

### 4.1 Next role selection

1. Score paths with `enrichCareerPathWithHybridScores`
2. Filter: `hybridScoreNextRole > 0`, exclude career goal in title
3. Build client step objects with **`buildStepObject`** (hybrid fields + enriched path fields)
4. Sort by `hybridScoreNextRole`, top 150, dedupe by title
5. MMR: k=25, λ=0.85, minNovelty=0.05, mode NEXT_ROLE

### 4.2 Out-of-the-box selection

1. Exclude next titles and career goal from pool
2. `scoreOutOfTheBoxBatch` (hybrid + identity/structure metrics)
3. `passesExplorationCriteria` with computed identity threshold
4. Structured novelty filter vs finalized next list (p75-based threshold)
5. Sort by `hybridScoreOutOfTheBox`, top 150, dedupe by title
6. MMR: k=25, λ=0.65, minNovelty=0.15, structured novelty

### 4.3 Multi-step paths

No explicit multi-step graph: one simulation produces lists; replacement is sequential from stored lists.

### 4.4 MMR (greedy)

```javascript
// mmrSelect — at each step:
value = λ × baseScore + (1 - λ) × novelty
novelty = 1 - maxSimToSelected
```

### 4.5 Constraints

- Cross-category uniqueness (next vs OOTB titles) at list build
- OOTB exploration and novelty-vs-next as above

---

## 5. Evaluation and limitations

### 5.1 Metrics

- Distribution stats over **`hybridScoreNextRole` / `hybridScoreOutOfTheBox`** (and cosines) as needed for tuning
- Dedicated evaluation scripts under **`scripts/`** (e.g. hybrid vector experiments) — see repo

### 5.2 Known weaknesses

| Area | Notes |
|------|--------|
| **API dependency** | User/fallback embeddings need OpenAI; failures or rate limits affect simulation |
| **Cost / latency** | Large path pools and missing vectors increase calls and time |
| **Sparse profiles** | Weaker structured/identity signal; fallback path pool when skill intersection is thin |
| **Seniority** | Heuristic user and role levels; ambiguous titles can mis-rank penalty |
| **Heuristic text** | Role degree/education guesses from text when structured fields missing affect penalty only indirectly via level inference |

### 5.3 Trade-offs

| Topic | Choice |
|-------|--------|
| **Relevance vs diversity** | MMR λ higher for next (0.85), lower for OOTB (0.65) |
| **Modes** | Different fusion weights (0.75/0.25 vs 0.45/0.55) and penalty curves |
| **Explainability** | Steps carry hybrid scores and cosines; enriched path fields for UI |
| **Determinism** | No intentional randomness; identical inputs assumed to yield stable embeddings |

### 5.4 Edge cases

| Case | Handling |
|------|----------|
| Missing `roleVectors` | Fallback embedding from title, description, skills, category text |
| Empty candidate set | Novelty threshold fallbacks in generator (see code) |
| Sparse matches | Wider ESCO pool per **`requirements.md`** / controller logic |

---

## 6. File reference (production path)

| Purpose | Path |
|---------|------|
| Hybrid orchestration | `src/server/services/scoring/careerPathScorer.js` |
| Hybrid scoring + penalties | `src/server/services/embedding/roleMatchingScorer.js` |
| User vectors | `src/server/services/embedding/userProfileVectorBuilder.js` |
| Role vectors | `src/server/services/embedding/roleVectorService.js` |
| Structured text + weights | `src/server/services/embedding/structuredTextBuilder.js` |
| Embeddings, MMR | `src/server/services/embedding/embeddingService.js` |
| Profile payload for hybrid | `src/server/services/scoring/hybridUserProfileForMatching.js` |
| Prioritized lists | `src/server/services/simulation/prioritizedListGenerator.js` |
| Simulation entry | `src/server/controllers/profileController.js` (`runSimulation`) |
| User / CareerPath models | `src/server/models/User.js`, `CareerPath.js` |
| Seniority | `src/server/services/seniorityService.js` |

---

*This overview reflects **production** simulation behavior only.*
