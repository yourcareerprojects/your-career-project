# Profile Edit Cancel Confirmation Dialog Requirements

## 1. Overview (as-built)

When a profile section form has **unsaved changes** and the user clicks **Cancel**, a **MUI `Dialog`** asks for confirmation before discarding. **Keep Editing** closes the dialog without changing data; **Discard Changes** resets the form and calls **`onCancel`**. Implemented with the same title, body, and button labels across **`PersonalInfoForm`**, **`SeniorityForm`**, and **`UserIdentityTextForm`**. **`Dialog` `onClose`** maps to **Keep Editing** (including backdrop click / Escape, per MUI default behavior).

## 2. Requirements

### 2.1 Core Functionality Requirements

#### 2.1.1 Confirmation Dialog Trigger
- **REQ-001**: Confirmation dialog must appear when Cancel button is clicked
- **REQ-002**: Dialog must only appear if there are unsaved changes in the form
- **REQ-003**: If no changes have been made, Cancel should work immediately without dialog
- **REQ-004**: Dialog must be modal and prevent interaction with the form behind it

#### 2.1.2 Change Detection
- **REQ-005**: System must detect when form data differs from original values
- **REQ-006**: Change detection must work for all form fields (text, select, checkbox, arrays)
- **REQ-007**: Change detection must be real-time and accurate
- **REQ-008**: System must track changes across all editable profile form fields in each section

#### 2.1.3 Dialog Content and Messaging
- **REQ-009**: Dialog title must be "Discard Changes?"
- **REQ-010**: Dialog message must clearly explain what will be lost
- **REQ-011**: Message must be specific about unsaved changes
- **REQ-012**: Dialog must provide clear action options (Discard/Cancel)
- **REQ-013**: Dialog must use appropriate warning styling (warning color scheme)

### 2.2 User Interface Requirements

#### 2.2.1 Dialog Design
- **REQ-014**: Dialog must use Material-UI Dialog component
- **REQ-015**: Dialog must have proper backdrop and modal behavior
- **REQ-016**: Dialog must be centered on screen
- **REQ-017**: Dialog must have appropriate size (not too large or small)
- **REQ-018**: Dialog must be responsive for mobile devices

#### 2.2.2 Button Styling and Layout
- **REQ-019**: "Keep Editing" button must use outlined variant with primary color
- **REQ-020**: "Discard Changes" button must use contained variant with error color
- **REQ-021**: Buttons must be positioned side-by-side with proper spacing
- **REQ-022**: "Keep Editing" button must be positioned to the left
- **REQ-023**: "Discard Changes" button must be positioned to the right
- **REQ-024**: Buttons must have consistent sizing and padding

#### 2.2.3 Dialog Content Layout
- **REQ-025**: Dialog must have a clear title section
- **REQ-026**: Dialog must have a descriptive message section
- **REQ-027**: Dialog must have a button action section
- **REQ-028**: Content must be properly spaced and aligned
- **REQ-029**: Text must be readable and accessible

### 2.3 User Experience Requirements

#### 2.3.1 Dialog Behavior
- **REQ-030**: Dialog must appear with smooth animation
- **REQ-031**: Dialog must close with smooth animation
- **REQ-032**: Clicking outside dialog must close it (same as "Keep Editing")
- **REQ-033**: Escape key must close dialog (same as "Keep Editing")
- **REQ-034**: Dialog must not interfere with form validation or loading states

#### 2.3.2 User Flow
- **REQ-035**: "Keep Editing" must close dialog and return to form
- **REQ-036**: "Discard Changes" must close dialog and execute cancel action
- **REQ-037**: User must be able to continue editing after closing dialog
- **REQ-038**: Form state must remain unchanged if user chooses "Keep Editing"

#### 2.3.3 Accessibility Requirements
- **REQ-039**: Dialog must be keyboard accessible
- **REQ-040**: Dialog must have proper ARIA labels and roles
- **REQ-041**: Focus must be managed properly (trap focus in dialog)
- **REQ-042**: Screen readers must announce dialog content
- **REQ-043**: Dialog must have proper focus management on open/close

### 2.4 Technical Requirements

#### 2.4.1 Component Integration
- **REQ-044**: Confirmation dialog must be integrated into existing form components
- **REQ-045**: Dialog state must be managed within each form component
- **REQ-046**: Dialog must not interfere with existing form functionality
- **REQ-047**: Dialog must work with existing loading and error states

#### 2.4.2 Change Detection Implementation
- **REQ-048**: Change detection must be efficient and not cause performance issues
- **REQ-049**: Change detection must work with complex nested data structures
- **REQ-050**: Change detection must handle array additions, removals, and modifications
- **REQ-051**: Change detection must be debounced to avoid excessive comparisons

#### 2.4.3 State Management
- **REQ-052**: Dialog open/close state must be managed locally in each form
- **REQ-053**: Dialog state must not persist across form submissions or navigation
- **REQ-054**: Dialog state must be reset when form is successfully saved
- **REQ-055**: Dialog state must be reset when form is canceled

## 3. Dialog Content Specifications

### 3.1 Dialog Title
```
"Discard Changes?"
```

### 3.2 Dialog Message
```
"Are you sure you want to discard your changes? All unsaved modifications will be lost and cannot be recovered."
```

### 3.3 Button Labels
- **Keep Editing**: "Keep Editing" (outlined, primary color)
- **Discard Changes**: "Discard Changes" (contained, error color)

### 3.4 Dialog Structure
```jsx
<Dialog open={showCancelDialog} onClose={handleKeepEditing}>
  <DialogTitle>Discard Changes?</DialogTitle>
  <DialogContent>
    <DialogContentText>
      Are you sure you want to discard your changes? All unsaved modifications will be lost and cannot be recovered.
    </DialogContentText>
  </DialogContent>
  <DialogActions>
    <Button onClick={handleKeepEditing} variant="outlined" color="primary">
      Keep Editing
    </Button>
    <Button onClick={handleConfirmCancel} variant="contained" color="error">
      Discard Changes
    </Button>
  </DialogActions>
</Dialog>
```

## 4. Change Detection Algorithm

### 4.1 Deep Comparison Function
```javascript
const hasChanges = (originalData, currentData) => {
  // Handle null/undefined cases
  if (!originalData && !currentData) return false;
  if (!originalData || !currentData) return true;
  
  // Handle arrays
  if (Array.isArray(originalData) && Array.isArray(currentData)) {
    if (originalData.length !== currentData.length) return true;
    return originalData.some((item, index) => hasChanges(item, currentData[index]));
  }
  
  // Handle objects
  if (typeof originalData === 'object' && typeof currentData === 'object') {
    const keys = new Set([...Object.keys(originalData), ...Object.keys(currentData)]);
    for (const key of keys) {
      if (hasChanges(originalData[key], currentData[key])) return true;
    }
    return false;
  }
  
  // Handle primitives
  return originalData !== currentData;
};
```

### 5.2 Change Detection Integration
- Change detection must be called when Cancel button is clicked
- Change detection must be efficient and not block UI
- Change detection must handle all data types used in forms
- Change detection must be debounced if called frequently

## 5. Affected Components

### 5.1 Form Components
1. **PersonalInfoForm** · **UserIdentityTextForm** · **SeniorityForm**

### 5.2 Material-UI Components
- `Dialog`
- `DialogTitle`
- `DialogContent`
- `DialogContentText`
- `DialogActions`
- `Button` (with error variant)

## 6. Implementation Guidelines

### 6.1 Dialog State Management
```jsx
const [showCancelDialog, setShowCancelDialog] = useState(false);

const handleCancel = () => {
  if (hasChanges(originalData, formData)) {
    setShowCancelDialog(true);
  } else {
    // No changes, cancel immediately
    executeCancel();
  }
};

const handleKeepEditing = () => {
  setShowCancelDialog(false);
};

const handleConfirmCancel = () => {
  setShowCancelDialog(false);
  executeCancel();
};
```

### 7.2 Change Detection Hook
```jsx
const useChangeDetection = (originalData, currentData) => {
  return useMemo(() => {
    return hasChanges(originalData, currentData);
  }, [originalData, currentData]);
};
```

### 6.3 Dialog Component Integration
```jsx
// Add to each form component
const [showCancelDialog, setShowCancelDialog] = useState(false);
const hasUnsavedChanges = useChangeDetection(originalData, formData);

// Update handleCancel function
const handleCancel = () => {
  if (hasUnsavedChanges) {
    setShowCancelDialog(true);
  } else {
    executeCancel();
  }
};

// Add dialog JSX before closing form tag
<Dialog open={showCancelDialog} onClose={handleKeepEditing}>
  <DialogTitle>Discard Changes?</DialogTitle>
  <DialogContent>
    <DialogContentText>
      Are you sure you want to discard your changes? All unsaved modifications will be lost and cannot be recovered.
    </DialogContentText>
  </DialogContent>
  <DialogActions>
    <Button onClick={handleKeepEditing} variant="outlined" color="primary">
      Keep Editing
    </Button>
    <Button onClick={handleConfirmCancel} variant="contained" color="error">
      Discard Changes
    </Button>
  </DialogActions>
</Dialog>
```

## 7. Acceptance criteria

### 7.1 Functional
- [x] Dialog when Cancel + unsaved changes; no dialog when clean
- [x] **Keep Editing** / backdrop / Escape dismiss without discarding
- [x] **Discard Changes** runs form reset + `onCancel`
- [x] Forms listed in §1 use the same title, body, and primary actions

### 7.2 UI/UX
- [x] MUI `Dialog` + `DialogTitle` / `DialogContent` / `DialogActions`
- [x] Outlined primary **Keep Editing**, contained error **Discard Changes**

### 7.3 Technical
- [x] Local `showCancelDialog` state; `hasUnsavedChanges` from form comparison helpers

## 8. Related documentation

- [PROFILE_EDIT_CANCEL_BUTTON_REQUIREMENTS.md](./PROFILE_EDIT_CANCEL_BUTTON_REQUIREMENTS.md)
