# Remove Career Steps Feature

## Overview
The Remove Career Steps feature allows users to remove individual career steps from simulation results (both saved and unsaved) that they are not interested in. After removal, the system pulls the **next visible role from that category’s prioritized list** (order was fixed when the simulation ran using **hybrid embedding + MMR**).

**Harmonized card actions**
Remove is one of the card actions (Save / Dislike / Remove) that must behave consistently across pages and simulation types. The canonical behavior specification is in:
- `SIMULATION_CARD_ACTIONS_HARMONIZED_REQUIREMENTS.md`

## Features

### 🗑️ Remove control (harmonized card actions)
- **Location**: On simulation and saved-simulation career cards, **Remove** is one of four actions in the shared **2×2** grid with **More**, **Save / Saved**, and **Dislike** (primary UI: `CareerStepCardWithReplacement.jsx`)—not a separate corner control.
- **Appearance / styling**: Matches the harmonized action-button spec (contained `MuiButton`, shared dimensions, `DeleteIcon` as end icon, **Remove** label). Exact `sx` and layout: [BUTTON_STYLING_CONSISTENCY.md](./BUTTON_STYLING_CONSISTENCY.md); behavior contract: [SIMULATION_CARD_ACTIONS_HARMONIZED_REQUIREMENTS.md](./SIMULATION_CARD_ACTIONS_HARMONIZED_REQUIREMENTS.md).

### ⚠️ Confirmation Dialog
- **Trigger**: Clicking the "Remove" button
- **Content**: 
  - Title: "Remove Career Step"
  - Message: "Are you sure you want to remove '[Career Step Title]'? This action cannot be undone."
  - Buttons: "Cancel" (outlined) and "Remove" (filled, danger color)

### 🔄 Automatic Result Replacement
- **Behavior**: After removal, the next role for that category is taken from the **prioritized list** for that run (`nextCareerRoles` / `outsideTheBoxRoles`), advancing `currentPositions`.
- **New simulations**: List-based replacement only; ranking was done **once** at simulation time.
- **Category-Specific**: Replacement stays in the same UI category (next steps ↔ `nextCareerRoles`, OOTB ↔ `outsideTheBoxRoles`).
- **Sequential**: Next item is the next index in that list (order fixed at simulation time).
- **Further advice / non-list categories:** Some saved documents include **`replacementPools`** where the request **`category`** does **not** map to **`nextCareerRoles`** / **`outsideTheBoxRoles`**. Standard **next** / **OOTB** removal uses **prioritized lists** only.
- **Fallback**: If the list is exhausted (or no item at the next index), the user sees an appropriate “no more alternatives” style message.

### Saved simulations (persisted removal)
- **Remove** updates **`results`** on the server (including **`prioritizedLists`** / **`currentPositions`**) via **`DELETE /api/profile/simulation-results/:simulationId/career-steps/:stepId`**.
- Deterministic **`stepId`** values MUST remain stable for steps that remain in the run.

## Implementation Details

**Simulation-related API paths** (full table): [`SIMULATION_IMPLEMENTATION_REQUIREMENTS.md`](./SIMULATION_IMPLEMENTATION_REQUIREMENTS.md) §7. Below: removal-specific contract only.

### Backend Components

#### 1. Remove career step
```
DELETE /api/profile/simulation-results/:simulationId/career-steps/:stepId
```

#### 2. Controller Function
- **File**: `src/server/controllers/profileController.js`
- **Function**: `removeCareerStepFromSimulation`
- **Features**:
  - Finds career step in simulation results (nextSteps, outsideTheBox, or furtherAdvice as applicable)
  - Removes the step and updates result counts
  - **Next / OOTB**: Replacement from **prioritized lists** only—`getPrioritizedItemByPosition` (DB) with embedded `results.prioritizedLists[listKey]` as fallback, then `currentPositions[listKey]++`. No `replacementPools` branch for those categories when `category` maps to a list key.
  - **`replacementPools`**: Used in the controller when the request `category` does **not** map to `nextCareerRoles` / `outsideTheBoxRoles` (e.g. some non-list categories). Not used for standard next/OOTB removes.
  - Returns updated results and counts with replacement information

#### 3. Route Registration
- **File**: `src/server/routes/profile.js`
- **Route**: `/simulation-results/:simulationId/career-steps/:stepId`

### Frontend Components

#### 1. ConfirmationDialog
- **File**: `src/client/components/common/ConfirmationDialog.jsx`
- **Purpose**: Reusable confirmation dialog for destructive actions
- **Features**: Configurable title, message, buttons, and severity levels

#### 2. CareerStepCardWithReplacement
- **File**: `src/client/components/common/CareerStepCardWithReplacement.jsx`
- **Purpose**: Career step card with removal and replacement functionality
- **Features**:
  - Handles both local (unsaved) and API (saved) removals
  - Passes category parameter to removal functions
  - Shows replacement counter and remaining alternatives
  - Integrates with prioritized lists approach

#### 3. useRemoveCareerStep Hook
- **File**: `src/client/hooks/useRemoveCareerStep.js`
- **Purpose**: API hook for removing career steps
- **Features**:
  - Sends category in request body for backend processing
  - Handles authentication and error states
  - Returns updated results and replacement information

## Troubleshooting

### Common Issues

#### 1. Replacement Not Working for "Out-of-the-Box Roles"
**Symptoms**: Removing a step from "Out-of-the-Box Roles" doesn't show a replacement
**Causes**:
- Category parameter not passed correctly to API
- Prioritized lists not generated for `outsideTheBoxRoles`
- Current position tracking not updated
- **Insufficient roles in prioritized list** (most common cause)

**Solutions**:
1. Verify category mapping: `outsideTheBox` → `outsideTheBoxRoles`
2. Check that `prioritizedLists.outsideTheBoxRoles` exists in simulation results
3. Ensure `currentPositions.outsideTheBoxRoles` is properly tracked
4. Verify API request includes category in request body
5. **Check list length**: Ensure `outsideTheBoxRoles` has 20-30 entries, not just 3
6. **Generate new simulation**: If list is too short, create a new simulation with improved filtering

#### 2. No Replacement Available
**Symptoms**: "No more alternatives available" message appears
**Causes**:
- All items in prioritized list have been displayed
- Prioritized list is empty or too small
- Current position exceeds list length

**Solutions**:
1. Check prioritized list length (should be 20-30 items)
2. Verify current position tracking
3. Consider generating new simulation with different parameters

#### 3. Save Simulation Fails After Removal
**Symptoms**: "Failed to save simulation" error (500 Internal Server Error)
**Causes**:
- Missing `resultsCount` field in simulation object
- Database validation error due to incomplete simulation data
- Modified results structure not properly handled

**Solutions**:
1. **Backend Fix**: Ensure `resultsCount` is calculated from actual results
2. **Validation**: Check that all required fields are present
3. **Data Integrity**: Verify results structure matches User model schema

#### 4. Cross-Category Duplicates
**Symptoms**: Same career step appears in multiple categories
**Causes**:
- Cross-category uniqueness not enforced during list generation
- Embedded result lists out of sync with DB-backed prioritized items on some stored documents

**Solutions**:
1. Verify cross-category uniqueness in `generatePrioritizedLists`
2. Check that `nextRoleTitles` set properly excludes items from other categories
3. Re-run or re-save simulations so results include full `prioritizedLists` / positions aligned with storage

## Technical Requirements

### API Request Format
```javascript
// DELETE /api/profile/simulation-results/:simulationId/career-steps/:stepId
{
  "category": "outsideTheBox" // Required for prioritized lists approach
}
```

**Step identity requirement**
- Requests MUST use deterministic `stepId` (fallback `id`) provided by the backend simulation payload.
- Matching by title is a fallback when deterministic `stepId` / `id` is missing on the payload.

### Category Mapping
- Frontend: `outsideTheBox` (camelCase)
- Backend: `outsideTheBoxRoles` (prioritized list key)
- Database: `outsideTheBox` (results array key)

### Prioritized Lists Structure
```javascript
{
  prioritizedLists: {
    nextCareerRoles: [...], // 20-30 items
    outsideTheBoxRoles: [...] // 20-30 items
  },
  currentPositions: {
    nextCareerRoles: 3, // Next item at index 3
    outsideTheBoxRoles: 3 // Next item at index 3
  }
}
```

## As-built summary

- **Remove** uses the harmonized card **2×2** action grid and a **confirmation dialog** before destructive remove.
- **Unsaved** runs: client-side removal and list cursor behavior; **saved** runs: **`DELETE /api/profile/simulation-results/:simulationId/career-steps/:stepId`** with **`category`** in the body.
- **Prioritized lists** drive next/OOTB replacement; **`currentPositions`** advance; **cross-category uniqueness** is enforced in current list generation.
- **Progress / remaining alternatives** UI reflects per-category counts from the live results shape.

### Operational notes

- **Category body field:** **`outsideTheBox`** (and peers) must be sent correctly from the client or replacement routing can fail for OOTB.
- **Stored results shape:** Some saved simulations may **omit** full **`prioritizedLists`** or use **short** lists; standard next/OOTB removal does **not** use **`replacementPools`** in that path—**no replacement** appears until the user runs a **new** simulation or the document is repaired.
- **Duplicates across categories:** Can appear in **stored** simulations produced before current uniqueness rules; **new** runs follow the generator’s cross-category rules.

## Save Changes to Existing Simulations Integration

### Overview
Removing steps on a **saved** simulation updates **`results`** immediately via **`DELETE .../career-steps/...`**. Additional batching or follow-up edits are persisted with **Save Changes** when the UI detects drift from the opened snapshot.

### Integration points

#### 1. Change detection
- **Behavior:** Compare **snapshot from open** vs. **current** `results` (after removes/replacements) to enable **Save Changes**.

#### 2. Save Changes workflow
1. User opens a saved simulation.  
2. User removes or replaces steps (same remove flow as above).  
3. When `results` differ from the snapshot, **Save Changes** is enabled.  
4. User confirms **Save Changes**; **`PUT /api/profile/simulation-results/:simulationId`** writes the updated document.

#### 3. API
- **`PUT /api/profile/simulation-results/:simulationId`** — full updated simulation payload (including `results`, `prioritizedLists`, `currentPositions`, and related fields as applicable).

#### 4. State
- **Opened snapshot** vs. **current state** drive change detection; after a successful save, detection resets to the new baseline.

### Technical summary
- **Per-remove persistence**: Each remove on a **saved** simulation calls **`DELETE /api/profile/simulation-results/:simulationId/career-steps/:stepId`** so the server updates `results` (including `prioritizedLists` / `currentPositions`) immediately.
- **Save Changes**: Aggregate edits are persisted with **`PUT /api/profile/simulation-results/:simulationId`** (`src/server/routes/profile.js`, `profileController`). Full UX and validation: [**SAVE_CHANGES_TO_EXISTING_SIMULATIONS_REQUIREMENTS.md**](./SAVE_CHANGES_TO_EXISTING_SIMULATIONS_REQUIREMENTS.md).
- **Change detection**: UI compares the snapshot from when the saved simulation was opened to current `results` (after removes/replacements) to enable **Save Changes**.

Normative detail for removal/replace is in **`requirements.md` (§11 Core Features, subsection 9.9.8)**.

### User experience flow (abbreviated)
1. Open saved simulation → 2. Remove/replace steps (normal remove flow) → 3. **Save Changes** writes the updated simulation document → 4. Errors surface via existing snackbars / retry patterns.

## Conclusion

The Remove Career Steps feature provides users with the ability to customize their simulation results by removing unwanted career steps and automatically receiving the **next item from the same category’s prioritized list** (ranked at simulation time via the hybrid + MMR pipeline).

The feature supports both local (unsaved) and API (saved) simulations, with comprehensive error handling and user feedback. The implementation includes progress tracking and remaining-alternatives messaging. **Next/OOTB** removes use **prioritized lists**; **`replacementPools`** apply only where `category` does not map to list keys.

The feature integrates with **Save Changes to Existing Simulations** (see **Save Changes** subsection above and `SAVE_CHANGES_TO_EXISTING_SIMULATIONS_REQUIREMENTS.md`) so users can persist further edits after removes.

For troubleshooting, the most common issue is the "Out-of-the-Box Roles" replacement not working, which is typically caused by category parameter passing or prioritized lists generation issues. The documentation above provides detailed solutions for these scenarios.


## Usage

### For Users
1. **View Simulation Results**: Navigate to the Simulation page
2. **Locate Remove**: On each career step card, find **Remove** in the **2×2** action grid (row 2 with **Dislike**; see harmonized card actions in `CareerStepCardWithReplacement.jsx`)
3. **Click Remove**: Click the remove button to open the confirmation dialog
4. **Confirm Removal**: Click "Remove" in the dialog to confirm
5. **View Updates**: The career step is removed and results are updated automatically

### For Developers
1. Use **`CareerStepCardWithReplacement`** (or the same action-button patterns from [`BUTTON_STYLING_CONSISTENCY.md`](./BUTTON_STYLING_CONSISTENCY.md)) for the four harmonized actions.
2. For saved simulations, call **`useRemoveCareerStep`** or the same **`DELETE .../career-steps/...`** contract from your handler; pass **`category`** in the JSON body.
3. Align remove confirmation and snackbars with **`Simulation.jsx`** / **`SavedSimulationDetails.jsx`** behavior for consistency.

## Integration Points

### Simulation Component
- **File**: `src/client/components/pages/Simulation.jsx`
- **Changes**: 
  - Added `handleRemoveCareerStep` function
  - Uses `CareerStepCardWithReplacement` (and related hooks) for remove/replace
  - Added state management for removal operations

### State Management
- **Local State**: Updates `simResults` immediately after removal
- **Saved Simulations**: Updates `selectedSimulation` and `savedSimulations` if viewing saved results
- **Real-time Updates**: UI reflects changes without page refresh

## Error Handling

### Backend Errors
- **User Not Found**: 404 error with clear message
- **Simulation Not Found**: 404 error for invalid simulation ID
- **Career Step Not Found**: 404 error for invalid step ID
- **Server Errors**: 500 error with detailed error information

### Frontend Errors
- **Network Failures**: Graceful fallback with user-friendly messages
- **API Errors**: Display error messages in snackbar notifications
- **State Inconsistencies**: Automatic state recovery and validation

## Performance Considerations

### Response Times
- **Removal**: Complete within 2 seconds
- **Replacement**: Show next result within 1 second
- **Overall**: Maintain responsive UI during operations

### Resource Usage
- **Minimal API Calls**: Efficient removal and replacement logic
- **Optimistic Updates**: Update UI immediately, sync with backend
- **State Caching**: Leverage existing result caching where possible

## Accessibility Features

### Screen Reader Support
- **ARIA Labels**: Proper labeling for remove buttons and dialogs
- **Keyboard Navigation**: Full keyboard accessibility for all interactions
- **Focus Management**: Proper focus handling during dialog operations

### Visual Accessibility
- **Color Contrast**: Ensure sufficient contrast for danger actions
- **Icon + Text**: Combine icons with text labels for clarity
- **Size**: Adequate button size for touch/mouse interaction

## Testing

### Manual Testing
1. **Remove Career Step**: Test removal from different result types
2. **Confirmation Dialog**: Verify dialog appears and functions correctly
3. **State Updates**: Check that results update immediately after removal
4. **Error Handling**: Test with invalid IDs and network failures

### Automated Testing
- **Component Tests**: Test individual components in isolation
- **Integration Tests**: Test complete removal workflow
- **API Tests**: Test backend endpoint functionality
- **Accessibility Tests**: Verify screen reader and keyboard support


## Related documentation

- **`requirements.md` (§11, subsection 9.9.8)** — canonical API, DELETE handler, and list-based replacement.
- **`SIMULATION_IMPLEMENTATION_REQUIREMENTS.md`** — prioritized list generation and storage.
- **`SIMULATION_CARD_ACTIONS_HARMONIZED_REQUIREMENTS.md`** — Save / Dislike / Remove parity.
- **`SAVE_CHANGES_TO_EXISTING_SIMULATIONS_REQUIREMENTS.md`** — persisting edits after modifying a saved simulation.

### Local (unsaved) removal

`Simulation.jsx` updates in-memory `prioritizedLists` / `currentPositions` and session persistence per **`requirements.md` (section 1.5.5)**. There is no separate client-side replacement-pool generator in the current design.

### Cross-category uniqueness

Handled when lists are built on the server (next vs out-of-the-box); not via a browser global registry.

## Support

For technical support or feature requests related to the Remove Career Steps feature, please refer to the main project documentation or contact the development team.
