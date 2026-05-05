# Unsaved Changes Navigation Guard Requirements

## 1. Overview

When the user has **unsaved modifications** on the **simulation page** (`/simulation`), in-app navigation should not silently discard that work. The shipped design uses a **global navigation guard** (`NavigationGuardContext`) and **`guardedNavigate`** so layout and simulation actions can block navigation and show a confirmation dialog.

## 2. As-built architecture

### 2.1 Internal navigation (in-app)

- **`NavigationGuardProvider`** wraps the main app routes (see `App.jsx` + `NavigationGuardContext.jsx`).
- **`Layout.jsx`** uses **`guardedNavigate`** from the context for primary nav links instead of calling `navigate()` directly, so a pending guard can intercept.
- **`Simulation.jsx`** calls **`registerGuard('simulation', { … })`** when **`simulationState === 'modified'`** (unsaved local changes). The guard supplies dialog copy, optional **Save Changes** (opens the existing save flow), and cleanup on leave.
- This path does **not** use React Router **`useBlocker`**. A separate hook file **`useNavigationGuard.js`** exists but is **not** what `Simulation.jsx` wires for the simulation page guard.

### 2.2 Browser tab close / refresh

- **`beforeunload`** is **not** registered by `Simulation.jsx` or `NavigationGuardContext.jsx`. Closing or refreshing the tab while on `/simulation` does **not** go through the custom dialog; behavior is standard browser semantics.

### 2.3 Saved simulation details page

- **`SavedSimulationDetails.jsx`** uses **`useNavigate`** from React Router for back/navigation. It does **not** register with `NavigationGuardContext`. Unsaved edits on that page are not covered by the same global guard pattern as `/simulation`.

### 2.4 Change detection (simulation page)

- **`useChangeDetection`** compares original vs current simulation data for saved-simulation flows inside `Simulation.jsx` where applicable.
- Guard activation for the **local unsaved** path is driven by **`simulationState === 'modified'`** and the registered guard config (see `Simulation.jsx`).

## 3. User interface (shipped)

### 3.1 Confirmation dialog (context)

- Default / fallback title: **"Unsaved Changes Detected"**; confirm **"Leave Anyway"**; cancel **"Stay on Page"**; optional third action **"Save Changes"** when the active guard enables it (`NavigationGuardContext.jsx` / `getDialogConfig`).

### 3.2 Simulation guard copy

- **`Simulation.jsx`** registers a custom **message** for unsaved simulation work (leaving will lose changes / need to restart). **Save Changes** in the dialog ties into the existing save dialog (`onSave` opens save flow with timestamp-based default name).

### 3.3 Other UI

- **`UnsavedChangesIndicator`** and related simulation UI communicate unsaved state on the page.
- **`CareerStepCardWithReplacement`** accepts optional **`guardedNavigate`** so in-card navigation respects the guard when passed from `Simulation.jsx`.

## 4. Accessibility & quality

- Confirmation UI should remain keyboard-operable and use clear labels (MUI `Dialog` patterns).
- Guard registration is cleaned up on unmount or when `simulationState` is no longer `modified` (`unregisterGuard` in `Simulation.jsx`).

## 5. References

- `src/client/contexts/NavigationGuardContext.jsx`
- `src/client/components/layout/Layout.jsx`
- `src/client/components/pages/Simulation.jsx`
- `src/client/hooks/useChangeDetection.js`
- `src/client/hooks/useNavigationGuard.js` (standalone hook; not the simulation page integration path)
