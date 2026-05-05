# Simulation Card Actions — Harmonized Requirements

## 1. Goal

Users interact with simulation career-step cards via:
- **Save** (star)
- **Dislike**
- **Remove**

This document defines a single, consistent (“harmonized”) behavior model so all actions:
- behave predictably across **unsaved** and **saved** simulations
- preserve **deterministic step IDs**
- leverage **prioritized lists** and **indexed retrieval** where the backend stores `SimulationPrioritizedItem` rows

This document is the canonical source of truth for card-action semantics and persistence.

**As-built wiring (reference)**  
Primary UI: **`CareerStepCardWithReplacement.jsx`** on **`Simulation.jsx`** and saved-simulation views. **Remove** and **replace** for saved simulations use the profile routes (**`DELETE /api/profile/simulation-results/...`**, **`POST /api/profile/simulation/.../replace-career-step/...`** — see **`SIMULATION_IMPLEMENTATION_REQUIREMENTS.md`** §7 and **`src/server/routes/profile.js`**). **Save** uses **`/api/profile/saved-career-steps`**. There is **no** `simulation.interactions[]` store and **no** `POST .../interactions` endpoint.

**UI simplification requirement (new)**
- The card UI MUST NOT expose a separate **Like** button.
- The effects previously provided by **Like** are integrated into **Save**.
- The simulation UI MUST NOT expose a **Skip** option (button or menu item). If the user wants “a different one”, they use **Remove**.

## 2. Definitions

### 2.1 Simulation types
- **Unsaved simulation**: a simulation run that exists only in frontend session/local state (`simulationId = "local"` or missing).  
  - Results may be persisted in **sessionStorage** for navigation continuity.
  - Backend does not persist dislike/session-only UI state; **remove** is applied locally against embedded **`prioritizedLists`** / **`currentPositions`**.
- **Saved simulation**: a simulation persisted server-side with a stable `simulationId` (`User.simulationResults[].id`).
  - Prioritized lists are persisted and indexed (see `SimulationPrioritizedItem`).

### 2.2 Identity
- **`stepId` is the canonical identity** of a career step within a simulation/category sequence.
- Backend MUST provide deterministic `stepId` for every step in:
  - `results.nextSteps[]`, `results.outsideTheBox[]`
  - `results.prioritizedLists.{nextCareerRoles,outsideTheBoxRoles}[]`
- Frontend MUST treat `step.stepId` (or fallback `step.id`) as the stable identifier.

### 2.3 Categories and list categories
- **Display categories** (rendered arrays):
  - `nextSteps`
  - `outsideTheBox`
- **Prioritized list categories** (stored/indexed lists):
  - `nextCareerRoles`
  - `outsideTheBoxRoles`
- Mapping:
  - `nextSteps` ↔ `nextCareerRoles`
  - `outsideTheBox` ↔ `outsideTheBoxRoles`

## 3. Harmonized action semantics

### 3.1 Save (star) — “save this step to my library”
**Purpose**
- Persist a career step into `User.savedCareerSteps[]` for later access (or remove it on unsave).

**Behavior**
- **Save** is a toggle:
  - If step is not saved: save it to the user’s library via **`POST /api/profile/saved-career-steps`**.
  - If step is saved: unsave it via **`DELETE /api/profile/saved-career-steps/:stepId`**.
- Saving MUST NOT remove/replace the card (no “next alternative” behavior).

- If step is not saved: create a saved entry using deterministic `stepId` (prefer backend-provided).
- If step is saved: unsave/remove from saved list.
- Duplicate detection rules apply — [`SIMULATION_IMPLEMENTATION_REQUIREMENTS.md`](./SIMULATION_IMPLEMENTATION_REQUIREMENTS.md) §4.1 (`duplicateDetection.js`, **409** on duplicate save).

**UI**
- Toggle state: `Save` → `Saved`.
- Snackbar:
  - success: “Career step saved”
  - already saved: “Already saved”
  - unsaved: “Career step removed from saved list”

### 3.2 Dislike — “less like this” (session-only)
**Purpose**
- Let the user mark a negative preference in the **current browser session** for UX feedback. This does **not** call the server and does **not** change **`prioritizedLists`** order (order is fixed at simulation time).

**Saved and unsaved simulations**
- Local UI state only; snackbar indicates the preference is **on this device only** (as implemented in **`CareerStepCardWithReplacement.jsx`**).

**Does NOT**
- remove/replace the card by default.
- persist to `User` or append to any simulation event log.

**UI**
- Dislike MUST be presented as a full action button in the same action area as **More / Save / Remove** (not an icon-only control).
- **Layout (2×2 grid), dimensions, shared `sx`, icons, and dislike color rules:** canonical [`BUTTON_STYLING_CONSISTENCY.md`](./BUTTON_STYLING_CONSISTENCY.md) §1–§6 — do not restate padding or grid gaps here.
- Dislike MAY be a toggle:
  - default: `"Dislike"` + thumb-down icon
  - active: `"Disliked"` (optional) with a stronger visual state
- Tooltips may describe session-only behavior where applicable.

### 3.3 Remove — “exclude from this simulation”
**Purpose**
- Exclude the current card from this simulation’s results and show the next alternative (if available).

**Behavior**
- Remove MUST:
  - remove the card from the displayed results
  - attempt to replace it with the next alternative from the same prioritized list category

**Saved simulations**
- Remove MUST:
  - advance the cursor (`currentPositions[listCategory]`) and consume from the prioritized list tail
  - preserve deterministic step IDs for all existing items

**Unsaved simulations**
- Local-only behavior:
  - local remove + consume from embedded prioritized list.

**UI**
- The card UI MUST NOT show a standalone Skip button or Skip option.
- Confirmation required (destructive).
- Snackbar:
  - remove success: `Removed "<title>" and replaced with "<replacement>"`
  - exhaustion: “No more alternatives available for this category”

## 4. Persistence rules

### 4.1 What is persisted where
- **Saved step library**: persisted for the user (`savedCareerSteps`), independent of simulation state.
- **Simulation modifications**:
  - Remove: modifies displayed results (and for saved simulations persists updated embedded lists and cursor via **`DELETE .../career-steps/...`**).
  - Save (star): persists saved-step library state only (`savedCareerSteps`).
  - Dislike: session-only; not written to the simulation document.
- **Unsaved simulations**: only session storage persistence for **`results`**; dislike remains client-only unless reflected in **`results`** elsewhere.

### 4.2 Change detection and “Save Changes”
For **saved simulations**:
- Result mutations (remove) MUST be persisted immediately via API.

“Save Changes to Existing Simulations” MUST therefore focus on persisting edits that are not already persisted transactionally by these action endpoints (e.g., bulk edits or deferred edits in a dedicated edit mode).

## 5. Backend API contract (harmonized)

### 5.1 Remove (and replace)
`DELETE /api/profile/simulation-results/:simulationId/career-steps/:stepId`

Body:
```json
{ "category": "nextSteps", "mode": "remove" }
```

Response MUST include:
- `removedStep.stepId`
- `replacementStep.stepId` if replacement exists
- `updatedResults` (or at minimum the changed category array)

## 6. Frontend UI requirements (harmonized)

### 6.1 Button states and messaging
- Save: toggle; no confirmation.
- Dislike: toggle; no confirmation; does not remove/replace the card.
- Remove: confirmation required; removes + replaces (if alternatives remain).

### 6.2 Tooltips (required)
Tooltips MUST be provided for all card action buttons on the simulation results cards. Tooltips MUST:
- appear on **hover** and **keyboard focus**
- be concise (1 sentence)
- reflect the button’s current state (e.g., Save vs Saved, Dislike vs Disliked)
- never imply behaviors that don’t happen (e.g., Save does not remove/replace)
- include an accessible name (`aria-label`) equivalent to the tooltip text

#### 6.2.1 Tooltip copy (card actions)
Use the following exact copy (with placeholders where noted):

- **More**
  - Tooltip: `View details for this role`
- **Save** (not saved)
  - Tooltip: `Save this role to your saved list (marks as interested)`
- **Saved** (already saved)
  - Tooltip: `Saved — click to remove from your saved list`
- **Dislike** (not yet disliked)
  - Tooltip: session-only / on-device wording consistent with implementation (e.g. preference stored on this device only).
- **Disliked** (active state)
  - Tooltip: same session-only framing as above.
- **Remove**
  - Tooltip: `Remove this role from this simulation and show the next alternative`

### 6.2 Consistency rules
- All actions must:
  - use `step.stepId` (fallback to `step.id`) for identity
  - show a snackbar with consistent phrasing
  - update local UI immediately (optimistic UI) when feasible

### 6.3 Local vs saved simulation affordances
- When interacting on an unsaved simulation:
  - Save/Dislike/Remove are allowed
  - The UI MUST indicate which effects are session-only (**Dislike**)
- Saving the simulation persists **`results`** to the server; **Dislike** remains session-only unless product changes.

## 7. Acceptance criteria
- [x] The card UI does not show Like or Skip buttons/options. (`CareerStepCardWithReplacement.jsx` — Save / Dislike / Remove / More only.)
- [x] Save toggles membership in **`savedCareerSteps`** via **`/api/profile/saved-career-steps`**.
- [x] Remove excludes the step and replaces it (if alternatives remain). (`useRemoveCareerStep` / local removal paths; parent updates `simResults`.)
- [x] Deterministic step IDs remain stable across all actions and API calls. (Client uses `step.stepId || step.id`; server generates stable ids per harmonized spec.)
- [x] Save (star) continues to work independently and never corrupts simulation state.

