/**
 * Scroll a profile page section to the top of the viewport, below the fixed app header.
 * Pair with `scrollMarginTop` on section containers for consistent offset.
 */
export function scrollProfileSectionIntoView(element) {
  if (!element || typeof element.scrollIntoView !== 'function') {
    return false;
  }
  element.scrollIntoView({ behavior: 'smooth', block: 'start' });
  return true;
}

/** Run scroll after React commits section edit / read-only layout changes. */
export function scheduleProfileSectionScroll(scrollFn) {
  if (typeof scrollFn !== 'function') return;
  if (typeof requestAnimationFrame === 'function') {
    requestAnimationFrame(() => requestAnimationFrame(scrollFn));
  } else {
    setTimeout(scrollFn, 0);
  }
}

/** `scroll-margin-top` for profile section papers (app bar + optional mobile action bar). */
export const profileSectionScrollMarginSx = {
  scrollMarginTop: { xs: '7.5rem', sm: '4.5rem' },
};
