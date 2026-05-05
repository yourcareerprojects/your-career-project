# Career Path Exploration Tool — Requirements (As-Built)

This document is the **master product/requirements index** for the **current** React + Express + MongoDB application. It summarizes **shipping** behavior and points to focused `*_REQUIREMENTS.md` companions for feature depth.

---

## How to navigate this document

| § | Topic |
|---|--------|
| **1** | Project overview and **§1.5.x** UX/navigation requirements |
| **2** | Implemented application scope (stack, routes, data) |
| **3** | Product goals (short) |
| **4** | Related documentation index |
| **5** | Updating saved simulations |
| **11** | **Core Features** — normative behavior. Subsections use **`### 9.x`** labels for **stable citations** elsewhere in the repo (e.g. “§11, subsection **9.6**” means the `### 9.6` heading under §11, not top-level §9). |
| **12** | Change log (abbreviated) |

**Simulation (technical):** **Numeric matching spec** — [CAREER_MATCHING_ALGORITHM_TECHNICAL_OVERVIEW.md](./CAREER_MATCHING_ALGORITHM_TECHNICAL_OVERVIEW.md); **APIs, pools, results JSON** — [SIMULATION_IMPLEMENTATION_REQUIREMENTS.md](./SIMULATION_IMPLEMENTATION_REQUIREMENTS.md); **card actions** — [SIMULATION_CARD_ACTIONS_HARMONIZED_REQUIREMENTS.md](./SIMULATION_CARD_ACTIONS_HARMONIZED_REQUIREMENTS.md) + [BUTTON_STYLING_CONSISTENCY.md](./BUTTON_STYLING_CONSISTENCY.md); **architecture map** — [ARCHITECTURE.md](./ARCHITECTURE.md).

---

## 1. Project overview

### 1.5 Navigation and user experience

#### 1.5.1 Simulation result navigation

**Behavior:** Saved vs unsaved simulation context is distinguished. **Back to Results** returns to the correct list. Session persistence and `location.state` carry payloads between list and detail views. **Implementation:** `Simulation.jsx`, `SimulationResultDetails.jsx`, `App.jsx`.

#### 1.5.2 Unsaved changes navigation guard

**Behavior:** Warns on leave when a simulation has unsaved edits; user can stay, discard, or save (including navigation-guard save aligned with the main save dialog). **Detail:** [UNSAVED_CHANGES_NAVIGATION_GUARD_REQUIREMENTS.md](./UNSAVED_CHANGES_NAVIGATION_GUARD_REQUIREMENTS.md).

#### 1.5.3 Career step display limit

**Behavior:** Per-category caps and total cap enforced server- and client-side. **Detail:** [CAREER_STEP_DISPLAY_LIMIT_REQUIREMENTS.md](./CAREER_STEP_DISPLAY_LIMIT_REQUIREMENTS.md). Server defaults and env overrides: `src/server/config/displayLimits.js`.

#### 1.5.4 Profile update recommendation

**Behavior:** When a category hits the exploration limit, a non-blocking recommendation to update the profile may appear once per session. **Detail:** [PROFILE_UPDATE_RECOMMENDATION_REQUIREMENTS.md](./PROFILE_UPDATE_RECOMMENDATION_REQUIREMENTS.md).

#### 1.5.5 Simulation results persistence (client)

**Behavior:** Clean / modified / saved states; session keys for unsaved runs; navigation guard rules for modified state. **Detail:** [SIMULATION_IMPLEMENTATION_REQUIREMENTS.md](./SIMULATION_IMPLEMENTATION_REQUIREMENTS.md), [SIMULATION_CARD_ACTIONS_HARMONIZED_REQUIREMENTS.md](./SIMULATION_CARD_ACTIONS_HARMONIZED_REQUIREMENTS.md).

#### 1.5.6 Profile edit cancel

**Detail:** [PROFILE_EDIT_CANCEL_BUTTON_REQUIREMENTS.md](./PROFILE_EDIT_CANCEL_BUTTON_REQUIREMENTS.md).

#### 1.5.7 Profile edit cancel confirmation

**Detail:** [PROFILE_EDIT_CANCEL_CONFIRMATION_DIALOG_REQUIREMENTS.md](./PROFILE_EDIT_CANCEL_CONFIRMATION_DIALOG_REQUIREMENTS.md).

#### 1.5.8–1.5.10 Sort order (legacy)

Work-experience/education/language sort-mode behavior belonged to removed profile sections and is no longer part of the active profile model.

#### 1.5.11 Profile picture

**Detail:** [PROFILE_PICTURE_MANAGEMENT_REQUIREMENTS.md](./PROFILE_PICTURE_MANAGEMENT_REQUIREMENTS.md).

#### 1.5.12 Minimal signup (email and password)

**Intent:** Registration collects only credentials; profile data is added later on `/profile` (and related flows). **Detail:** [MINIMAL_REGISTRATION_SIGNUP_REQUIREMENTS.md](./MINIMAL_REGISTRATION_SIGNUP_REQUIREMENTS.md).

---

## 2. Implemented application scope

- **Client:** React 18 SPA (dev: webpack on port 3001), React Router, MUI, Formik/Yup, Axios; main flows under `src/client/components/pages/`.
- **Server:** Express (`server.js`), JSON API under `/api`, static `public/`, uploads at `/uploads` from `src/uploads/`.
- **Data:** MongoDB + Mongoose; ESCO occupation data in DB (sync via `npm run sync:esco`), not a live ESCO HTTP call per simulation.
- **Auth:** Email/password registration and login, JWT (`Authorization: Bearer`), `JWT_SECRET` required at server startup. **Target signup scope** (minimal fields at account creation): [MINIMAL_REGISTRATION_SIGNUP_REQUIREMENTS.md](./MINIMAL_REGISTRATION_SIGNUP_REQUIREMENTS.md).
- **Public vs protected UI routes:** The **simulation** page (`/simulation`) is a **public** client route in `App.jsx`—anyone can open it. **Running** a simulation still requires an authenticated session: `POST /api/profile/simulation` returns **401** without a valid token and **403** when profile completion is below threshold (see `### 9.4`). Saved simulations, profile, and related flows remain behind `ProtectedRoute` as implemented.
- **Major capabilities:** User profile (sections as implemented on `/profile`), CV PDF upload and extraction, documents, career simulation (hybrid embeddings + prioritized lists), saved simulations, saved career steps, share links (`/api/share`), job analysis (`/api/job-analysis`), occupation search (`/api/occupations`).
- **Below simulation threshold:** Profile and simulation entry enforce **60%** completion; a **Trending Career Paths** experience exists as **static mock content** (`/trending`, links from profile when below threshold)—not live labour-market data.
- **Not claimed here:** Annual email reminders, automatic **5% per year** profile “decay,” salary/market APIs, LinkedIn/Twitter share OAuth, or dedicated `GET /api/simulation/results/:id/details` endpoints. Detail views use **client routes** and existing profile/simulation payloads (see §11 `### 9.8`).

---

## 3. Product goals

The product helps individuals explore **non-linear** career options using a **simulation** grounded in their profile and ESCO-based occupations, with transparent match inputs, saved runs, and optional sharing.

Target users include people **exploring**, **transitioning**, or **planning** careers; the UI is **not** organized around literal “puzzle piece” mechanics in the shipped app—the **simulation control** uses the familiar puzzle-piece **icon** (MUI) as a metaphor only.

---

## 4. Related documentation index

| Document | Use |
|----------|-----|
| [README.md](./README.md) | Run, env, scripts, API table |
| [SIMULATION_IMPLEMENTATION_REQUIREMENTS.md](./SIMULATION_IMPLEMENTATION_REQUIREMENTS.md) | Simulation inputs, path pool, **§7** API table, results JSON, gates (numeric scoring: [CAREER_MATCHING_ALGORITHM_TECHNICAL_OVERVIEW.md](./CAREER_MATCHING_ALGORITHM_TECHNICAL_OVERVIEW.md)) |
| [`App.jsx`](./src/client/components/App.jsx) (routing) | Simulation and saved-simulation client routes (see components under `src/client/components/pages/`). |
| [CAREER_MATCHING_ALGORITHM_TECHNICAL_OVERVIEW.md](./CAREER_MATCHING_ALGORITHM_TECHNICAL_OVERVIEW.md) | Hybrid scoring, MMR, exploration |
| [SIMULATION_CARD_ACTIONS_HARMONIZED_REQUIREMENTS.md](./SIMULATION_CARD_ACTIONS_HARMONIZED_REQUIREMENTS.md) | Save / dislike / remove semantics, `stepId` (layout: [BUTTON_STYLING_CONSISTENCY.md](./BUTTON_STYLING_CONSISTENCY.md)) |
| [REMOVE_CAREER_STEPS_FEATURE.md](./REMOVE_CAREER_STEPS_FEATURE.md) | Remove + replacement, DELETE contract |
| [SAVE_CHANGES_TO_EXISTING_SIMULATIONS_REQUIREMENTS.md](./SAVE_CHANGES_TO_EXISTING_SIMULATIONS_REQUIREMENTS.md) | `PUT` saved simulation |
| [CAREER_STEP_DETAILS_CONSISTENCY_REQUIREMENTS.md](./CAREER_STEP_DETAILS_CONSISTENCY_REQUIREMENTS.md) | Detail pages layout, skills, alt titles |
| [CAREER_STEP_DISPLAY_LIMIT_REQUIREMENTS.md](./CAREER_STEP_DISPLAY_LIMIT_REQUIREMENTS.md) | Display limits |
| [CAREER_STEP_ENRICHED_FIELDS_DISPLAY_REQUIREMENTS.md](./CAREER_STEP_ENRICHED_FIELDS_DISPLAY_REQUIREMENTS.md) | Enriched fields on cards |
| [CAREER_PREFERENCES_ISCO_CODES_REQUIREMENTS.md](./CAREER_PREFERENCES_ISCO_CODES_REQUIREMENTS.md) | ISCO industry preferences |
| [ESCO_ALT_LABELS_SYNONYMS_REQUIREMENTS.md](./ESCO_ALT_LABELS_SYNONYMS_REQUIREMENTS.md) | Alt labels / synonyms |
| [PROFILE_USER_IDENTITY_FIELDS_REQUIREMENTS.md](./PROFILE_USER_IDENTITY_FIELDS_REQUIREMENTS.md) | Bio, interests, career goal |
| [PROFILE_USER_IDENTITY_TEXT_SECTION_REQUIREMENTS.md](./PROFILE_USER_IDENTITY_TEXT_SECTION_REQUIREMENTS.md) | User Identity Text UI |
| [PROFILE_SENIORITY_SECTION_REQUIREMENTS.md](./PROFILE_SENIORITY_SECTION_REQUIREMENTS.md) | Seniority section |
| [PROFILE_SKILLS_IN_DEVELOPMENT_REQUIREMENTS.md](./PROFILE_SKILLS_IN_DEVELOPMENT_REQUIREMENTS.md) | Skills in development |
| [PROFILE_PICTURE_MANAGEMENT_REQUIREMENTS.md](./PROFILE_PICTURE_MANAGEMENT_REQUIREMENTS.md) | Avatar upload/crop |
| [SAVED_SIMULATIONS_BUTTON_DESIGN_REQUIREMENTS.md](./SAVED_SIMULATIONS_BUTTON_DESIGN_REQUIREMENTS.md) | Saved simulations UI |
| [BUTTON_STYLING_CONSISTENCY.md](./BUTTON_STYLING_CONSISTENCY.md) | **Canonical** career-step **2×2** action grid, shared `sx` / icons, dislike color rules |
| [UNSAVED_CHANGES_NAVIGATION_GUARD_REQUIREMENTS.md](./UNSAVED_CHANGES_NAVIGATION_GUARD_REQUIREMENTS.md) | Navigation guard |
| [PROFILE_UPDATE_RECOMMENDATION_REQUIREMENTS.md](./PROFILE_UPDATE_RECOMMENDATION_REQUIREMENTS.md) | Profile update nudge |
| [PROFILE_EDIT_CANCEL_BUTTON_REQUIREMENTS.md](./PROFILE_EDIT_CANCEL_BUTTON_REQUIREMENTS.md) | Cancel edit |
| [PROFILE_EDIT_CANCEL_CONFIRMATION_DIALOG_REQUIREMENTS.md](./PROFILE_EDIT_CANCEL_CONFIRMATION_DIALOG_REQUIREMENTS.md) | Cancel confirm |
| [MINIMAL_REGISTRATION_SIGNUP_REQUIREMENTS.md](./MINIMAL_REGISTRATION_SIGNUP_REQUIREMENTS.md) | **Target:** signup with email + password only; profile data deferred |
| [`evaluation/output/`](./evaluation/output/) | Offline evaluation run output (e.g. ranking tables). **Not** normative product requirements; files include a scope banner. |

---

## 5. Save changes to existing saved simulations

Users may edit a **saved** simulation (e.g. remove/replace steps) and persist the document with **`PUT /api/profile/simulation-results/:simulationId`**. The server updates the embedded `results` (including `prioritizedLists`, `currentPositions`, and related fields) without creating a new simulation id.

**Normative detail:** [SAVE_CHANGES_TO_EXISTING_SIMULATIONS_REQUIREMENTS.md](./SAVE_CHANGES_TO_EXISTING_SIMULATIONS_REQUIREMENTS.md). **UI:** Save Changes control and tooltips per [SAVED_SIMULATIONS_BUTTON_DESIGN_REQUIREMENTS.md](./SAVED_SIMULATIONS_BUTTON_DESIGN_REQUIREMENTS.md) and [SIMULATION_CARD_ACTIONS_HARMONIZED_REQUIREMENTS.md](./SIMULATION_CARD_ACTIONS_HARMONIZED_REQUIREMENTS.md).

---

## 11. Core Features

Subsection numbers **`9.x`** below are **stable** for cross-references from other markdown files.

### 9.1 User profile (view, edit, completion)

- **View/edit:** Inline section editing on `/profile`; view and edit surfaces stay aligned (same fields). Password visibility toggle on password fields where applicable.
- **Sections:** Personal Information, User Identity Text (bio, career goal, interests), Seniority, Structured User Info (skills, skills in development, key responsibilities, domains + inferred ISCO), documents, career simulation inputs (readout + edit flow).
- **Completion:** Weighted sections feed overall %; **`GET /api/profile/completion`**. Simulation requires **≥ 60%** (see `### 9.4`).
- **Deep requirements:** [PROFILE_USER_IDENTITY_TEXT_SECTION_REQUIREMENTS.md](./PROFILE_USER_IDENTITY_TEXT_SECTION_REQUIREMENTS.md), [PROFILE_USER_IDENTITY_FIELDS_REQUIREMENTS.md](./PROFILE_USER_IDENTITY_FIELDS_REQUIREMENTS.md), [PROFILE_SENIORITY_SECTION_REQUIREMENTS.md](./PROFILE_SENIORITY_SECTION_REQUIREMENTS.md), [PROFILE_SKILLS_IN_DEVELOPMENT_REQUIREMENTS.md](./PROFILE_SKILLS_IN_DEVELOPMENT_REQUIREMENTS.md), [CAREER_PREFERENCES_ISCO_CODES_REQUIREMENTS.md](./CAREER_PREFERENCES_ISCO_CODES_REQUIREMENTS.md), [ESCO_ALT_LABELS_SYNONYMS_REQUIREMENTS.md](./ESCO_ALT_LABELS_SYNONYMS_REQUIREMENTS.md).

### 9.1.13 Editable career simulation inputs

- Field **`careerSimulationInputs`** is computed from the profile (and document enrichment), **editable** by the user, with **`isManuallyEdited`**, recalculation from profile, and conflict handling when recalculation would overwrite manual edits.
- **API:** `PUT /api/profile/career-simulation-inputs` (and related profile endpoints—see `profile.js`).
- **Simulation** uses this object as primary input; matched inputs appear as chips on result cards where implemented.
- **Detail:** [SIMULATION_IMPLEMENTATION_REQUIREMENTS.md](./SIMULATION_IMPLEMENTATION_REQUIREMENTS.md) §1; implementation in profile controllers and `Profile.jsx`.

### 9.2 Registration and profile creation

- **Registration (target):** Account creation requires **only** a valid **email** and **password** (password confirmation on the client is allowed for typo prevention). No personal, professional, preference, or document fields are required at signup. **Normative detail:** [MINIMAL_REGISTRATION_SIGNUP_REQUIREMENTS.md](./MINIMAL_REGISTRATION_SIGNUP_REQUIREMENTS.md). **§1.5.12** summarizes UX intent.
- Email **verification** and **login when verified** follow existing backend/environment rules.
- **Profile creation (separate from signup):** Users add data after registration via **`/profile`** — including optional **PDF CV** upload and extraction, then review/edit of extracted personal, structured, identity, and seniority data. The simulation **completion threshold** (`### 9.4`) applies when starting a run, not at registration.

### 9.3 Documents

- Upload, list, process, delete with **confirmation** before delete — **`/api/documents`** (`src/server/routes/documents.js`, `documentController`); client profile UI calls these endpoints (not nested under `/api/profile`).
- Parsed CV content feeds enrichment of `careerSimulationInputs` per pipeline in [SIMULATION_IMPLEMENTATION_REQUIREMENTS.md](./SIMULATION_IMPLEMENTATION_REQUIREMENTS.md).

### 9.4 Conditions for starting the simulation

- **Threshold:** Minimum **60%** profile completion (`MIN_SIMULATION_PROFILE_COMPLETION_PCT` in controller; mirrored on client).
- **Enforcement:** UI disables or redirects starting simulation when below threshold; **`POST /api/profile/simulation`** returns **403** with completion breakdown if below threshold.
- **Career goal:** Optional; stored on profile (not chosen at run start).

### 9.5 Performing the simulation

- **Client route:** `/simulation` is reachable without logging in; starting a run still depends on the authenticated API (see **§2**, public vs protected UI routes).
- **Trigger:** Primary control on the simulation page uses the **puzzle-piece icon** (e.g. MUI `Extension`) as the start affordance.
- **While running:** Loading/progress UI.
- **Failure:** User-visible error and retry; no requirement here for live “trending” replacement data beyond static fallbacks already in the client.

### 9.6 Simulation implementation details

- **Pipeline:** Hybrid **NEXT_ROLE** / **OUT_OF_THE_BOX** embedding scores (OpenAI `text-embedding-3-large`, 3072-d), seniority penalty, **MMR** and exploration rules, **prioritized lists** generated once per run, **`stepId`** on steps, initial slice (top **3** per category by default) plus sequential replacement from lists. **Numeric parameters (weights, MMR, pool sizes):** canonical [CAREER_MATCHING_ALGORITHM_TECHNICAL_OVERVIEW.md](./CAREER_MATCHING_ALGORITHM_TECHNICAL_OVERVIEW.md). **APIs and results JSON:** [SIMULATION_IMPLEMENTATION_REQUIREMENTS.md](./SIMULATION_IMPLEMENTATION_REQUIREMENTS.md).
- **Document enrichment:** CV merge into inputs; **7-day** cache per implementation.
- **Identity embeddings:** Cached compressed identity text when bio/goal/interests change (`userIdentityEmbeddingTextService.js`).
- **Results shape:** `nextSteps`, `outsideTheBox`, `furtherAdvice`, `prioritizedLists`, `currentPositions`, scores for explainability; **no** raw `roleVectors` / `hybrid_vector` sent to client.
- **Presentation:** Result **cards** (not a literal puzzle-board UI); matched profile inputs shown on cards per [CAREER_STEP_ENRICHED_FIELDS_DISPLAY_REQUIREMENTS.md](./CAREER_STEP_ENRICHED_FIELDS_DISPLAY_REQUIREMENTS.md).
- **Persistence:** Latest run stored server-side; **saved simulations** are separate list entries; client session state for unsaved runs per **§1.5.5**.
#### 9.6.10 Prioritized lists and replacement

- Per-category prioritized lists (length and MMR parameters: [CAREER_MATCHING_ALGORITHM_TECHNICAL_OVERVIEW.md](./CAREER_MATCHING_ALGORITHM_TECHNICAL_OVERVIEW.md)); **cross-category** uniqueness for OOTB vs next; **remove** advances **`currentPositions`**; exhaustion handled in UI with clear messaging.
- **Detail:** [REMOVE_CAREER_STEPS_FEATURE.md](./REMOVE_CAREER_STEPS_FEATURE.md), [SIMULATION_IMPLEMENTATION_REQUIREMENTS.md](./SIMULATION_IMPLEMENTATION_REQUIREMENTS.md) §4.

### 9.7 Simulation algorithm — data and design

#### 9.7.1 Job and career path data

- **Primary source:** ESCO-based occupation documents **in MongoDB**, populated/synced by project scripts—not a mandatory live call to the ESCO HTTP API on each simulation.
- **Optional/future:** Additional labour-market or salary APIs are **not** required for the current production path.

#### 9.7.5 Career matching algorithm (current implementation)

The simulation uses a **two-phase** approach: **hybrid embedding scoring** for candidates, then **diversity-aware prioritized lists**. `algorithmVersion` / `scoringVersion` in stored results are typically **`"2"`**.

- **Phase 1:** Hybrid **NEXT_ROLE** and **OUT_OF_THE_BOX** scores per career path (`careerPathScorer.js`, `roleMatchingScorer.js`); user vectors from `careerSimulationInputs`, optional document enrichment, optional cached LLM identity text (`userIdentityEmbeddingTextService.js`); OpenAI **`text-embedding-3-large`** (3072-d) at runtime where needed.
- **Phase 2:** Prioritized lists (`generatePrioritizedListsPhase2` in `prioritizedListGenerator.js`); initial UI slice top **3** per category; replacement by advancing **`currentPositions`** in stored lists.
- **Path pool:** Skill intersection and fallback caps — [SIMULATION_IMPLEMENTATION_REQUIREMENTS.md](./SIMULATION_IMPLEMENTATION_REQUIREMENTS.md) §2 (`escoService.getCachedCareerPaths`).

**Canonical detail (formulas, weights, MMR λ/k, exploration thresholds, structured sub-weights):** [CAREER_MATCHING_ALGORITHM_TECHNICAL_OVERVIEW.md](./CAREER_MATCHING_ALGORITHM_TECHNICAL_OVERVIEW.md) §2–4. **Module map:** same document §6; **APIs / results shape:** [SIMULATION_IMPLEMENTATION_REQUIREMENTS.md](./SIMULATION_IMPLEMENTATION_REQUIREMENTS.md).

#### 9.7.6 Card actions and feedback

Like / dislike / remove / save behaviors and **duplicate save** rules: [SIMULATION_CARD_ACTIONS_HARMONIZED_REQUIREMENTS.md](./SIMULATION_CARD_ACTIONS_HARMONIZED_REQUIREMENTS.md).

#### 9.7.8 Security and privacy (embeddings)

Embedding calls send **derived** text to the configured provider (e.g. OpenAI). Operators must manage keys, DPA, and retention.

### 9.8 Simulation result details

- **Access:** From each result card, **More** navigates to a **dedicated route** (e.g. `SimulationResultDetails`, `SavedSimulationCareerStepDetails`, `SavedCareerStepDetails`) with **state** and/or **enrichment** from existing APIs—not from separate `GET /api/simulation/results/:id/details` endpoints.
- **Layout parity, skills, alt/hidden titles, seniority blocks:** [CAREER_STEP_DETAILS_CONSISTENCY_REQUIREMENTS.md](./CAREER_STEP_DETAILS_CONSISTENCY_REQUIREMENTS.md).
- **Print:** Where implemented, print uses a **new window** + print styles on the detail components (see client implementations).

### 9.9 Save career step (library)

- **Star** toggles membership in **`savedCareerSteps`**; **`POST /api/profile/saved-career-steps`**, **`DELETE /api/profile/saved-career-steps/:stepId`**, **`GET /api/profile/saved-career-steps`**.
- **Card actions grid / styling:** Behavior and persistence: [SIMULATION_CARD_ACTIONS_HARMONIZED_REQUIREMENTS.md](./SIMULATION_CARD_ACTIONS_HARMONIZED_REQUIREMENTS.md). **Layout, shared `sx`, and visual rules:** canonical [BUTTON_STYLING_CONSISTENCY.md](./BUTTON_STYLING_CONSISTENCY.md).

#### 9.9.3.1 Duplicate prevention (as implemented)

- **`stepId` / save conflicts:** [SIMULATION_IMPLEMENTATION_REQUIREMENTS.md](./SIMULATION_IMPLEMENTATION_REQUIREMENTS.md) §4.1 (**duplicate save** → **409**). **Save (star) UX:** [SIMULATION_CARD_ACTIONS_HARMONIZED_REQUIREMENTS.md](./SIMULATION_CARD_ACTIONS_HARMONIZED_REQUIREMENTS.md) §3.1.

#### 9.9.8 Dynamic career step removal and replacement (as implemented)

##### 9.9.8.1 User story

Removing a step reveals the **next** item from the same category’s **prioritized list** for that simulation run.

##### 9.9.8.2 Core behavior (next steps and outside-the-box)

- **Saved:** **`DELETE /api/profile/simulation-results/:simulationId/career-steps/:stepId`** with body `{ "category": "nextSteps" | "outsideTheBox" }` → `removeCareerStepFromSimulation` in `profileController.js`.
- **Lists:** `results.prioritizedLists.nextCareerRoles` / `outsideTheBoxRoles`; **`currentPositions`** advanced after removal; **`replacementPools`** branch only when category does not map to those list keys.
- **Unsaved:** Client mirrors list + positions; session persistence per **§1.5.5**.

##### 9.9.8.3 API contract

- **DELETE** `/api/profile/simulation-results/:simulationId/career-steps/:stepId` + JSON body with **`category`** as above.
- **Success:** `removedStep`, `replacementStep` (or null), `updatedResults`, `updatedCounts`.

##### 9.9.8.4–9.9.8.7

Unsaved behavior, non-canonical alternate routes, confirmation dialog, and harmonized card actions: [REMOVE_CAREER_STEPS_FEATURE.md](./REMOVE_CAREER_STEPS_FEATURE.md), [SIMULATION_CARD_ACTIONS_HARMONIZED_REQUIREMENTS.md](./SIMULATION_CARD_ACTIONS_HARMONIZED_REQUIREMENTS.md).

### 9.10 Share career step

**As implemented** (`src/server/routes/share.js`, mounted at `/api/share`):

- **Storage:** In-memory **`Map`** (development-oriented; not durable across restarts).
- **Create link:** `POST /api/share/generate-link` (auth) — returns `shareableLink`, optional **QR** data URL, **30-day** expiry.
- **Email:** `POST /api/share/email` (auth) via `emailService.sendShareEmail`.
- **Fetch:** `GET /api/share/shared/:shareId` — public read of payload subject to expiry and privacy flags.
- **Revoke / history:** `DELETE /api/share/revoke/:shareId` (auth); history listing as implemented in router.

**Not required by current code:** OAuth posting to LinkedIn/Twitter, dedicated share-history DB, **third-party / product analytics platform** integration (e.g. Segment, Amplitude, custom warehouse ETL), or a dedicated in-app **saved-simulation analytics** API/UI (no `GET .../simulation-results/:id/analytics` in the profile router as shipped).

### 9.11 Saved career step details page

- **Route:** Client page for a single saved step (e.g. progress/match UI, print affordance where present). **Detail:** component `SavedCareerStepDetails.jsx` and [CAREER_STEP_DETAILS_CONSISTENCY_REQUIREMENTS.md](./CAREER_STEP_DETAILS_CONSISTENCY_REQUIREMENTS.md).

### 9.3.11 Career simulation inputs field

Normative definition, triggers, and UI transparency are covered under **`### 9.1.13`** and [SIMULATION_IMPLEMENTATION_REQUIREMENTS.md](./SIMULATION_IMPLEMENTATION_REQUIREMENTS.md). The heading label **9.3.11** is an **alias** of **9.1.13** for stable cross-references from other markdown files.

---

## 12. Change log

- **2026-04-12:** Added **target** minimal signup requirements ([MINIMAL_REGISTRATION_SIGNUP_REQUIREMENTS.md](./MINIMAL_REGISTRATION_SIGNUP_REQUIREMENTS.md)); updated **`### 9.2`**, **§2** (auth), **§1.5.12**, and **§4** to separate signup from profile creation.
- **Maintenance:** This index is updated when shipped behavior or companion specs change; substantive history of edits lives in **version control** for this file and the linked `*_REQUIREMENTS.md` documents.

---

*End of requirements.*
