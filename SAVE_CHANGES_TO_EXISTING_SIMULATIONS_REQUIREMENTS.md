# Save Changes to Existing Simulations - Requirements

## 1. Overview (as-built)

Users can **update an existing saved simulation** in place: the client detects edits vs the loaded snapshot, offers **Save Changes** + confirmation, and sends the full payload with **`useUpdateSimulation`** → **`PUT /api/profile/simulation-results/:simulationId`**. Timestamps: **`lastModified`** on update; original **`timestamp`** kept as created-at.

## 2. Functional Requirements

### 2.1 Core Functionality
- **FR-1**: Users must be able to save changes to existing simulations
- **FR-2**: The save operation should update the existing simulation record, not create a new one
- **FR-3**: All changes made to the simulation should be preserved (removed steps, replacements, etc.)
- **FR-4**: The simulation's metadata should be updated to reflect the modification (see “Data Persistence Requirements”)

### 2.2 User Interface Requirements
- **FR-5**: A "Save Changes" button should be available when viewing existing simulations
- **FR-6**: The button should only appear when changes have been made to the simulation
- **FR-7**: The button should be disabled when no changes are detected
- **FR-8**: Visual feedback should indicate when changes are unsaved (e.g., asterisk, different color)
- **FR-9**: Confirmation dialog should appear before saving changes

### 2.3 Data Persistence Requirements
- **FR-10**: The existing simulation record should be updated in the database
- **FR-11**: The simulation ID should remain unchanged
- **FR-12**: All simulation data should be preserved (results, prioritizedLists, currentPositions, etc.)
- **FR-13**: A modification timestamp should be recorded (current implementation uses `lastModified`)
- **FR-14**: The original creation timestamp should remain unchanged (current implementation preserves `timestamp`)

**Implementation note**
- The backend currently sets `lastModified: new Date()` on update.
- The backend preserves the original `timestamp` (treated as “created at” for the simulation record).
- A structured “modification history” array is **not** currently implemented; only `lastModified` is stored.

### 2.4 Change Detection Requirements
- **FR-15**: The system must detect when changes have been made to a simulation
- **FR-16**: Changes include: removed career steps, added replacements, modified results
- **FR-16a**: Any change under **`results`** (including structure updates from card actions such as remove/replace, if reflected in the in-memory **`results`** object) participates in dirty detection — **`useChangeDetection`** compares **`JSON.stringify(original.results)`** vs **`current.results`** plus **`name`**, **`description`**, **`careerGoal`**; there is **no** separate branch for session-only UI state (e.g. dislike) that is not written into **`results`**.
- **FR-17**: The system should track the original state vs. current state
- **FR-18**: Change detection should work for all simulation categories (nextSteps, outsideTheBox, furtherAdvice)

**Harmonized card actions**
- Save/Unsave (star) MUST persist the user’s saved-step library state immediately via **`POST` / `DELETE`** on **`/api/profile/saved-career-steps`**.
- “Save Changes” MUST focus on persisting edits that are not already persisted transactionally by the card-action endpoints (e.g., deferred edits in an edit mode).
- See `SIMULATION_CARD_ACTIONS_HARMONIZED_REQUIREMENTS.md`.

## 3. Technical Requirements

### 3.1 Backend Requirements
- **HTTP:** **`PUT /api/profile/simulation-results/:simulationId`** (auth) — full simulation document payload; validates against the user/simulation schema; returns updated data or appropriate errors. **Canonical route row:** [`SIMULATION_IMPLEMENTATION_REQUIREMENTS.md`](./SIMULATION_IMPLEMENTATION_REQUIREMENTS.md) §7 (do not maintain a parallel path list here).

### 3.2 Frontend Requirements
- **TR-7**: New hook: `useUpdateSimulation` for handling update API calls
- **TR-8**: Change detection logic to compare current state with original state
- **TR-9**: State management for tracking unsaved changes
- **TR-10**: Integration with existing removal and replacement functionality
- **TR-11**: Error handling and user feedback for save operations

### 3.3 Data Structure Requirements
- **TR-12**: The simulation object structure should remain consistent
- **TR-13**: All existing fields should be preserved during updates
- **TR-14**: New fields may be added for tracking modifications (e.g., `lastModified`, `modificationCount`)

## 4. User Experience Requirements

### 4.1 Workflow Requirements
- **UX-1**: Users should be able to open an existing simulation
- **UX-2**: Users should be able to make changes (remove steps, see replacements)
- **UX-3**: Users should see visual indication that changes are unsaved
- **UX-4**: Users should be able to save changes with a single action
- **UX-5**: Users should receive confirmation that changes were saved
- **UX-6**: Users should be able to continue making changes after saving

### 4.2 Error Handling Requirements
- **UX-7**: Clear error messages for save failures
- **UX-8**: Retry mechanism for failed save operations
- **UX-9**: Graceful handling of network errors
- **UX-10**: Prevention of data loss during save operations

## 5. Implementation reference

- **Hook**: `src/client/hooks/useUpdateSimulation.js` → `PUT /api/profile/simulation-results/:simulationId`
- **Change detection**: `src/client/hooks/useChangeDetection.js` (see §2.4 / FR-16a)
- **UI**: `Simulation.jsx`, `SavedSimulationDetails.jsx` — save changes control, dialogs, unsaved indicators

## 6. Acceptance criteria

### 6.1 Functional
- [x] Update existing simulation record via PUT; stable id
- [x] `lastModified` updated; creation `timestamp` preserved

### 6.2 User experience
- [x] Save changes when dirty; confirmation where implemented; feedback on success/failure

### 6.3 Technical
- [x] Route and controller wired in `profile.js` / `profileController`

## 7. Related documentation

- `SIMULATION_CARD_ACTIONS_HARMONIZED_REQUIREMENTS.md`
- `SIMULATION_IMPLEMENTATION_REQUIREMENTS.md` §7 (API table)
