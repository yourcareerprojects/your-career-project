# Profile Requirements (As-Built)

Single reference for **`/profile`**: page structure, section fields, edit/cancel behavior, profile picture, and the simulation-page profile-update nudge. Product anchors also live in **`REQUIREMENTS.md` §11** (`### 9.1`).

**Related (outside this doc):** [REQUIREMENTS_SIMULATION.md](./REQUIREMENTS_SIMULATION.md) §8.3 (guarded navigation to `/profile`), [REQUIREMENTS_CAREER_STEP.md](./REQUIREMENTS_CAREER_STEP.md) §4 (ESCO synonyms / role search).

---

## 1. Page overview

| Item | Detail |
|------|--------|
| Route | `/profile` (`Profile.jsx`) |
| Editing | Inline per section or per field; view and edit surfaces show the same fields |
| Completion | Weighted sections → overall % via **`GET /api/profile/completion`**; simulation requires **≥ 60%** (`REQUIREMENTS.md` `### 9.4`) |
| Simulation goal | Career goal comes from the profile / `careerSimulationInputs`, not a pre-run dialog (`POST /api/profile/simulation` with `{}` from `Simulation.jsx`) |

### 1.1 Section order

1. **Profile header** — name, avatar, completion bar  
2. **Who are you?** — five identity prompts  
3. **What are you good at?** — structured user info (skills, skills in development, responsibilities, domains)  
4. **How experienced are you?** — seniority  
5. **Documents**  
6. **Career Simulation Inputs** (readout + edit, when shown)  
7. **Login & Security** — dialog (`LoginSecuritySection`), not an inline section form  

### 1.2 Section boundaries

| Section | Contains | Does **not** contain |
|---------|----------|----------------------|
| Header | Name, profile picture, completion | — |
| Who are you? | Five `USER_IDENTITY_FIELDS` prompts | Skills, seniority, bio UI (legacy server paths may still exist) |
| What are you good at? | Skills, skills in development, key responsibilities, domains | Current employment status, career goal, interests |
| How experienced are you? | Current status, years of experience, highest degree, most senior role level | Date of birth (lives in personal info / header data paths) |
| Personal info (API) | Contact, date of birth | Bio (legacy), profile picture (header UI) |

---

## 2. Profile header & picture

**Components:** `Profile.jsx`, `ProfilePictureEditor.jsx`  
**API:** `PUT` / `DELETE` **`/api/profile/profile-picture`**; files under `uploads/profile-pictures`.

### 2.1 Display

- Circular **96×96** avatar next to the user name; initial or `PersonIcon` when empty  
- Hover affordance (“Add photo” / “Edit photo”); keyboard accessible  
- Cache-busting query (`?v=` / `profilePictureKey`) so uploads show without full page reload  

### 2.2 Add / edit / delete

- Click avatar or label → **`ProfilePictureEditor`** modal (“Edit Profile Picture”)  
- **Formats:** JPEG, PNG, GIF, WebP; **max 5 MB**; validate before load  
- **Crop:** client-side square (1:1) via `react-easy-crop`; zoom (slider, ~1–4×), pan; circular preview  
- **Save:** crop → JPEG blob → multipart upload; progress + success/error feedback; replace deletes previous server file  
- **Delete:** confirmation dialog; server removes file; avatar reverts to initial/icon  
- **Cancel** in editor discards unsaved crop changes (no profile PUT)  

### 2.3 Acceptance

- [x] Add, edit, crop, zoom, pan, preview, save, delete with confirmation  
- [x] Client-side crop/optimize; old files removed on replace/delete  
- [x] Responsive MUI dialog; accessible focus management  

---

## 3. Who are you? (user identity)

**Components:** `Profile.jsx`, `ProfileIdentityFieldEditor.jsx`, `ProfileIdentityCoachingEditor.jsx`, `ProfileSectionViewCarousel.jsx`, `ProfileBulletList.jsx`  
**Config:** `USER_IDENTITY_FIELDS` (`userIdentityFields.js`)  
**API:** **`PUT /api/profile/user-identity`** (`buildUserIdentitySavePayload` per changed field)

### 3.1 Section

- **Title:** “Who are you?” (`profilePage.sections.identity`)  
- **Purpose:** Answers feed user identity text, narrative generation, and hybrid matching  
- **Edit flow:** **Per-field** Edit / Save / Cancel (not one section-level form)  
- **Modes:** Manual bullet editing or optional coaching chat per field; coaching may return a `structuredPatch` for structured user info  

### 3.2 Fields

| Key | Storage (`profile.userIdentityAnswers.*`) |
|-----|-------------------------------------------|
| `workEnjoyMost` | `.workEnjoyMost` |
| `topicsIndustriesInterest` | `.topicsIndustriesInterest` |
| `naturallyGoodAt` | `.naturallyGoodAt` |
| `workEnvironmentFit` | `.workEnvironmentFit` |
| `workingLifeAchievement` | `.workingLifeAchievement` |

Questions use i18n keys under `identityQuestions.*`.

### 3.3 Completion & legacy data

- Identity contributes **one third** of profile completion (with seniority and structured user info) in `computeProfileCompletion`.  
- **Legacy (server only):** `bio`, `interests`, `careerGoal` / `careerGoalEscoId` may still exist for old data and simulation fallbacks; they are **not** the current profile UI. Simulation resolves goal from `careerSimulationInputs` → `profile.careerGoal` → optional request body.

### 3.4 Acceptance

- [x] All five prompts on `/profile`; manual and coaching edit paths  
- [x] Persisted to `userIdentityAnswers`; not duplicated in other sections  
- [x] Per-field Save / Cancel from `Profile.jsx`  

---

## 4. What are you good at? (structured user info)

**Component:** structured editor in `Profile.jsx`  
**API:** **`PUT /api/profile/structured-user-info`**

### 4.1 Fields

Skills (with level / verified), key responsibilities, domains, and **Skills in Development** (see §4.2). Does **not** include current employment status.

### 4.2 Skills in Development

| Aspect | Requirement |
|--------|-------------|
| Label | “Skills in Development” |
| Storage | `profile.structuredUserInfo.skillsInDevelopment` (`string[]`, trimmed, non-empty) |
| UI | Chip pattern: type skill → Enter / Add → delete chip; optional helper text |
| vs main skills | Main skills: `{ name, level, verified }`, work-experience sync; learning skills: plain strings, outlined/secondary chips |
| CSI | Included in `careerSimulationInputs.structuredUserInfo.skillsInDevelopment` when inputs are recalculated |

### 4.3 Domains & inferred ISCO

Free-form **domains** replace an ISCO dropdown in the Structured User Info editor.

| Topic | Implementation |
|-------|----------------|
| UI | Chips input; label **Domains**; helper e.g. “marketing, software engineering, healthcare” |
| Storage | `profile.structuredUserInfo.domains` (`string[]`) via **`PUT /api/profile/structured-user-info`** |
| Display | Entered domains + inferred ISCO chips (code + resolved label) |
| Inference | ISCO-08 codes inferred from domains at runtime (rule-based / LLM fallback); labels via `iscoMapping.js` |
| Simulation | `careerSimulationInputs.structuredUserInfo.domains`; `userProfileVectorBuilder.js` fuses domain embedding (0.4) + inferred ISCO embedding (0.6) for occupation-group vector |
| Role side | `CareerPath.iscoGroup` still uses ISCO hierarchy for roles |

**Reference:** [ILO ISCO-08](https://www.ilo.org/public/english/bureau/stat/isco/isco08/)

### 4.4 Acceptance

- [x] Section on profile with chip UX for skills in development  
- [x] Stored and shown when non-empty; flows into career simulation inputs  

---

## 5. How experienced are you? (seniority)

**Component:** `SeniorityForm.jsx`  
**API:** **`PUT /api/profile/seniority`**

### 5.1 Fields

| Field | Storage | Required | Options (summary) |
|-------|---------|----------|-------------------|
| Current status | `profile.seniority.currentStatus` | Yes | employed, unemployed, student, self-employed, other |
| Years of work experience | `profile.seniority.yearsOfExperience` | No | 0–50 (integer) |
| Highest educational degree | `profile.seniority.highestDegree` | No | none, high_school, associate, bachelors, masters, phd, professional |
| Most senior work experience | `profile.seniority.mostSeniorWorkExperience` | No | intern → c_suite (display labels: Intern … C-Suite) |

**Date of birth** is **not** in this section; it is personal info (`profile.personalInfo.dateOfBirth`) for display only.

### 5.2 Completion & matching

- Seniority contributes **5%** to overall completion (four fields above).  
- **`inferUserSeniorityLevel`** uses seniority fields + work-experience title fallback; **must not** use age / date of birth.  

### 5.3 Acceptance

- [x] Four dropdown fields; edit/save/cancel consistent with other section forms  
- [x] No duplicate current status in structured user info  
- [x] Completion and scoring use seniority fields as specified  

---

## 6. Edit, save, and cancel (shared behavior)

Applies to **section forms** (e.g. `SeniorityForm`, structured user info). **Per-field identity editors** cancel immediately (no discard dialog).

### 6.1 Save / Cancel layout

- Buttons right-aligned: **Cancel** (outlined, `secondary`) left of **Save** (contained, `primary`, label e.g. “Save Seniority”)  
- Responsive layout; touch targets ≥ 44px  
- Forms accept **`onCancel`** from `Profile.jsx`; parent clears `editSection` / errors after local reset  

### 6.2 Cancel behavior

| Case | Behavior |
|------|----------|
| No unsaved changes | Cancel exits edit mode immediately; no API call |
| Unsaved changes | MUI **Discard Changes?** dialog before discarding |
| On confirm discard | Restore snapshot from edit start; clear validation errors; call `onCancel()` |
| During save / errors | Cancel stays available; does not trigger error toasts |

### 6.3 Discard dialog (section forms)

- **Title:** “Discard Changes?”  
- **Body:** “Are you sure you want to discard your changes? All unsaved modifications will be lost and cannot be recovered.”  
- **Keep Editing** (outlined, primary) — also backdrop click / Escape via `onClose`  
- **Discard Changes** (contained, error) — reset form + `onCancel`  
- Change detection: deep compare of form data vs snapshot when Cancel is clicked (`SeniorityForm` pattern)  

### 6.4 Acceptance

- [x] Cancel + Save on wired section forms  
- [x] Discard dialog only when dirty (section forms)  
- [x] Identity field editors: immediate cancel without dialog  

---

## 7. Profile update recommendation (simulation page)

Not on `/profile`; **`ProfileUpdateRecommendation.jsx`** is rendered per category on **`/simulation`** (`Simulation.jsx`).

**Related:** [REQUIREMENTS_SIMULATION.md](./REQUIREMENTS_SIMULATION.md) §7.

| Aspect | Behavior |
|--------|----------|
| UI | MUI info `Alert`; dismissible; non-blocking; category-specific copy from `getCategoryGuidance` |
| Visibility | Controlled by `showProfileRecommendation` + `recommendationCategory` in `Simulation.jsx` |
| Content | Completion bar from `calculateProfileCompletion()` / **`GET /api/profile/completion`** when shown |
| CTA | **Update Profile** → `guardedNavigate('/profile')` |

**Note:** Automatic trigger via per-category display-cap removal is **legacy**; the component is mounted but `handleShowProfileRecommendation` is not called from the current evaluation UI.

### 7.1 Acceptance

- [x] Component dismissible; cleared on unmount; **Update Profile** uses guarded navigation when simulation is modified

---

## 8. Implementation map

| Area | Primary files |
|------|----------------|
| Profile page | `src/client/components/pages/Profile.jsx` |
| Seniority | `src/client/components/profile/SeniorityForm.jsx` |
| Picture | `src/client/components/profile/ProfilePictureEditor.jsx` |
| Identity editors | `ProfileIdentityFieldEditor.jsx`, `ProfileIdentityCoachingEditor.jsx` |
| Login & security | `LoginSecuritySection.jsx` |
| User model | `src/server/models/User.js` |
| Profile API | `src/server/routes/profile.js`, `profileController.js` |
| Completion | `GET /api/profile/completion` |
| Simulation nudge | `ProfileUpdateRecommendation.jsx`, `Simulation.jsx` |

---

## 9. Consolidated acceptance checklist

### Profile page
- [x] Section order and boundaries per §1  
- [x] Weighted completion; simulation gate at 60%  

### Picture
- [x] §2 criteria met  

### Identity
- [x] §3 criteria met  

### Structured user info
- [x] §4 criteria met (including skills in development)  

### Seniority
- [x] §5 criteria met  

### Edit/cancel
- [x] §6 criteria met  

### Simulation nudge
- [x] §7 criteria met  
