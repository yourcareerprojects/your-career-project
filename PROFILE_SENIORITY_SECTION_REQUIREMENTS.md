# Profile: Seniority Section Requirements

## 1. Overview (as-built)

The profile includes a **Seniority** section (after **User Identity Text**, before **Structured User Info**) implemented in **`SeniorityForm.jsx`**. It groups **Current status**, **Years of work experience**, **Highest educational degree**, and **Most senior work experience** for matching and completion. **Date of birth / age** stays in **Personal Information** only and is not part of Seniority (see §2.9).

## 2. Requirements

### 2.1 New Section: Seniority

- **Section Title**: "Seniority"
- **Purpose**: Group fields that express the user's career stage, experience level, and educational attainment for career matching and recommendations
- **Placement**: Add as a distinct section on the profile page. Recommended order: after User Identity Text, before Structured User Info
- **Visual Treatment**: Same card/paper styling as other profile sections (e.g., Personal Information, User Identity Text)
- **Edit Flow**: Section has its own Edit/Save/Cancel flow, consistent with other profile sections

### 2.2 Fields in Seniority Section

| Field | Type | Storage | Behavior |
|-------|------|---------|----------|
| **Current Status** | Dropdown | `profile.seniority.currentStatus` | Required; options: employed, unemployed, student, self-employed, other |
| **Years of Work Experience** | Dropdown (numbers) | `profile.seniority.yearsOfExperience` | Optional; numeric options: 0, 1, 2, 3, … up to 50 (or configurable max) |
| **Highest Educational Degree** | Dropdown | `profile.seniority.highestDegree` | Optional; options: None, High school, Associate, Bachelor's, Master's, PhD, Professional degree |
| **Most Senior Work Experience** | Dropdown | `profile.seniority.mostSeniorWorkExperience` | Optional; options: Intern, Entry-level, Mid-level, Senior, Lead, Manager, Director, VP, C-Suite |

**Date of Birth / Age** is not in the Seniority section. It belongs in Personal Information (see §2.4).

### 2.3 Field Definitions

#### 2.3.1 Years of Work Experience
- **UI**: Dropdown with numeric options (0, 1, 2, 3, 4, 5, …, 50)
- **Storage**: `profile.seniority.yearsOfExperience` (Number)
- **Validation**: Optional; if provided, must be non-negative integer within range
- **Note**: May differ from calculated years based on work experience entries; user can override

#### 2.3.2 Highest Educational Degree
- **UI**: Dropdown with predefined options
- **Storage**: `profile.seniority.highestDegree` (String)
- **Options**: None, High school, Associate, Bachelor's, Master's, PhD, Professional degree
- **Validation**: Optional; if provided, must be one of the enum values
- **Note**: Can be derived from education entries for display, but explicit selection allows user override and faster profile completion

#### 2.3.3 Most Senior Work Experience
- **UI**: Dropdown with predefined seniority levels
- **Options**: Intern, Entry-level, Mid-level, Senior, Lead, Manager, Director, VP, C-Suite
- **Storage**: `profile.seniority.mostSeniorWorkExperience` (String)
- **Validation**: Optional; if provided, must be one of the enum values

### 2.4 Section boundaries

- **Personal Information**: Identity and contact fields, **date of birth** (age for display), **profile picture**. **Bio** is **not** here — it lives only under **User Identity Text** (see [PROFILE_USER_IDENTITY_TEXT_SECTION_REQUIREMENTS.md](./PROFILE_USER_IDENTITY_TEXT_SECTION_REQUIREMENTS.md)).
- **Seniority**: Current status, years of experience, highest degree, most senior role level (see §2.2).
- **Structured User Info**: Skills, skills in development, key responsibilities, domains — **not** current employment status (that is in Seniority).

### 2.5 Data Storage

- **Date of Birth**: `profile.personalInfo.dateOfBirth` (stored in Personal Information; not part of Seniority section)
- **Current Status**: `profile.seniority.currentStatus`
- **Years of Work Experience**: `profile.seniority.yearsOfExperience`
- **Highest Educational Degree**: `profile.seniority.highestDegree`
- **Most Senior Work Experience**: `profile.seniority.mostSeniorWorkExperience`

### 2.6 Schema Updates

Seniority schema in User model:
```javascript
highestDegree: {
  type: String,
  enum: ['', 'none', 'high_school', 'associate', 'bachelors', 'masters', 'phd', 'professional'],
  default: ''
},
mostSeniorWorkExperience: {
  type: String,
  enum: ['', 'intern', 'entry_level', 'mid_level', 'senior', 'lead', 'manager', 'director', 'vp', 'c_suite'],
  default: ''
}
```

Display labels: Intern, Entry-level, Mid-level, Senior, Lead, Manager, Director, VP, C-Suite. Backend stores enum values; frontend maps to/from display labels.

### 2.7 Profile Completion

- **Seniority** contributes **5%** to overall profile completion.
- **Fields for completion**: currentStatus, yearsOfExperience, highestDegree, mostSeniorWorkExperience. (Date of Birth is not in Seniority; it contributes to Personal Information completion.)
- **Personal Information**: Includes dateOfBirth in its completion count.
- **Structured User Info**: `currentStatus` is not part of this section and does not contribute there.
- **Other sections** are adjusted proportionally to accommodate the 5% Seniority weight (see requirements.md Profile Completion).

### 2.8 API and Backend

- **Option A**: Create dedicated `PUT /api/profile/seniority` endpoint that accepts `{ currentStatus, yearsOfExperience, highestDegree, mostSeniorWorkExperience }` and updates the relevant profile paths in one call. (Date of Birth is updated via Personal Information endpoint.)
- **Option B**: Use existing endpoints (professional-info for seniority fields) with multiple API calls on save.
- **Recommendation**: Option A for consistency with User Identity Text section and simpler frontend logic.

### 2.9 Career Matching: Seniority Inference

- **Age (dateOfBirth) must NOT contribute** to the user seniority level used for career matching.
- The seniority sub-vector and `inferUserSeniorityLevel` must use only: `mostSeniorWorkExperience`, `yearsOfExperience`, `highestDegree`, `currentStatus`, and (as fallback) work experience title analysis.
- `dateOfBirth` / age is excluded from seniority inference inputs. It remains a Personal Information field for display and other purposes only.

## 3. Acceptance criteria

- [x] **Seniority** section on the profile page with the four fields in §2.2 (no date of birth)
- [x] **Date of birth** only under Personal Information
- [x] **Current status** not duplicated in Structured User Info
- [x] Dropdowns and validation as specified in §2.2 / §2.3
- [x] Persist via **`PUT /api/profile/seniority`** (and profile load paths)
- [x] Edit / Save / Cancel consistent with other sections
- [x] Profile completion reflects Seniority fields per server rules

## 4. Technical implementation (as-built)

### 4.1 Frontend

- **`SeniorityForm.jsx`**: four fields + discard dialog pattern aligned with other profile forms
- **`Profile.jsx`**: `editSection === 'seniority'` and save/cancel wiring
- **`PersonalInfoForm`**: date of birth only here; no bio (bio in User Identity Text)
- **Structured User Info editor (`Profile.jsx`)**: does not include **Current status** (that belongs to Seniority only)

### 4.2 Section order (reference)

1. Personal Information  
2. User Identity Text  
3. **Seniority**  
4. Structured User Info  
5. Documents  
6. Career Simulation Inputs (if displayed)

### 4.3 Career simulation inputs & inference

- **`calculateCareerSimulationInputs`** / vector builders use the seniority-related profile fields as implemented in code paths for scoring and CSI.
- **`inferUserSeniorityLevel`**: must **not** use `dateOfBirth` / age; uses mostSeniorWorkExperience, yearsOfExperience, highestDegree, currentStatus, and work-experience title fallback (see §2.9).

## 5. References

- [PROFILE_USER_IDENTITY_TEXT_SECTION_REQUIREMENTS.md](./PROFILE_USER_IDENTITY_TEXT_SECTION_REQUIREMENTS.md) – Similar section pattern
- requirements.md § Profile: User Profile, § Profile Completion
- requirements.md **§11 Core Features**; field layout reflected in profile components and `User` model
