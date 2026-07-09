const SWIPE_ACTIVATION_PX = 14;
const SWIPE_COMMIT_RATIO = 0.28;
const SWIPE_COMMIT_MIN_PX = 72;
const SWIPE_EXIT_MS = 220;
const ROLE_EVAL_SCROLL_SELECTOR = '[data-role-eval-scroll]';

/**
 * Whether horizontal movement should take over from vertical scroll.
 */
function shouldCommitToHorizontalSwipe(deltaX, deltaY, activationPx = SWIPE_ACTIVATION_PX) {
  const absX = Math.abs(deltaX);
  const absY = Math.abs(deltaY);
  return absX >= activationPx && absX > absY * 1.25;
}

/**
 * Whether the gesture is clearly vertical and should fall back to native scroll.
 */
function shouldAbortForVerticalSwipe(deltaX, deltaY, activationPx = SWIPE_ACTIVATION_PX) {
  const absX = Math.abs(deltaX);
  const absY = Math.abs(deltaY);
  return absY >= activationPx && absY > absX * 1.25;
}

/**
 * Resolve swipe direction after release, or null when below threshold.
 */
function resolveSwipeCommitDirection(offsetX, containerWidth) {
  const threshold = Math.max(SWIPE_COMMIT_MIN_PX, containerWidth * SWIPE_COMMIT_RATIO);
  if (offsetX >= threshold) return 'right';
  if (offsetX <= -threshold) return 'left';
  return null;
}

module.exports = {
  SWIPE_ACTIVATION_PX,
  SWIPE_COMMIT_RATIO,
  SWIPE_COMMIT_MIN_PX,
  SWIPE_EXIT_MS,
  ROLE_EVAL_SCROLL_SELECTOR,
  shouldCommitToHorizontalSwipe,
  shouldAbortForVerticalSwipe,
  resolveSwipeCommitDirection,
};
