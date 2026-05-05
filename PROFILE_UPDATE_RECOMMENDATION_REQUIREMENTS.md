# Profile Update Recommendation Requirements (As-Built)

## 1. Overview

When a user hits the **per-category display cap** (10 steps in **Next Steps** or **Outside-the-Box** on the simulation page), the UI shows a **category limit** snackbar and may show an informational **profile update recommendation** (`ProfileUpdateRecommendation.jsx` in `Simulation.jsx`). The recommendation nudges the user toward **`/profile`** to improve matches; it is **dismissible** and **non-blocking**.

**Related:** [CAREER_STEP_DISPLAY_LIMIT_REQUIREMENTS.md](./CAREER_STEP_DISPLAY_LIMIT_REQUIREMENTS.md), [UNSAVED_CHANGES_NAVIGATION_GUARD_REQUIREMENTS.md](./UNSAVED_CHANGES_NAVIGATION_GUARD_REQUIREMENTS.md) (navigation to profile uses guarded navigation where applicable).

---

## 2. Trigger and frequency

- **Trigger:** User reaches the maximum displayed steps in a category (`categoryDisplayCounts[category] >= categoryLimits[category]`), on the removal path that already shows the limit snackbar (`handleRemoveCareerStep` → `handleShowProfileRecommendation`).
- **Timing:** Recommendation is shown **immediately after** the limit warning in that flow.
- **Frequency:** While the recommendation is already visible, it is **not** duplicated (`handleShowProfileRecommendation` returns early when `showProfileRecommendation` is true). Dismissal resets visibility so **another category** can trigger a new recommendation in the same session.

---

## 3. Message content (matches `ProfileUpdateRecommendation.jsx`)

- **Header:** **"Discover More {category title}"** (e.g. “Discover More Next Step Roles” / “Discover More Outside-the-Box Roles”) with a category-specific icon.
- **Body:** **"You've explored all available career options for this category. Consider updating your profile to discover more relevant opportunities."**
- **Profile completion:** Label **"Profile Completion"** with a percentage chip and linear progress bar.
- **Suggestions:** Intro **"To improve your results, consider:"** plus bullets from **`getCategoryGuidance`** (differs for `nextSteps` vs `outsideTheBox`).
- **CTA:** Button **"Update Profile"** (`PersonAdd` icon, contained); helper text **"Adding more details can help us suggest better career matches"**.
- **Navigation:** Parent **`onUpdateProfile`** — in **`Simulation.jsx`**, **`guardedNavigate('/profile')`** (route **`/profile`**).

---

## 4. Display behavior

- **Style:** MUI **info** `Alert` (blue/informational).
- **Persistence:** Stays until the user dismisses (**X** on the alert) or leaves the simulation page (unmount clears React state).
- **Position:** Below the category limit warning, above the career step cards.
- **Blocking:** Does not block simulation use; user can dismiss and continue.

---

## 5. State and data

- **React state** in **`Simulation.jsx`:** `showProfileRecommendation`, `recommendationCategory`.
- **Profile completion** for the bar/chip: **`calculateProfileCompletion()`**, backed by **`GET /api/profile/completion`**.
- **Simulation context:** Unsaved / session-backed simulation state is **not** cleared by navigating to profile when using **`guardedNavigate`**; user returns via normal app navigation.

---

## 6. Verified behaviors (acceptance)

- Recommendation appears at the **10-step cap** per category on the described removal path.
- **Update Profile** navigates to **`/profile`** via guarded navigation.
- Message is **dismissible** and **non-blocking**; leaving **`/simulation`** clears it.
- Category-specific guidance and completion UI match the live component.

---

## 7. Implementation reference

| Area | Location |
|------|----------|
| Recommendation UI | `src/client/components/common/ProfileUpdateRecommendation.jsx` |
| Integration, limits, handlers | `src/client/components/pages/Simulation.jsx` (`handleShowProfileRecommendation`, `handleDismissRecommendation`, `handleUpdateProfile`, `categoryLimits`, `categoryDisplayCounts`) |
| Display limits | [CAREER_STEP_DISPLAY_LIMIT_REQUIREMENTS.md](./CAREER_STEP_DISPLAY_LIMIT_REQUIREMENTS.md), `src/server/config/displayLimits.js` |

The profile completion **API** is the existing **`GET /api/profile/completion`**; no separate backend feature was added for this nudge.
