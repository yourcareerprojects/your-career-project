# Simulation Feature Architecture (As-Built)

High-level description of how the **career simulation** is structured today. For file-level behavior, data shapes, and API contracts, prefer **`SIMULATION_IMPLEMENTATION_REQUIREMENTS.md`** and **`CAREER_MATCHING_ALGORITHM_TECHNICAL_OVERVIEW.md`**.

---

## 1. Overall architecture

The simulation is implemented as a **modular pipeline** on the Express/MongoDB backend and a dedicated **React** experience on the client, with clear separation between persistence, scoring, list generation, and UI.

| Layer | Role | Primary locations |
|--------|------|-------------------|
| **API** | Auth, validation, simulation run, saved results, career-step removal, updates | `server.js`, `src/server/routes/profile.js`, `src/server/controllers/profileController.js` |
| **Scoring** | Hybrid NEXT_ROLE / OUT_OF_THE_BOX vectors, seniority penalty | `src/server/services/scoring/roleMatchingScorer.js`, `careerPathScorer.js`, `userProfileVectorBuilder.js` |
| **Lists** | MMR, exploration filters, deterministic `stepId`, `prioritizedLists` / `currentPositions` | `src/server/services/simulation/prioritizedListGenerator.js` (and related), `generatePrioritizedListsPhase2` |
| **ESCO / pool** | Occupation data in MongoDB, cached paths, skill map | `src/server/services/escoService.js`, scripts under `scripts/` |
| **Client** | Run simulation, results cards, saved/unsaved flows, navigation guard, session persistence | `src/client/components/pages/Simulation.jsx`, `SimulationResultDetails.jsx`, `CareerStepCardWithReplacement.jsx`, `NavigationGuardContext.jsx` |

---

## 2. Backend responsibilities

- **ESCO / career paths:** Occupations and skills are **synced and cached** in MongoDB (not live calls to the ESCO HTTP API on each simulation). See `scripts/syncEscoOccupations.js` and `escoService`.

- **Supplementary data:** Additional public APIs (trending jobs, salary, etc.) remain **optional**; the production path does not depend on them.

- **Profile inputs:** Simulation reads **`careerSimulationInputs`** (and related profile fields), with optional document enrichment and manual override; see **`SIMULATION_IMPLEMENTATION_REQUIREMENTS.md`** §1.

- **Simulation algorithm:** Pools ESCO paths (skill match + fallback), scores with **hybrid embeddings** (OpenAI `text-embedding-3-large`, structured + identity, seniority penalty), builds **prioritized lists** with **MMR** and OOTB exploration rules, and returns **next steps**, **outside-the-box**, and **further advice** payloads.

- **Persistence:** Results per user (latest run, **saved simulations** list), **PUT** to update saved simulations, **DELETE** to remove steps and advance list cursors.

- **API surface (profile/simulation):** Includes **`POST /api/profile/simulation`**, reads/updates for **simulation results**, **DELETE** for career steps on a result, **PUT** for updating a saved simulation, plus auth on all user data. Exact paths are in `src/server/routes/profile.js`.

- **Security:** JWT-protected routes; results scoped to the owning user; embedding calls send derived text to the configured provider—manage keys and compliance in deployment.

---

## 3. Frontend responsibilities

- **Simulation UI:** Entry via the simulation page (e.g. puzzle control), **progress** during runs, **career goal** from profile (not chosen at run start).

- **Results:** Cards for **next steps**, **outside-the-box**, and **advice**; career goal surfaced when set; **save**, **dislike**, **remove** aligned with **`SIMULATION_CARD_ACTIONS_HARMONIZED_REQUIREMENTS.md`**.

- **Saved simulations:** Open saved runs, edit (remove/replace), **save changes** back to the server where the feature is enabled.

- **Profile completion:** **60%** minimum to run simulation (enforced server-side; UI reflects completion). Below threshold, user is guided to complete the profile rather than run.

- **Navigation / state:** **Unsaved** vs **saved** context, **Back to Results**, session persistence, and **navigation guard** for dirty simulation state—see **`UNSAVED_CHANGES_NAVIGATION_GUARD_REQUIREMENTS.md`** and `NavigationGuardContext.jsx`.

---

## 4. Data flow (simplified)

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

## 5. Modularity and extensibility

- **Backend:** Scoring and list generation live in **services**; ESCO sync and embeddings are **batch/scriptable**.

- **Frontend:** Simulation is a **route-level** page with **shared cards** and **context** for guards and auth.

---

## 6. Security and privacy

- Simulation and profile mutation endpoints require **authentication**.
- Results are **user-scoped**.
- Embedding requests use **derived** profile/role text; treat provider credentials and data handling as production secrets.
