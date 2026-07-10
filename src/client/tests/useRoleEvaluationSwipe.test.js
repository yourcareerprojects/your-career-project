const {
  resolvePassiveGestureIntent,
  resolveSwipeCommitDirection,
  shouldCommitToHorizontalSwipe,
  shouldAbortForVerticalSwipe,
  SWIPE_COMMIT_MIN_PX,
} = require('../utils/roleEvaluationSwipeGestures');

describe('useRoleEvaluationSwipe helpers', () => {
  describe('shouldCommitToHorizontalSwipe', () => {
    it('requires horizontal dominance past activation threshold', () => {
      expect(shouldCommitToHorizontalSwipe(20, 4)).toBe(true);
      expect(shouldCommitToHorizontalSwipe(-18, 6)).toBe(true);
      expect(shouldCommitToHorizontalSwipe(10, 0)).toBe(false);
      expect(shouldCommitToHorizontalSwipe(20, 18)).toBe(false);
    });
  });

  describe('shouldAbortForVerticalSwipe', () => {
    it('defers to native scroll when vertical movement dominates', () => {
      expect(shouldAbortForVerticalSwipe(4, 20)).toBe(true);
      expect(shouldAbortForVerticalSwipe(6, -18)).toBe(true);
      expect(shouldAbortForVerticalSwipe(0, 10)).toBe(false);
      expect(shouldAbortForVerticalSwipe(18, 20)).toBe(false);
    });
  });

  describe('shouldPreferVerticalScroll', () => {
    it('defers to native scroll only with clear vertical dominance in scroll regions', () => {
      const {
        shouldPreferVerticalScroll,
      } = require('../utils/roleEvaluationSwipeGestures');
      const scrollEl = { scrollHeight: 400, clientHeight: 200 };
      expect(shouldPreferVerticalScroll(2, 8, scrollEl)).toBe(false);
      expect(shouldPreferVerticalScroll(4, 14, scrollEl)).toBe(true);
      expect(shouldPreferVerticalScroll(12, 8, scrollEl)).toBe(false);
      expect(shouldPreferVerticalScroll(2, 8, { scrollHeight: 200, clientHeight: 200 })).toBe(false);
    });
  });

  describe('resolvePassiveGestureIntent', () => {
    it('waits until movement passes activation', () => {
      expect(resolvePassiveGestureIntent(8, 2)).toBe('pending');
      expect(resolvePassiveGestureIntent(-6, 4)).toBe('pending');
    });

    it('locks to horizontal when horizontal movement dominates on touch arcs', () => {
      expect(resolvePassiveGestureIntent(24, 18, { preferTouch: true })).toBe('horizontal');
      expect(resolvePassiveGestureIntent(-30, 22, { preferTouch: true })).toBe('horizontal');
      expect(resolvePassiveGestureIntent(18, 16, { preferTouch: true })).toBe('horizontal');
    });

    it('defers to vertical scroll when vertical movement clearly dominates', () => {
      expect(resolvePassiveGestureIntent(8, 24, { preferTouch: true })).toBe('vertical');
      expect(resolvePassiveGestureIntent(12, 24, { preferTouch: true })).toBe('vertical');
    });

    it('defers inside marked scroll regions only for clear vertical movement', () => {
      const scrollEl = { scrollHeight: 400, clientHeight: 200 };
      expect(resolvePassiveGestureIntent(4, 14, { scrollEl })).toBe('vertical');
      expect(resolvePassiveGestureIntent(20, 8, { scrollEl, preferTouch: true })).toBe('horizontal');
    });
  });

  describe('resolveSwipeCommitDirection', () => {
    it('commits right swipe past threshold', () => {
      expect(resolveSwipeCommitDirection(90, 300)).toBe('right');
    });

    it('commits left swipe past threshold', () => {
      expect(resolveSwipeCommitDirection(-90, 300)).toBe('left');
    });

    it('returns null when below threshold', () => {
      expect(resolveSwipeCommitDirection(40, 300)).toBeNull();
      expect(resolveSwipeCommitDirection(-SWIPE_COMMIT_MIN_PX + 1, 1000)).toBeNull();
    });
  });
});
