const {
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
