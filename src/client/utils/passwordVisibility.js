const { flushSync } = require('react-dom');

/** WebKit fires this animation when autofill is applied to an input. */
const PASSWORD_AUTOFILL_ANIMATION = 'password-autofill-start';

/**
 * Mobile browsers (especially iOS strong-password suggestions) often autofill
 * password inputs without firing React onChange. A controlled input then keeps
 * value="" in state, so toggling visibility appears to do nothing until state
 * eventually syncs. Read the live DOM value before toggling to avoid that.
 *
 * Prefer uncontrolled password fields (defaultValue + inputRef) on registration
 * forms so native autofill values survive type toggles.
 */
function syncControlledPasswordInput(name, value, setFormData) {
  setFormData((prev) => (prev[name] === value ? prev : { ...prev, [name]: value }));
}

function syncControlledPasswordValue(value, setValue) {
  setValue((prev) => (prev === value ? prev : value));
}

/** Prevents the password field from blurring before the toggle click on mobile. */
function handlePasswordVisibilityPointerDown(event) {
  event.preventDefault();
}

/** @deprecated Use handlePasswordVisibilityPointerDown */
const handlePasswordVisibilityMouseDown = handlePasswordVisibilityPointerDown;

function readPasswordInputValue(inputRef) {
  return inputRef?.current?.value ?? '';
}

/**
 * Sync DOM value into React state, then flip visibility in a second commit so
 * controlled inputs re-render with the password before type switches to text.
 */
function toggleControlledPasswordVisibility({
  field,
  inputRef,
  setFormData,
  setShowPasswords,
}) {
  const el = inputRef?.current;
  if (el) {
    flushSync(() => {
      syncControlledPasswordInput(field, el.value, setFormData);
    });
  }
  setShowPasswords((prev) => ({ ...prev, [field]: !prev[field] }));
}

function handlePasswordAutofillAnimation(event, onSync) {
  if (event?.animationName !== PASSWORD_AUTOFILL_ANIMATION) {
    return;
  }
  const { name, value } = event.target || {};
  if (!name) {
    return;
  }
  onSync({ target: { name, value: value ?? '' } });
}

module.exports = {
  PASSWORD_AUTOFILL_ANIMATION,
  syncControlledPasswordInput,
  syncControlledPasswordValue,
  handlePasswordVisibilityPointerDown,
  handlePasswordVisibilityMouseDown,
  readPasswordInputValue,
  toggleControlledPasswordVisibility,
  handlePasswordAutofillAnimation,
};
