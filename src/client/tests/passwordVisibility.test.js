const {
  PASSWORD_AUTOFILL_ANIMATION,
  handlePasswordAutofillAnimation,
  handlePasswordVisibilityPointerDown,
  readPasswordInputValue,
  syncControlledPasswordInput,
  toggleControlledPasswordVisibility,
} = require('../utils/passwordVisibility');

describe('passwordVisibility utilities', () => {
  test('syncControlledPasswordInput updates only when value changes', () => {
    const setFormData = jest.fn((updater) => updater({ password: '' }));

    syncControlledPasswordInput('password', '', setFormData);
    expect(setFormData).toHaveBeenCalledTimes(1);
    expect(setFormData.mock.results[0].value).toEqual({ password: '' });

    setFormData.mockClear();
    syncControlledPasswordInput('password', 'Secret1!', setFormData);
    expect(setFormData.mock.results[0].value).toEqual({ password: 'Secret1!' });
  });

  test('readPasswordInputValue reads from input ref', () => {
    expect(readPasswordInputValue({ current: { value: 'Secret1!' } })).toBe('Secret1!');
    expect(readPasswordInputValue({ current: null })).toBe('');
  });

  test('handlePasswordVisibilityPointerDown prevents default', () => {
    const event = { preventDefault: jest.fn() };
    handlePasswordVisibilityPointerDown(event);
    expect(event.preventDefault).toHaveBeenCalledTimes(1);
  });

  test('handlePasswordAutofillAnimation syncs when animation matches', () => {
    const onSync = jest.fn();

    handlePasswordAutofillAnimation(
      {
        animationName: PASSWORD_AUTOFILL_ANIMATION,
        target: { name: 'password', value: 'Generated1!' },
      },
      onSync
    );

    expect(onSync).toHaveBeenCalledWith({
      target: { name: 'password', value: 'Generated1!' },
    });
  });

  test('toggleControlledPasswordVisibility syncs DOM value before toggling visibility', () => {
    const inputRef = { current: { value: 'Generated1!' } };
    const setFormData = jest.fn((updater) => updater({ password: '' }));
    const setShowPasswords = jest.fn((updater) => updater({ password: false }));

    toggleControlledPasswordVisibility({
      field: 'password',
      inputRef,
      setFormData,
      setShowPasswords,
    });

    expect(setFormData).toHaveBeenCalledTimes(1);
    expect(setFormData.mock.results[0].value).toEqual({ password: 'Generated1!' });
    expect(setShowPasswords).toHaveBeenCalledTimes(1);
    expect(setShowPasswords.mock.results[0].value).toEqual({ password: true });
  });
});
