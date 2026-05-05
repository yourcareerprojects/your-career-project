# Saved Simulations Button Design Requirements

## As-shipped implementation (`Simulation.jsx`)

The **Saved Simulations** control on the simulation page matches the design below: list icon, primary-colored outlined button, and `guardedNavigate` for unsaved-change protection.

**Implementation (excerpt — see `src/client/components/pages/Simulation.jsx` near the "Saved Simulations" label):**

```javascript
<Tooltip title="View and manage your saved simulations" arrow>
  <span>
    <Button
      aria-label="View and manage your saved simulations"
      variant="outlined"
      color="primary"
      startIcon={<ViewListIcon />}
      onClick={() => guardedNavigate('/simulations')}
      sx={{
        fontWeight: 600,
        px: 3,
        py: 1.5,
        borderRadius: '30px',
        fontSize: 16,
        borderWidth: 2,
        '&:hover': {
          borderWidth: 2,
          backgroundColor: 'primary.light',
          color: 'white'
        }
      }}
    >
      Saved Simulations
    </Button>
  </span>
</Tooltip>
```

- **Icon**: `ViewListIcon` from `@mui/icons-material/ViewList`
- **Navigation**: `/simulations` via `guardedNavigate` from `NavigationGuardContext`

---

## Design summary (reference)

### Visual hierarchy

- **Primary action**: "Start Simulation" (contained, prominent)
- **Secondary action**: "Saved Simulations" (outlined primary, list icon)
- **Tertiary action**: "Save Results" (outlined, conditional)

### Styling choices

- **Border radius**: `30px` (aligned with other simulation actions)
- **Font weight / size**: `600`, `16px`
- **Hover**: filled `primary.light` background with white text

---

## Alternative (more subtle)

If a lighter treatment is ever needed:

```javascript
<Button
  variant="text"
  startIcon={<ViewListIcon />}
  onClick={() => guardedNavigate('/simulations')}
  sx={{
    fontWeight: 600,
    px: 3,
    py: 1.5,
    borderRadius: '30px',
    fontSize: 16,
    color: 'primary.main',
    '&:hover': {
      backgroundColor: 'primary.light',
      color: 'white'
    }
  }}
>
  Saved Simulations
</Button>
```

---

## Acceptance criteria

1. **Icon**: List-style icon (`ViewListIcon`) — **met**
2. **Primary / blue styling**: Outlined primary — **met**
3. **Visual hierarchy**: Secondary to Start Simulation — **met**
4. **Consistency**: Matches surrounding button patterns — **met**
5. **Accessibility**: Tooltip + `aria-label` — **met**
6. **Functionality**: Navigates to `/simulations` with guard when applicable — **met**

## Maintenance notes

- Verify hover and focus states when changing theme or `primary` palette.
- `EditIcon` may still be imported in `Simulation.jsx` for other controls; only remove the import if unused project-wide.
