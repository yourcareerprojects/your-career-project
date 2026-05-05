# Profile: Skills in Development Requirements

## 1. Overview (as-built)

Users can record **skills they are actively learning** separately from established **Skills**, in **Structured User Info** on **`Profile.jsx`**. Storage: **`profile.structuredUserInfo.skillsInDevelopment`** (`string[]`). Values flow into **`careerSimulationInputs.structuredUserInfo.skillsInDevelopment`** when inputs are recalculated.

## 2. Requirements

### 2.1 Placement
- **Section**: Structured User Info
- **Label**: “Skills in Development”

### 2.2 Behavior
- Chip pattern: type skill, Enter / Add, remove via chip delete
- Optional helper text explaining learning-in-progress intent

### 2.3 Data model
- **Path**: `profile.structuredUserInfo.skillsInDevelopment`
- **Type**: `string[]`; trim; non-empty segments only
- **Optional**: defaults to `[]`

### 2.4 UI
| Aspect | Requirement |
|--------|-------------|
| Input | Text field + Add (mirror Skills ergonomics) |
| Chips | Name only (no level / verified) |
| Distinction | Secondary / outlined chips vs main skills where styled |

### 2.5 Differences from main Skills

| Aspect | Main Skills | Skills in Development |
|--------|-------------|------------------------|
| Structure | `{ name, level, verified }` | string |
| Work-experience sync | Yes | No |
| Use in CSI | Yes | Yes (`structuredUserInfo.skillsInDevelopment` array) |

### 2.6 API
- Persisted via **`PUT /api/profile/structured-user-info`**.

## 3. Acceptance criteria

- [x] Field in Structured User Info with chip UX
- [x] Stored at `profile.structuredUserInfo.skillsInDevelopment`
- [x] Included in `careerSimulationInputs` when CSI is computed
- [x] Shown on profile view when non-empty

## 4. References

- `requirements.md` § **11** Core Features (profile / simulation inputs)
- [PROFILE_SENIORITY_SECTION_REQUIREMENTS.md](./PROFILE_SENIORITY_SECTION_REQUIREMENTS.md) (section boundaries)
