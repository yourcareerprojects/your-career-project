import { useCallback, useEffect, useRef, useState } from 'react';

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
  const [messagesOverflowing, setMessagesOverflowing] = useState(false);

  const focusInput = useCallback(() => {
    requestAnimationFrame(() => {
      const el = inputRef.current;
      if (!el || el.disabled) return;
      el.focus({ preventScroll: true });
    });
  }, []);

  const updateOverflow = useCallback(() => {
    const el = messagesScrollRef.current;
    if (!el) return;
    setMessagesOverflowing(el.scrollHeight > el.clientHeight + 1);
  }, []);

  useEffect(() => {
    const el = messagesScrollRef.current;
    if (!el) return undefined;

    updateOverflow();

    const ro = new ResizeObserver(() => {
      updateOverflow();
    });
    ro.observe(el);

    return () => {
      ro.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, scrollDeps);

  /** @param {ScrollOptions} [options] */
  const scrollToBottom = useCallback((options = {}) => {
    const { smooth = true } = options;
    const behavior = smooth ? 'smooth' : 'auto';

    const run = () => {
      const scrollEl = messagesScrollRef.current;
      const innerScrollable = isPageLayout
        || (scrollEl && scrollEl.scrollHeight > scrollEl.clientHeight);

      if (innerScrollable && scrollEl) {
        scrollEl.scrollTo({ top: scrollEl.scrollHeight, behavior });
        return;
      }

      if (isPageLayout) return;

      messagesEndRef.current?.scrollIntoView({ behavior, block: 'end' });
      inputAreaRef.current?.scrollIntoView({ behavior, block: 'nearest' });
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

    const handleViewportChange = () => {
      scrollToBottom({ smooth: false });
    };

    viewport.addEventListener('resize', handleViewportChange);
    viewport.addEventListener('scroll', handleViewportChange);
    return () => {
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
      overflowY: {
        xs: messagesOverflowing ? 'auto' : 'hidden',
        sm: 'visible',
      },
      ...(messagesOverflowing ? HIDDEN_SCROLLBAR_SX : {}),
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

export const coachingChatMessagesSx = {
  mb: { xs: 0, sm: 2 },
  flex: { xs: '1 1 auto', sm: '0 0 auto' },
  minHeight: 0,
  maxHeight: { xs: 'min(50dvh, 360px)', sm: 'none' },
  WebkitOverflowScrolling: 'touch',
  overscrollBehavior: 'contain',
};

/** Inner message scroll on profile page (all breakpoints). */
export const coachingChatPageMessagesSx = {
  maxHeight: { xs: 'min(50dvh, 360px)', sm: 'min(45vh, 420px)' },
  flex: '1 1 auto',
};

export const coachingChatInputAreaSx = {
  flexShrink: 0,
  pt: { xs: 1.5, sm: 0 },
  borderTop: { xs: '1px solid', sm: 'none' },
  borderColor: 'divider',
};
