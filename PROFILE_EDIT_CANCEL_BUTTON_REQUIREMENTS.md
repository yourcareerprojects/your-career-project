# Profile Edit Cancel Button Requirements

## 1. Overview (as-built)

On **`/profile`**, each editable section passes **`onCancel={handleCancel}`** from **`Profile.jsx`** into the profile forms. Cancel appears as an outlined button next to Save; it resets the section to last-loaded values and exits edit mode via the parent handler. When the form has **unsaved edits**, Cancel first opens the **discard confirmation** dialog (see [PROFILE_EDIT_CANCEL_CONFIRMATION_DIALOG_REQUIREMENTS.md](./PROFILE_EDIT_CANCEL_CONFIRMATION_DIALOG_REQUIREMENTS.md)); with no changes, cancel runs immediately.

## 2. Requirements

### 2.1 Core Functionality Requirements

#### 2.1.1 Cancel Button Presence
- **REQ-001**: A "Cancel" button must be present in all profile edit forms alongside the "Save" button
- **REQ-002**: Cancel button must be visually distinct from the Save button (outlined vs. contained style)
- **REQ-003**: Cancel button must be positioned consistently across all profile sections

#### 2.1.2 Cancel Button Behavior
- **REQ-004**: Clicking Cancel must discard all unsaved changes in the current edit session
- **REQ-005**: Cancel must return the user to the view mode of the profile section
- **REQ-006**: Cancel must reset form data to the last saved state
- **REQ-007**: Cancel must clear any validation errors or form state

#### 2.1.3 Form State Management
- **REQ-008**: Cancel must restore original form values from when edit mode was entered
- **REQ-009**: Cancel must not trigger any API calls or data persistence
- **REQ-010**: Cancel must maintain the same form validation state as before edit mode

### 2.2 User Interface Requirements

#### 2.2.1 Button Styling and Layout
- **REQ-011**: Cancel button must use Material-UI outlined variant with secondary color
- **REQ-012**: Save button must use Material-UI contained variant with primary color
- **REQ-013**: Buttons must be positioned side-by-side with consistent spacing
- **REQ-014**: Cancel button must be positioned to the left of the Save button
- **REQ-015**: Button container must use flexbox with justify-content: flex-end

#### 2.2.2 Button Text and Icons
- **REQ-016**: Cancel button text must be "Cancel" (no icons required)
- **REQ-017**: Save button text must remain "Save [Section Name]" (e.g., "Save Personal Information")
- **REQ-018**: Button text must be consistent across all profile sections

#### 2.2.3 Responsive Design
- **REQ-019**: Button layout must work on mobile devices (stack vertically if needed)
- **REQ-020**: Button sizing must be consistent across different screen sizes
- **REQ-021**: Touch targets must meet accessibility guidelines (minimum 44px)

### 2.3 User Experience Requirements

#### 2.3.1 Confirmation Behavior
- **REQ-022**: If there are **no** unsaved changes, Cancel exits without a dialog
- **REQ-023**: If there **are** unsaved changes, Cancel opens the discard dialog (title **"Discard Changes?"**) before discarding
- **REQ-024**: Dialog copy must state that unsaved modifications will be lost (see confirmation dialog spec)

#### 2.3.2 Loading States
- **REQ-025**: Cancel button must remain enabled during form loading states
- **REQ-026**: Cancel must work even if Save operation is in progress
- **REQ-027**: Cancel must interrupt any ongoing save operations gracefully

#### 2.3.3 Error Handling
- **REQ-028**: Cancel must work even if there are validation errors in the form
- **REQ-029**: Cancel must clear error messages when returning to view mode
- **REQ-030**: Cancel must not trigger error states or notifications

### 2.4 Technical Requirements

#### 2.4.1 Component Integration
- **REQ-031**: All profile form components must accept an `onCancel` prop
- **REQ-032**: `onCancel` prop must be a function that handles cancel logic
- **REQ-033**: Form components must call `onCancel` when Cancel button is clicked
- **REQ-034**: Parent components must provide cancel handlers to form components

#### 3.4.2 State Management
- **REQ-035**: Form components must maintain original data for cancel restoration
- **REQ-036**: Cancel must reset form state to initial values
- **REQ-037**: Form validation state must be reset on cancel
- **REQ-038**: Loading states must be cleared on cancel

#### 2.4.3 Performance Requirements
- **REQ-039**: Cancel operation must be immediate (no API calls)
- **REQ-040**: Cancel must not cause unnecessary re-renders
- **REQ-041**: Memory usage must not increase due to cancel functionality

## 3. Affected components

### 3.1 Section forms (profile edit)
Includes **`PersonalInfoForm`**, **`UserIdentityTextForm`**, and **`SeniorityForm`**.

### 3.2 Parent
- **`Profile.jsx`**: `handleCancel` clears `editSection` / errors; forms reset via their own `executeCancel` / `resetForm` before `onCancel()`.

### 3.3 Inline rows
- Not applicable in the current profile model; removed legacy education/work-experience/certification inline editors are out of scope.

## 4. Implementation reference

### 4.1 Button layout pattern
```jsx
<Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 2, mt: 2 }}>
  <Button
    variant="outlined"
    color="secondary"
    onClick={onCancel}
    disabled={loading}
  >
    Cancel
  </Button>
  <Button
    type="submit"
    variant="contained"
    color="primary"
    disabled={loading || !isValid}
  >
    Save {sectionName}
  </Button>
</Box>
```

### 4.2 Cancel handler pattern
```jsx
const handleCancel = () => {
  // Reset form data to original values
  setFormData(originalFormData);
  // Clear any errors
  setErrors({});
  // Call parent cancel handler
  onCancel();
};
```

### 4.3 Parent integration
```jsx
const handleCancel = () => {
  setEditSection(null);
  setFormError(null);
  // Form data will be reset by individual form components
};
```

## 5. Acceptance criteria

### 5.1 Functional
- [x] Cancel appears on profile section forms wired from `Profile.jsx`
- [x] Cancel discards unsaved changes (after confirmation when dirty)
- [x] Cancel returns to view mode
- [x] Form restores values from original snapshot / reset helpers
- [x] Validation errors cleared on confirm discard
- [x] Cancel remains usable alongside loading rules defined per form

### 5.2 UI/UX
- [x] Outlined Cancel + contained Save pattern (e.g. `color="secondary"` / `primary` in `PersonalInfoForm` and peers)
- [x] Buttons right-aligned with spacing
- [x] Layout responsive per MUI `Grid` / `Box` usage

### 5.3 Technical
- [x] Forms accept `onCancel` and invoke it after local reset
- [x] No PUT on cancel; only dialog + state reset

## 6. Related documentation

- [PROFILE_EDIT_CANCEL_CONFIRMATION_DIALOG_REQUIREMENTS.md](./PROFILE_EDIT_CANCEL_CONFIRMATION_DIALOG_REQUIREMENTS.md)
