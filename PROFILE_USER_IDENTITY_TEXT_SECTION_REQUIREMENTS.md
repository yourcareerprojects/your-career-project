# Profile: User Identity Text Section UI Requirements

## 1. Overview

The profile page includes a dedicated **User Identity Text** section that groups **Bio**, **Career Goal**, and **Interests**—the three inputs that drive user identity text and hybrid matching. Product-level behavior and citations live in **`requirements.md` §11** (Core Features); this file is the **UI and storage contract** for that section.

---

## 2. Scope

- **In scope**: Section title, placement, edit/save/cancel pattern, field types, and which profile API fields the section reads and writes.
- **Out of scope here**: Duplicate narrative of every simulation rule—see [PROFILE_USER_IDENTITY_FIELDS_REQUIREMENTS.md](./PROFILE_USER_IDENTITY_FIELDS_REQUIREMENTS.md) and §11 for simulation and `careerSimulationInputs` behavior.

---

## 3. Requirements

### 3.1 Section: User Identity Text

- **Title**: “User Identity Text”
- **Purpose**: Single place for the three identity inputs used in hybrid vector matching
- **Placement**: Distinct section on the profile page (recommended order: after Personal Information, before Seniority—match `Profile.jsx`)
- **Visual treatment**: Same card/paper pattern as other profile sections
- **Edit flow**: Section-level Edit / Save / Cancel consistent with other sections

### 3.2 Fields

| Field | Type | Storage | Behavior |
|-------|------|---------|----------|
| **Bio** | Multiline short text | `profile.personalInfo.bio` | Optional; helper: “Tell us a bit about yourself” |
| **Career Goal** | Searchable occupation control | `profile.careerGoal`, `profile.careerGoalEscoId` | Optional; ESCO-style search; stores title + id when selected |
| **Interests** | Chips / tags | `profile.careerPreferences.interests` | Optional; free-text tags |

### 3.3 Boundaries with other sections

- **Personal Information**: Does **not** include bio (bio lives only under User Identity Text).
- **Structured User Info**: Holds skills, skills in development, key responsibilities, and ISCO industry sectors; it does not store career goal or interests (see [CAREER_PREFERENCES_ISCO_CODES_REQUIREMENTS.md](./CAREER_PREFERENCES_ISCO_CODES_REQUIREMENTS.md) for ISCO code semantics).

### 3.4 Data storage

Paths are unchanged from the original profile model: bio under `personalInfo`, career goal at top-level profile fields, interests under `careerPreferences`.

### 3.5 Profile completion

User Identity Text may be weighted in completion as implemented in `computeProfileCompletion`—do not change weights in this doc; update server completion logic if product rules change.

### 3.6 API

The profile page saves this section with **`PUT /api/profile/user-identity`** (bio, career goal, esco id, interests in one request), as wired from `Profile.jsx` / `UserIdentityTextForm.jsx`. Individual updates via `personal-info` / `career-preferences` remain valid for other flows.

---

## 4. Acceptance criteria

- [x] “User Identity Text” section exists on the profile page
- [x] Section contains Bio, Career Goal, and Interests
- [x] Bio is not duplicated in Personal Information
- [x] Career Goal and Interests are not duplicated in Structured User Info
- [x] Same field behaviors as specified (multiline bio, occupation search, interest chips)
- [x] Data persists to the documented storage paths
- [x] Edit / Save / Cancel consistent with other sections

---

## 5. Technical notes

- **Components**: `UserIdentityTextForm.jsx` (or equivalent) and `Profile.jsx` section wiring
- **Suggested section order** (reference): Personal Information → **User Identity Text** → Seniority → Structured User Info → Documents → Career Simulation Inputs (if shown)

---

## 6. References

- [PROFILE_USER_IDENTITY_FIELDS_REQUIREMENTS.md](./PROFILE_USER_IDENTITY_FIELDS_REQUIREMENTS.md) — Field definitions and simulation alignment
- `requirements.md` § **11** — Core Features (identity, simulation inputs, citations)
