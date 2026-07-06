# Career Path Exploration Tool — Requirements (As-Built)

This document is the **master product/requirements index** for the **current** React + Express + MongoDB application. It summarizes **shipping** behavior and points to focused `REQUIREMENTS_*.md` companions for feature depth.

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

**Simulation (technical):** [REQUIREMENTS_SIMULATION.md](./REQUIREMENTS_SIMULATION.md) (evaluation §6, card layout §6.8, pipeline, APIs, persistence).

---

## 1. Project overview

### 1.5 Navigation and user experience

#### 1.5.1 Simulation result navigation

**Behavior:** Saved vs unsaved simulation context is distinguished. **Back to Results** returns to the correct list. Session persistence and `location.state` carry payloads between list and detail views. **Implementation:** `Simulation.jsx`, `SimulationResultDetails.jsx`, `App.jsx`.

#### 1.5.2 Unsaved changes navigation guard

**Behavior:** Warns on leave when a simulation has unsaved edits; user can stay, discard, or save (including navigation-guard save aligned with the main save dialog). **Detail:** [REQUIREMENTS_SIMULATION.md](./REQUIREMENTS_SIMULATION.md) §8.3.

#### 1.5.3 Role evaluation pool

**Behavior:** After a run, users rate up to **10** roles per category (Keep / Skip / Dislike), then view a ranked list. **Detail:** [REQUIREMENTS_SIMULATION.md](./REQUIREMENTS_SIMULATION.md) §6–§7.

#### 1.5.4 Profile update recommendation

**Behavior:** Non-blocking profile-update nudge component on `/simulation` (per category). **Detail:** [REQUIREMENTS_PROFILE.md](./REQUIREMENTS_PROFILE.md) §7.

#### 1.5.5 Simulation results persistence (client)

**Behavior:** Clean / modified / saved states; session keys for unsaved runs; navigation guard rules for modified state. **Detail:** [REQUIREMENTS_SIMULATION.md](./REQUIREMENTS_SIMULATION.md) §8.

#### 1.5.6–1.5.7 Profile edit cancel and confirmation

**Detail:** [REQUIREMENTS_PROFILE.md](./REQUIREMENTS_PROFILE.md) §6.

#### 1.5.8–1.5.10 Sort order (legacy)

Work-experience/education/language sort-mode behavior belonged to removed profile sections and is no longer part of the active profile model.

#### 1.5.11 Profile picture

**Detail:** [REQUIREMENTS_PROFILE.md](./REQUIREMENTS_PROFILE.md) §2.

#### 1.5.12 Signup (name, email, password)

**Intent:** Registration collects **name**, **email**, and **password** only; richer profile data is added later on `/profile`. **Detail:** `### 9.2`.

---

## 2. Implemented application scope

- **Client:** React 18 SPA (dev: webpack on port 3001), React Router, MUI, Axios; forms use MUI components with custom validation; main flows under `src/client/components/pages/`.
- **Server:** Express (`server.js`), JSON API under `/api`, static `public/`, uploads at `/uploads` from `src/uploads/`.
- **Data:** MongoDB + Mongoose; ESCO occupation data in DB (sync via `npm run sync:esco`), not a live ESCO HTTP call per simulation.
- **Auth:** Email/password registration and login, JWT (`Authorization: Bearer`), `JWT_SECRET` required at server startup. Signup scope: `### 9.2` (name, email, password on a single screen).
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
| [REQUIREMENTS_SIMULATION.md](./REQUIREMENTS_SIMULATION.md) | **Simulation** — inputs, algorithm, role evaluation (Keep/Skip/Dislike), card layout (§6.8), APIs, persistence, navigation guard |
| [`App.jsx`](./src/client/components/App.jsx) (routing) | Simulation and saved-simulation client routes (see components under `src/client/components/pages/`). |
| [REQUIREMENTS_CAREER_STEP.md](./REQUIREMENTS_CAREER_STEP.md) | **Career step details** — layout, enriched fields, ESCO synonyms, pipeline |
| [REQUIREMENTS_PROFILE.md](./REQUIREMENTS_PROFILE.md) | **Profile page** — sections, domains/ISCO (§4.3), picture, identity, seniority, edit/cancel, simulation nudge |

---

## 5. Save changes to existing saved simulations

Users may edit a **saved** simulation (evaluations, rankings, metadata) and persist with **`PUT /api/profile/simulation-results/:simulationId`**. The server updates embedded `results` (including `evaluationFlow`, `prioritizedLists`, and related fields) without creating a new simulation id.

**Normative detail:** [REQUIREMENTS_SIMULATION.md](./REQUIREMENTS_SIMULATION.md) §8.2.

---

## 11. Core Features

Subsection numbers **`9.x`** below are **stable** for cross-references from other markdown files.

### 9.1 User profile (view, edit, completion)

- **View/edit:** Inline section editing on `/profile`; view and edit surfaces stay aligned (same fields). Password visibility toggle on password fields where applicable.
- **Sections:** Profile header (name, picture), Who are you? (five identity prompts), What are you good at? (structured user info), How experienced are you? (seniority), documents, career simulation inputs (readout + edit flow), login & security (dialog).
- **Completion:** Weighted sections feed overall %; **`GET /api/profile/completion`**. Simulation requires **≥ 60%** (see `### 9.4`).
- **Deep requirements:** [REQUIREMENTS_PROFILE.md](./REQUIREMENTS_PROFILE.md) (domains/ISCO §4.3), [REQUIREMENTS_CAREER_STEP.md](./REQUIREMENTS_CAREER_STEP.md) §4 (ESCO synonyms / role search).

### 9.1.13 Editable career simulation inputs

- Field **`careerSimulationInputs`** is computed from the profile (and document enrichment), **editable** by the user, with **`isManuallyEdited`**, recalculation from profile, and conflict handling when recalculation would overwrite manual edits.
- **API:** `PUT /api/profile/career-simulation-inputs` (and related profile endpoints—see `profile.js`).
- **Simulation** uses this object as primary input; matched inputs appear as chips on result cards where implemented.
- **Detail:** [REQUIREMENTS_SIMULATION.md](./REQUIREMENTS_SIMULATION.md) §2; implementation in profile controllers and `Profile.jsx`.

### 9.2 Registration and profile creation

Account creation collects **credentials only** — **name**, **email**, and **password** — on a single screen. Richer profile data is collected later on `/profile` (and related flows).

| Topic | Rule |
|-------|------|
| Required | **Name** (2–100 characters, trimmed), **email** (format + disposable-domain policy), **password** (API policy); client requires **password confirmation** for typo prevention |
| Not required at signup | Other personal, professional, preference, or document fields — missing optional data must **not** block registration |
| Client | Single screen (`Register.jsx`); no multi-step wizard for profile sections; no `localStorage` (or similar) to carry signup-time profile fields into profile creation |
| Verification | Email verification; login when verified per backend/env rules |

**After registration:** User may use the app with a **minimal profile** until they add data. **Profile completion** and the **simulation gate** (`### 9.4`, ≥ 60%) apply when attempting gated actions — **not** at signup.

**Profile creation (separate from signup):** Users add data via **`/profile`** — optional **PDF CV** upload and extraction, then review/edit of personal, structured, identity, and seniority data. See `### 9.1`, [REQUIREMENTS_PROFILE.md](./REQUIREMENTS_PROFILE.md).

**Implementation:** `Register.jsx`, `POST /api/auth/register` (`authController.register`, `registerNameValidation` in `src/server/routes/auth.js`).

### 9.3 Documents

- Upload, list, process, delete with **confirmation** before delete — **`/api/documents`** (`src/server/routes/documents.js`, `documentController`); client profile UI calls these endpoints (not nested under `/api/profile`).
- Parsed CV content feeds enrichment of `careerSimulationInputs` per pipeline in [REQUIREMENTS_SIMULATION.md](./REQUIREMENTS_SIMULATION.md) §2.

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

- **Pipeline:** Hybrid **NEXT_ROLE** / **OUT_OF_THE_BOX** embedding scores (OpenAI `text-embedding-3-large`, 3072-d), seniority penalty, **MMR** and exploration rules, **prioritized lists** generated once per run, **`stepId`** on steps, initial slice (top **3** per category by default) plus sequential replacement from lists. **Detail:** [REQUIREMENTS_SIMULATION.md](./REQUIREMENTS_SIMULATION.md) §3–4.
- **Document enrichment:** CV merge into inputs; **7-day** cache per implementation.
- **Identity embeddings:** Cached compressed identity text when bio/goal/interests change (`userIdentityEmbeddingTextService.js`).
- **Results shape:** `nextSteps`, `outsideTheBox`, `prioritizedLists`, **`evaluationFlow`**, scores for explainability; **no** raw `roleVectors` / `hybrid_vector` sent to client.
- **Presentation:** **Keep / Skip / Dislike** evaluation per role, then ranked view; enrichment on **detail pages** — [REQUIREMENTS_CAREER_STEP.md](./REQUIREMENTS_CAREER_STEP.md) §3.
- **Persistence:** Latest run stored server-side; **saved simulations** are separate list entries; client session state for unsaved runs per **§1.5.5**.
#### 9.6.10 Prioritized lists and role evaluation

- Per-category prioritized lists feed an evaluation pool of up to **10** roles; users rate each with **Keep / Skip / Dislike**, then open a ranked view (default sort + optional drag reorder).
- **Detail:** [REQUIREMENTS_SIMULATION.md](./REQUIREMENTS_SIMULATION.md) §4, §6.

### 9.7 Simulation algorithm — data and design

#### 9.7.1 Job and career path data

- **Primary source:** ESCO-based occupation documents **in MongoDB**, populated/synced by project scripts—not a mandatory live call to the ESCO HTTP API on each simulation.
- **Optional/future:** Additional labour-market or salary APIs are **not** required for the current production path.

#### 9.7.5 Career matching algorithm (current implementation)

The simulation uses a **two-phase** approach: **hybrid embedding scoring** for candidates, then **diversity-aware prioritized lists**. `algorithmVersion` / `scoringVersion` in stored results are typically **`"2"`**.

- **Phase 1:** Hybrid **NEXT_ROLE** and **OUT_OF_THE_BOX** scores per career path (`careerPathScorer.js`, `roleMatchingScorer.js`); user vectors from `careerSimulationInputs`, optional document enrichment, optional cached LLM identity text (`userIdentityEmbeddingTextService.js`); OpenAI **`text-embedding-3-large`** (3072-d) at runtime where needed.
- **Phase 2:** Prioritized lists (`generatePrioritizedListsPhase2`); initial API slice top **3** per category; client builds **`evaluationFlow`** for up to **10** roles per category.
- **Path pool:** Skill intersection and fallback caps — [REQUIREMENTS_SIMULATION.md](./REQUIREMENTS_SIMULATION.md) §2.2.

**Canonical detail (formulas, weights, MMR, exploration, APIs, results shape):** [REQUIREMENTS_SIMULATION.md](./REQUIREMENTS_SIMULATION.md) §3–5.

#### 9.7.6 Card actions and feedback

Keep / Skip / Dislike / remove / save behaviors and **duplicate save** rules: [REQUIREMENTS_SIMULATION.md](./REQUIREMENTS_SIMULATION.md) §6.

#### 9.7.8 Security and privacy (embeddings)

Embedding calls send **derived** text to the configured provider (e.g. OpenAI). Operators must manage keys, DPA, and retention.

### 9.8 Simulation result details

- **Access:** From each result card, **More** navigates to a **dedicated route** (e.g. `SimulationResultDetails`, `SavedSimulationCareerStepDetails`, `SavedCareerStepDetails`) with **state** and/or **enrichment** from existing APIs—not from separate `GET /api/simulation/results/:id/details` endpoints.
- **Layout parity, skills, alt/hidden titles, seniority blocks:** [REQUIREMENTS_CAREER_STEP.md](./REQUIREMENTS_CAREER_STEP.md).
- **Print:** Where implemented, print uses a **new window** + print styles on the detail components (see client implementations).

### 9.9 Save career step (library)

- **Star** toggles membership in **`savedCareerSteps`**; **`POST /api/profile/saved-career-steps`**, **`DELETE /api/profile/saved-career-steps/:stepId`**, **`GET /api/profile/saved-career-steps`**.
- **Card actions:** Keep / Skip / Dislike evaluation + More / Save to library — [REQUIREMENTS_SIMULATION.md](./REQUIREMENTS_SIMULATION.md) §6 (behavior), §6.8 (layout).

#### 9.9.3.1 Duplicate prevention (as implemented)

- **`stepId` / save conflicts:** [REQUIREMENTS_SIMULATION.md](./REQUIREMENTS_SIMULATION.md) §3.3, §6.5 (**duplicate library save** → **409**).

#### 9.9.8 Role evaluation on saved simulations (as implemented)

- Saved and unsaved runs use the same **`evaluationFlow`** model (`Keep` / `Skip` / `Dislike`, ranking phase, drag reorder).
- Edits persist with **`PUT /api/profile/simulation-results/:simulationId`** (full `results`, including `evaluationFlow`).
- **Legacy:** server **remove/replace** endpoints exist but have no current client UI — [REQUIREMENTS_SIMULATION.md](./REQUIREMENTS_SIMULATION.md) §6.7.

### 9.10 Share career step

**As implemented** (`src/server/routes/share.js`, mounted at `/api/share`):

- **Storage:** In-memory **`Map`** (development-oriented; not durable across restarts).
- **Create link:** `POST /api/share/generate-link` (auth) — returns `shareableLink`, optional **QR** data URL, **30-day** expiry.
- **Email:** `POST /api/share/email` (auth) via `emailService.sendShareEmail`.
- **Fetch:** `GET /api/share/shared/:shareId` — public read of payload subject to expiry and privacy flags.
- **Revoke / history:** `DELETE /api/share/revoke/:shareId` (auth); history listing as implemented in router.

**Not required by current code:** OAuth posting to LinkedIn/Twitter, dedicated share-history DB, **third-party / product analytics platform** integration (e.g. Segment, Amplitude, custom warehouse ETL), or a dedicated in-app **saved-simulation analytics** API/UI (no `GET .../simulation-results/:id/analytics` in the profile router as shipped).

### 9.11 Saved career step details page

- **Route:** Client page for a single saved step (e.g. progress/match UI, print affordance where present). **Detail:** component `SavedCareerStepDetails.jsx` and [REQUIREMENTS_CAREER_STEP.md](./REQUIREMENTS_CAREER_STEP.md).

### 9.3.11 Career simulation inputs field

Normative definition, triggers, and UI transparency are covered under **`### 9.1.13`** and [REQUIREMENTS_SIMULATION.md](./REQUIREMENTS_SIMULATION.md) §2. The heading label **9.3.11** is an **alias** of **9.1.13** for stable cross-references from other markdown files.

---

## 12. Change log

- **2026-07-05:** Consolidated career-step docs into `REQUIREMENTS_CAREER_STEP.md`; merged card button layout into `REQUIREMENTS_SIMULATION.md` §6.8; renamed requirements files to `REQUIREMENTS*.md` naming scheme.
- **2026-07-05:** Aligned simulation docs with **Keep / Skip / Dislike** evaluation flow (`REQUIREMENTS_SIMULATION.md` §6); merged domains/ISCO into `REQUIREMENTS_PROFILE.md` §4.3; simplified career-step companion docs.
- **2026-04-12:** Added minimal signup requirements; updated **`### 9.2`**, **§2** (auth), **§1.5.12**, and **§4** to separate signup from profile creation.
- **Maintenance:** This index is updated when shipped behavior or companion specs change; substantive history of edits lives in **version control** for this file and the linked `REQUIREMENTS_*.md` documents.

---

*End of requirements.*
