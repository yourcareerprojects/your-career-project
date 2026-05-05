# Structured User Info: Domains + Inferred ISCO (As-Built)

## 1. Overview

Career preferences now use **free-form domains**. The system infers likely **ISCO-08** codes from those domains and combines both signals in the user occupation-group vector.

**Normative product context:** `requirements.md` §11 **`### 9.1`** (profile sections) and linked simulation docs.

---

## 2. UI behavior (`Profile.jsx` Structured User Info editor)

- **Section title:** **Domains**.
- **Control:** Free-form chips input for domains.
- **Input label:** **Domains**.
- **Helper text:** Enter domains such as marketing, software engineering, healthcare.
- **Display:** Entered domains + inferred ISCO chips (code + resolved label).

---

## 3. ISCO hierarchy

ISCO-08 hierarchy (major → sub-major → minor → unit) is still used on the **role side** and for **inference labels** on the user side. User input is no longer selected from an ISCO dropdown.

---

## 4. Storage and API

- **Profile field:** `profile.structuredUserInfo.domains` holds an **array of free-form strings**.
- **Persistence:** **`PUT /api/profile/structured-user-info`** accepts `domains` as free-form strings.
- **Inference:** ISCO codes are inferred from domains at runtime (rule-based / LLM fallback).
- **Labels for display:** inferred codes are resolved via `iscoLabels` / `iscoMapping` with hierarchical fallback.

---

## 5. Simulation and `careerSimulationInputs`

- **`careerSimulationInputs.structuredUserInfo.domains`** carries user-entered domains.
- **`userProfileVectorBuilder.js`** builds a hybrid occupation-group user vector:
  - domain embedding (semantic)
  - inferred ISCO embedding (structured)
  - weighted fusion (0.4 domain + 0.6 inferred ISCO)

---

## 6. Technical reference

| Area | Location |
|------|----------|
| Profile form UI | `src/client/components/pages/Profile.jsx` (Structured User Info section) |
| ISCO mapping | `src/server/services/embedding/iscoMapping.js` |
| User vectors | `src/server/services/embedding/userProfileVectorBuilder.js` |
| Routes | `src/server/routes/profile.js` — `structured-user-info` |
| Career path model | `src/server/models/CareerPath.js` — `iscoGroup` |
| Pipeline overview | [SIMULATION_IMPLEMENTATION_REQUIREMENTS.md](./SIMULATION_IMPLEMENTATION_REQUIREMENTS.md) |

---

## 7. Data sources

- **ISCO group labels/codes:** ESCO dataset classification CSV (e.g. `ISCOGroups_en.csv`) and/or embedded maps in **`iscoMapping.js`**, depending on deployment sync.

---

## 8. External reference

- [ILO ISCO-08](https://www.ilo.org/public/english/bureau/stat/isco/isco08/)
