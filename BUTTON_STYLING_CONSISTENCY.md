# Button Styling Consistency Requirements

**Canonical** visual and layout spec for the four career-step actions. **[`SIMULATION_CARD_ACTIONS_HARMONIZED_REQUIREMENTS.md`](./SIMULATION_CARD_ACTIONS_HARMONIZED_REQUIREMENTS.md)** defines behavior and persistence; it **must** defer here for grid, `sx`, icons, and dislike styling—do not duplicate those details there.

## Overview
For **simulation career cards** (`CareerStepCardWithReplacement`), **saved-simulation** grids (same component), and the **Saved Career Steps** list (`SavedCareerSteps.jsx`), the four action buttons use the same styling and **2×2** layout.

Actions in scope: **More**, **Save / Saved**, **Dislike**, **Remove**.

## Requirements

### 1. Visual Consistency
All action buttons must appear visually identical in terms of:
- Button dimensions (width and height)
- Internal padding and spacing
- Text positioning within buttons
- Icon positioning and containment
- Border radius and overall shape

### 1.1 Two-row layout (new)
Career step cards MUST present the four actions as a **2×2 grid**:
- **Row 1**: More, Save / Saved
- **Row 2**: Dislike, Remove

**Alignment requirements**
- Buttons MUST be aligned as two equal-width columns.
- Buttons in the same column MUST have identical widths.
- Buttons in the same row MUST have identical heights.
- Gaps MUST be consistent horizontally and vertically.

### 2. Exact Styling Values
All action buttons must implement these exact styling values with `!important` declarations (larger, icon-safe):
```jsx
sx={{
  width: '100% !important',     // full width within its grid cell
  minWidth: '0px !important',   // allow grid to control width
  px: '14px !important',        // balanced horizontal padding for text + endIcon
  py: '8px !important',         // larger tap target
  fontSize: '0.875rem !important',
  lineHeight: '1.1 !important',
  borderRadius: '12px !important',
  whiteSpace: 'nowrap !important',
  boxShadow: 'none !important',
  overflow: 'hidden !important',
  '& .MuiButton-endIcon': {
    display: 'inline-flex',
    alignItems: 'center',
    marginLeft: '8px !important',
    marginRight: '0px !important' // override MUI default negative margin
  }
}}
```

### 3. Icon Specifications
All icons must use consistent sizing:
```jsx
sx={{ fontSize: '0.9rem' }}
```

**Icon containment requirement (new)**
- Action buttons MUST NOT allow icons/spinners to overflow the button boundary.
- Implementation MUST override Material-UI’s default endIcon right margin (which can be negative) via:
  - `& .MuiButton-endIcon { marginRight: 0 !important; }`
- Buttons MUST also set `overflow: hidden` to prevent any icon/spinner bleed outside the border.

### 4. Button Variants
All buttons must use:
- `variant="contained"`
- `size="medium"`

### 5. Component Usage
- **More Button**: Uses `ArrowForwardIcon` as `endIcon`
- **Save Button**: Uses `StarBorderIcon` (unsaved) or `StarIcon` (saved) as `endIcon`
- **Dislike Button**: Uses `ThumbDownIcon` as `endIcon` and displays text `"Dislike"` (or `"Disliked"` when toggled on)
- **Remove Button**: Uses `DeleteIcon` as `endIcon`

### 6. Dislike button color + state requirements
- **Goal**: Dislike must feel like a first-class action button (same size/shape/typography) while still reading as a negative signal.
- **Default color**: Dislike MUST use a consistent neutral/negative color that does not conflict with section color identity.
  - Recommended: a neutral grey (`grey.600` / `grey.700` hover) rather than reusing the section’s primary color.
- **Active state** (if toggled):
  - Text MAY change to `"Disliked"` and the button MAY use a slightly darker shade to indicate the active state.
  - The active state MUST NOT change button dimensions.

## In-scope components (2×2 grid, `ACTION_BUTTON_SX`, `career-step-action-button`)

1. **`CareerStepCardWithReplacement.jsx`** — Career cards in **`Simulation.jsx`** and **`SavedSimulationDetails.jsx`** (Next roles, Outside-the-box, Resources & advice).
2. **`SavedCareerSteps.jsx`** — List cards on **`/saved-steps`**: same **2×2** grid, `ACTION_BUTTON_SX`, `career-step-action-button`, `size="medium"`. **Saved** removes from the profile list immediately; **Remove** confirms then removes; **Dislike** is session-only (no simulation id on this page).

### Theme override (MUI global vs card actions)
- **Issue Identified**: Global Material-UI theme was overriding button styling with `borderRadius: 8`
- **Solution Implemented**: 
  - Added theme override for `.career-step-action-button` class with `!important` declarations
  - Added CSS rules to `public/css/styles.css` for additional specificity
  - **`CareerStepCardWithReplacement`** uses shared `ACTION_BUTTON_SX` with `!important` for critical properties
- **Theme Location**: `src/client/components/App.jsx` - MuiButton styleOverrides
- **CSS Location**: `public/css/styles.css` - Additional button styling rules
- **Class Applied**: **`CareerStepCardWithReplacement`** and **`SavedCareerSteps.jsx`** action buttons use `className="career-step-action-button"`.

### 🔍 Verification Points (`CareerStepCardWithReplacement` + `SavedCareerSteps.jsx`)
- [x] All buttons use `width: '100%'` within a 2×2 grid cell
- [x] All buttons use `px: 14px` for consistent text + icon spacing
- [x] All buttons use `py: 8px` for consistent vertical padding
- [x] All buttons use `fontSize: '0.875rem'` and `borderRadius: '12px'`
- [x] All buttons use `whiteSpace: 'nowrap'` and `boxShadow: 'none'`
- [x] All icons use `fontSize: '0.9rem'` and are positioned as `endIcon`
- [x] All buttons have `className="career-step-action-button"` for theme override compatibility

## Color Scheme

### Button Colors by Section
- **Next Career Roles**: Primary blue (`primary.main`)
- **Outside-the-Box Roles**: Orange (`#ff9800`)
- **Resources & Advice**: Green (`#4caf50`)
- **Remove Button**: Error red (`#d32f2f`)

### Save State Colors
- **Unsaved**: Section-specific color
- **Saved**: Darker shade of section color (e.g., `#1976d2` → `#0d47a1`)
- **Hover**: Even darker shade for saved buttons

## Layout Consistency

### Button Container
```jsx
<Box sx={{ 
  display: 'grid',
  gridTemplateColumns: '1fr 1fr',
  gap: 1,
  width: '100%',
  alignItems: 'stretch'
}}>
```

### Button Group
```jsx
<Box sx={{ 
  display: 'contents'
}}>
```

## Testing Checklist

### `CareerStepCardWithReplacement` (simulation + saved-simulation grids)
#### Visual consistency
- [x] All four action buttons have identical dimensions within the 2×2 grid
- [x] Text positioning is consistent across all buttons
- [x] Icons are properly contained within button boundaries (`overflow: hidden`, endIcon margin override)
- [x] Border radius is consistent (`12px`)
- [x] Spacing between buttons is uniform (`gap: 1` on the grid)

#### Cross-section (same component in each section)
- [x] Next Career Roles section buttons
- [x] Outside-the-Box Roles section buttons
- [x] Resources & Advice section buttons

#### State consistency
- [x] Loading states preserve button dimensions (spinner inside button; grid cell size unchanged)
- [x] Hover effects don't change button size (color-only / standard MUI hover)
- [x] Disabled states maintain visual consistency
- [x] Save/unsave state changes preserve dimensions

### `SavedCareerSteps.jsx` list cards
- [x] Uses the same **2×2** four-action grid and shared action-button styling as **`CareerStepCardWithReplacement`**

## Maintenance

### When Adding New Buttons
1. Copy the exact styling from existing buttons
2. Ensure consistent icon sizing (`fontSize: '0.9rem'`)
3. Use appropriate color scheme for the section
4. **Always add `className="career-step-action-button"`** to ensure theme override compatibility
5. Test visual consistency with existing buttons

### For reviewers
PRs that touch career-step action buttons should still satisfy **§1–§1.1** (layout), **§2–§3** (shared `sx` + icons), **§4–§6** (variants + dislike rules), **Color Scheme**, and the **Testing Checklist** above—compare with **`CareerStepCardWithReplacement.jsx`** and **`SavedCareerSteps.jsx`** rather than re-stating dimensions or padding in review comments.
