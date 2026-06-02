/** DOM attribute marking a scroll target in the profile review dialog. */
const REVIEW_FIELD_ATTR = 'data-review-field';

function reviewFieldAnchorProps(fieldKey) {
  if (!fieldKey) return {};
  return { [REVIEW_FIELD_ATTR]: fieldKey };
}

/**
 * @param {string} fieldKey
 * @param {ParentNode | null | undefined} containerEl — DialogContent root; falls back to document
 */
function scrollToReviewField(fieldKey, containerEl = null) {
  if (!fieldKey || typeof fieldKey !== 'string') return false;
  const root =
    containerEl && typeof containerEl.querySelector === 'function' ? containerEl : document;
  const escaped =
    typeof CSS !== 'undefined' && typeof CSS.escape === 'function'
      ? CSS.escape(fieldKey)
      : fieldKey.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  const el = root.querySelector(`[${REVIEW_FIELD_ATTR}="${escaped}"]`);
  if (!el || typeof el.scrollIntoView !== 'function') return false;
  el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  return true;
}

/**
 * @param {string | string[]} fieldKeys — tried in order
 * @param {ParentNode | null | undefined} containerEl
 */
function scrollToFirstReviewField(fieldKeys, containerEl = null) {
  const keys = (Array.isArray(fieldKeys) ? fieldKeys : [fieldKeys]).filter(Boolean);
  for (const key of keys) {
    if (scrollToReviewField(key, containerEl)) return true;
    const categoryKey = key.replace(/\.\d+$/, '');
    if (categoryKey !== key && scrollToReviewField(categoryKey, containerEl)) return true;
  }
  return false;
}

/** Prefer firstField, then remaining keys from fieldErrors (stable UI order from validator). */
function buildReviewFieldScrollQueue(firstField, fieldErrors = {}) {
  const keys = Object.keys(fieldErrors || {});
  if (!firstField) return keys;
  return [firstField, ...keys.filter((k) => k !== firstField)];
}

function firstEmptyUserIdentityFieldKey(userIdentity, identityFields = []) {
  for (const { key } of identityFields) {
    if (!String(userIdentity?.[key] || '').trim()) {
      return `userIdentity.${key}`;
    }
  }
  return null;
}

function firstEmptyFollowUpFieldKey(followUps, answers = {}) {
  if (!Array.isArray(followUps)) return null;
  for (const item of followUps) {
    const field = item?.field;
    if (!field) continue;
    if (!String(answers[field] || '').trim()) return field;
  }
  return null;
}

function seniorityReviewFieldKey(seniorityField) {
  return seniorityField ? `seniority.${seniorityField}` : null;
}

/**
 * Run scroll after React commits field errors / step changes in the dialog.
 * @param {() => void} scrollFn
 */
function scheduleReviewFieldScroll(scrollFn) {
  if (typeof scrollFn !== 'function') return;
  if (typeof requestAnimationFrame === 'function') {
    requestAnimationFrame(() => requestAnimationFrame(scrollFn));
  } else {
    setTimeout(scrollFn, 0);
  }
}

module.exports = {
  REVIEW_FIELD_ATTR,
  reviewFieldAnchorProps,
  scrollToReviewField,
  scrollToFirstReviewField,
  buildReviewFieldScrollQueue,
  firstEmptyUserIdentityFieldKey,
  firstEmptyFollowUpFieldKey,
  seniorityReviewFieldKey,
  scheduleReviewFieldScroll,
};
