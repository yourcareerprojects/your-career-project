# Profile User Identity Fields Requirements

As-built specification for the inputs that feed **user identity text** and hybrid matching: **Bio**, **Interests**, and **Career goal** are edited in the **User Identity Text** profile section. New simulations take the career goal from the profile (and related computed inputs), not from a pre-run dialog.

See [PROFILE_USER_IDENTITY_TEXT_SECTION_REQUIREMENTS.md](./PROFILE_USER_IDENTITY_TEXT_SECTION_REQUIREMENTS.md) for layout and [requirements.md](./requirements.md) **§11** for product-level anchors.

---

## 1. Field requirements

### 1.1 Bio

- **Location**: User Identity Text section of the profile (not Personal Information).
- **Type**: Short text (multiline, ~4 rows)
- **Purpose**: Self-description, aspirations, narrative for identity embedding text
- **Behavior**: Optional; helper text: “Tell us a bit about yourself”
- **Storage**: `profile.personalInfo.bio`

### 1.2 Interests

- **Location**: User Identity Text section (not Structured User Info).
- **Type**: Multi-value (chips/tags)
- **Purpose**: Domains or areas the user cares about (e.g. sustainability, AI, healthcare)
- **Behavior**: Optional; helper text: “Add domains or areas you're passionate about”
- **Storage**: `profile.careerPreferences.interests` (or equivalent profile path used by the API)
- **Integration**: Included in `careerSimulationInputs` and scoring / hybrid vector building

### 1.3 Career goal

- **Location**: User Identity Text section (not Structured User Info).
- **Type**: Searchable ESCO-style occupation control (same patterns as elsewhere in the app)
- **Purpose**: Target role or direction for simulations
- **Behavior**:
  - Optional
  - Search-as-you-type with suggestions; optional free-text when no canonical selection
  - When a suggestion is chosen, store display title and `escoId` as applicable
  - **Simulation page**: “Start Simulation” does **not** open a career-goal dialog; the client calls `POST /api/profile/simulation` with an empty JSON body (`{}` in `Simulation.jsx`)
- **Storage**:
  - `profile.careerGoal` (string title)
  - `profile.careerGoalEscoId` (optional)
- **Saved simulations**: Continue to store `careerGoal` on the simulation record for historical context (snapshot at save time)

### 1.4 Profile section placement

The **User Identity Text** card groups Bio, Career Goal, and Interests. Personal Information excludes bio; Structured User Info excludes career goal and interests (see identity text and structured user info docs).

### 1.5 `careerSimulationInputs`

- **`userIdentity.careerGoal`**: Reflects profile (and manual CSI edits per existing rules)
- **`userIdentity.interests`**: From profile identity paths as implemented
- Recompute when profile or CSI update paths run (existing backend behavior)

---

## 2. Simulation flow (as-built)

1. User clicks **Start Simulation** on `/simulation`.
2. Client sends `POST /api/profile/simulation` with **`{}`** (no career goal in the body).
3. Server `runSimulation` resolves career goal in order: non-empty **`careerSimulationInputs.userIdentity.careerGoal`**, else **`profile.careerGoal`**, else optional **`req.body.careerGoal`** (request override when provided).
4. Response includes `careerGoal` and `results`; the UI shows the goal from the response and stores it with session metadata as today.
5. Saved simulations keep their stored `careerGoal` for display and history.

### 2.1 Display on results

- **New run**: Show the goal returned by the API (profile-driven).
- **Saved simulation**: Prefer metadata stored on the simulation when viewing that saved run.

---

## 3. Acceptance criteria

### 3.1 Bio

- [x] Editable in User Identity Text (not in Personal Information)
- [x] Stored at `profile.personalInfo.bio`
- [x] Used in user identity text / embeddings pipeline

### 3.2 Interests

- [x] Captured in User Identity Text section
- [x] Multiple values supported
- [x] Stored on profile and included in simulation inputs / scoring

### 3.3 Career goal

- [x] Editable in User Identity Text (ESCO-style control)
- [x] Stored as `profile.careerGoal` / `profile.careerGoalEscoId`
- [x] No career goal dialog on simulation start; `POST` body empty from main simulation page
- [x] Server uses profile / CSI (and optional body fallback) as implemented in `runSimulation`
- [x] Saved simulations retain `careerGoal` in metadata
- [x] Goal shown on results when present

### 3.4 Documentation

- [x] `requirements.md` and cross-links describe profile-based identity (see §11)
- [x] This file and identity text section doc aligned with shipped behavior

---

## 4. Technical reference

### 4.1 User model / API

- Profile GET/PUT paths expose `careerGoal`, `careerGoalEscoId`, `interests`, and `bio` as implemented (`personal-info`, `user-identity`, etc.).

### 4.2 Simulation API

- **Primary behavior**: Read goal from enriched simulation inputs and profile inside `runSimulation` (`profileController.js`).
- **Optional**: `req.body.careerGoal` remains a last-resort fallback in code; the standard client does not send it for a normal start.

### 4.3 Frontend

- User Identity Text form / section on `Profile.jsx` (and related components).
- `Simulation.jsx`: `handleSimulate` → `fetch('/api/profile/simulation', { body: JSON.stringify({}) })`; uses `data.careerGoal` from the response.

---

## 5. References

- **User Identity Text UI**: [PROFILE_USER_IDENTITY_TEXT_SECTION_REQUIREMENTS.md](./PROFILE_USER_IDENTITY_TEXT_SECTION_REQUIREMENTS.md)
- **User Identity Vector**: `requirements.md` § **11**, subsection **9.7.5**
- **Career simulation inputs**: `requirements.md` § **11**, subsection **9.3.11**
- **ESCO synonyms**: [ESCO_ALT_LABELS_SYNONYMS_REQUIREMENTS.md](./ESCO_ALT_LABELS_SYNONYMS_REQUIREMENTS.md)
