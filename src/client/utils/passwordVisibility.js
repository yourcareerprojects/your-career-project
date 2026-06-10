/**
 * Mobile browsers (especially iOS strong-password suggestions) often autofill
 * password inputs without firing React onChange. A controlled input then keeps
 * value="" in state, so toggling visibility appears to do nothing until state
 * eventually syncs. Read the live DOM value before toggling to avoid that.
 */
export function syncControlledPasswordInput(name, value, setFormData) {
  setFormData((prev) => (prev[name] === value ? prev : { ...prev, [name]: value }));
}

/** Prevents the password field from blurring before the toggle click on mobile. */
export function handlePasswordVisibilityMouseDown(event) {
  event.preventDefault();
}

export function syncControlledPasswordValue(value, setValue) {
  setValue((prev) => (prev === value ? prev : value));
}
