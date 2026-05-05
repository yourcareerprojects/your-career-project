# Minimal registration (signup) requirements

**Status:** Target product requirements — defines the intended signup experience after simplification. Until the client is updated, behavior may still reflect the legacy multi-step registration UI.

**Master index:** [requirements.md](./requirements.md) §11 `### 9.2`, §2 (auth), §1.5.12.

---

## 1. Purpose

Reduce friction at account creation: a new user must be able to **open an account using only an email address and a password**. All other personal, professional, and preference data is **optional at signup** and is collected later through **profile** flows (`### 9.1`, profile creation / edit).

---

## 2. Signup scope (normative)

### 2.1 Required inputs

- **Email** — Unique account identifier; must satisfy the same validation rules as today (format, allowed/disposable domain policy, etc.).
- **Password** — Meets existing password policy enforced by the API.

### 2.2 Not required at signup

- No personal fields (e.g. name, location).
- No professional fields (e.g. career status, experience, skills).
- No career preferences or documents.

The registration API must **not** require these fields for a successful account creation. If optional fields are sent, the server may ignore them for signup or persist them only when explicitly supported — **normative** requirement is that **missing optional data does not block registration**.

### 2.3 Client experience

- **Single focused screen** (or equivalent): email, password, and **password confirmation** only as needed for entry validation (confirmation is a client UX guard, not a separate credential).
- **No multi-step wizard** for personal or professional information during signup.
- After success, the user is signed in (or directed through verification) per existing auth rules — **no dependency** on `localStorage` or other client buffers to “carry” signup-time profile fields into profile creation.

### 2.4 Email verification and login

- **Unchanged in intent** from current product: verification and “login only when verified” follow the existing backend and environment rules (see [requirements.md](./requirements.md) §2, `### 9.2` summary).

---

## 3. After registration

- The user may use the app with a **minimal profile** until they choose to add data.
- **Profile completion** and the **simulation gate** (e.g. ≥ 60% completion, `### 9.4`) apply **after** signup when the user attempts gated actions — they are **not** part of registration.
- Optional **profile creation** paths (e.g. CV upload and extraction, manual section edit) remain the place where rich data is first captured — see [requirements.md](./requirements.md) `### 9.1`, `### 9.3`.

---

## 4. Consistency with other requirements

- **§9.1 (profile):** Remains the canonical place for section-level fields and completion weighting.
- **§9.4 (simulation threshold):** Unchanged; applies only when starting a simulation, not at signup.

---

*End of document.*
