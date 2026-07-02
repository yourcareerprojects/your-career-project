import { useCallback, useEffect, useRef } from 'react';

/** @typedef {{ smooth?: boolean }} ScrollOptions */

const HIDDEN_SCROLLBAR_SX = {
  scrollbarWidth: 'none',
  msOverflowStyle: 'none',
  '&::-webkit-scrollbar': { display: 'none' },
};

/**
 * Keeps coaching chat scrolled to the latest message and input area (mobile-friendly).
 * @param {unknown[]} scrollDeps Values that should trigger a scroll (e.g. messages, loading).
 * @param {{ focusInputWhen?: boolean, layout?: 'dialog' | 'page' }} [options]
 *   `layout: 'page'` — embedded on the profile page (inner message scroll only; page position unchanged).
 */
export function useCoachingChatAutoScroll(scrollDeps = [], options = {}) {
  const { focusInputWhen = false, layout = 'dialog' } = options;
  const isPageLayout = layout === 'page';
  const messagesScrollRef = useRef(null);
  const messagesEndRef = useRef(null);
  const inputAreaRef = useRef(null);
  const inputRef = useRef(null);

  const focusInput = useCallback(() => {
    requestAnimationFrame(() => {
      const el = inputRef.current;
      if (!el || el.disabled) return;
      el.focus({ preventScroll: true });
    });
  }, []);

  /** @param {ScrollOptions} [options] */
  const scrollToBottom = useCallback((options = {}) => {
    const { smooth = true } = options;
    const behavior = smooth ? 'smooth' : 'auto';

    const run = () => {
      const scrollEl = messagesScrollRef.current;
      const innerOverflow = scrollEl && scrollEl.scrollHeight > scrollEl.clientHeight;

      if (innerOverflow && scrollEl) {
        scrollEl.scrollTo({ top: scrollEl.scrollHeight, behavior });
      }

      if (isPageLayout) return;

      // Keep the reply box visible inside the profile-fill dialog on mobile.
      inputAreaRef.current?.scrollIntoView({ behavior, block: 'end' });
      if (!innerOverflow) {
        messagesEndRef.current?.scrollIntoView({ behavior, block: 'end' });
      }
    };

    requestAnimationFrame(() => {
      requestAnimationFrame(run);
    });
  }, [isPageLayout]);

  useEffect(() => {
    scrollToBottom();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, scrollDeps);

  useEffect(() => {
    if (!focusInputWhen) return undefined;
    focusInput();
    return undefined;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusInputWhen, focusInput, ...scrollDeps]);

  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return undefined;
    let rafId = 0;

    const handleViewportChange = () => {
      if (rafId) return;
      rafId = requestAnimationFrame(() => {
        rafId = 0;
        scrollToBottom({ smooth: false });
      });
    };

    viewport.addEventListener('resize', handleViewportChange);
    viewport.addEventListener('scroll', handleViewportChange);
    return () => {
      if (rafId) cancelAnimationFrame(rafId);
      viewport.removeEventListener('resize', handleViewportChange);
      viewport.removeEventListener('scroll', handleViewportChange);
    };
  }, [scrollToBottom]);

  const messagesScrollSx = isPageLayout
    ? {
      ...coachingChatMessagesSx,
      ...coachingChatPageMessagesSx,
      overflowY: 'auto',
      ...HIDDEN_SCROLLBAR_SX,
    }
    : {
      ...coachingChatMessagesSx,
      ...coachingChatDialogMessagesSx,
      overflowY: {
        xs: 'auto',
        sm: 'visible',
      },
      ...HIDDEN_SCROLLBAR_SX,
    };

  return {
    messagesScrollRef,
    messagesEndRef,
    inputAreaRef,
    inputRef,
    messagesScrollSx,
    scrollToBottom,
    focusInput,
  };
}

export const coachingChatRootSx = {
  display: 'flex',
  flexDirection: 'column',
};

/** Profile page embed: flex child can shrink inside long page scroll. */
export const coachingChatPageRootSx = {
  minHeight: 0,
};

/**
 * Profile-fill dialog embed: cap total height so the reply box stays on screen while
 * messages scroll inside the flex column (dialog title/actions/intro sit above).
 */
export const coachingChatDialogRootSx = {
  maxHeight: { xs: 'calc(92dvh - 270px)', sm: 'none' },
  minHeight: { xs: 280, sm: 0 },
};

export const coachingChatMessagesSx = {
  mb: { xs: 0.5, sm: 2 },
  flex: { xs: '1 1 auto', sm: '0 0 auto' },
  minHeight: 0,
  maxHeight: { xs: 'min(50dvh, 360px)', sm: 'none' },
  WebkitOverflowScrolling: 'touch',
  overscrollBehavior: 'contain',
};

/** Dialog embed on mobile: messages fill remaining column height instead of a fixed cap. */
export const coachingChatDialogMessagesSx = {
  maxHeight: { xs: 'none', sm: 'none' },
  flex: { xs: '1 1 0', sm: '0 0 auto' },
};

/** Inner message scroll on profile page (all breakpoints). */
export const coachingChatPageMessagesSx = {
  maxHeight: { xs: 'min(50dvh, 360px)', sm: 'min(45vh, 420px)' },
  flex: '1 1 auto',
};

export const coachingChatInputAreaSx = {
  flexShrink: 0,
  pt: { xs: 0.75, sm: 0 },
  borderTop: { xs: '1px solid', sm: 'none' },
  borderColor: 'divider',
  bgcolor: 'background.paper',
};

/**
 * Debounces parent snapshot persistence so local chat updates do not force
 * expensive parent re-renders on every intermediate chat state transition.
 * @param {Function | undefined} onPersist
 * @param {unknown} snapshot
 * @param {number} [delayMs]
 */
export function useDebouncedCoachingPersist(onPersist, snapshot, delayMs = 180) {
  const latestPersistRef = useRef(onPersist);
  const latestSnapshotRef = useRef(snapshot);

  useEffect(() => {
    latestPersistRef.current = onPersist;
  }, [onPersist]);

  useEffect(() => {
    latestSnapshotRef.current = snapshot;
  }, [snapshot]);

  useEffect(() => {
    if (typeof onPersist !== 'function') return undefined;
    const timeoutId = window.setTimeout(() => {
      latestPersistRef.current?.(latestSnapshotRef.current);
    }, delayMs);
    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [onPersist, snapshot, delayMs]);
}
