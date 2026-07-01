import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { Box } from '@mui/material';
import { PROFILE_DISPLAY_MODE } from '../../utils/profileSectionDisplay';

function modeToIndex(mode) {
  return mode === PROFILE_DISPLAY_MODE.NARRATIVE ? 1 : 0;
}

function indexToMode(index) {
  return index === 1 ? PROFILE_DISPLAY_MODE.NARRATIVE : PROFILE_DISPLAY_MODE.BULLETS;
}

function readScrollIndex(el) {
  if (!el || el.clientWidth === 0) return 0;
  return Math.min(Math.max(Math.round(el.scrollLeft / el.clientWidth), 0), 1);
}

const SCROLL_END_FALLBACK_MS = 120;

const SLIDE_CONTENT_SX = {
  bullets: {
    width: '100%',
    alignSelf: 'flex-start',
    '& ul': {
      margin: 0,
      paddingLeft: '1.25rem',
    },
    '& li': {
      marginBottom: '0.5rem',
      lineHeight: 1.45,
      '&:last-child': {
        marginBottom: 0,
      },
    },
  },
  narrative: {
    width: '100%',
    alignSelf: 'flex-start',
    lineHeight: 1.65,
    whiteSpace: 'pre-wrap',
  },
};

/**
 * Swipe between bullet answers and AI narrative (Home carousel pattern).
 * Falls back to bullets-only when no narrative exists.
 */
export default function ProfileSectionViewCarousel({
  mode,
  onChange,
  narrativeAvailable = false,
  bulletsLabel,
  narrativeLabel,
  ariaLabel,
  bulletsContent,
  narrativeContent,
}) {
  const scrollRef = useRef(null);
  const slideRefs = useRef([]);
  const heightsRef = useRef([0, 0]);
  const modeRef = useRef(mode);
  const onChangeRef = useRef(onChange);
  const activeIndexRef = useRef(modeToIndex(mode));
  const isScrollingRef = useRef(false);
  const initialSyncDoneRef = useRef(false);
  const [activeIndex, setActiveIndex] = useState(() => modeToIndex(mode));
  const [viewportHeightPx, setViewportHeightPx] = useState(null);

  modeRef.current = mode;
  onChangeRef.current = onChange;
  activeIndexRef.current = activeIndex;

  const measureSlides = useCallback(() => {
    heightsRef.current = [0, 1].map((_, index) => slideRefs.current[index]?.offsetHeight ?? 0);
  }, []);

  const applyViewportHeight = useCallback((heightPx) => {
    if (heightPx > 0) {
      setViewportHeightPx(heightPx);
    }
  }, []);

  const syncViewportToActive = useCallback(() => {
    measureSlides();
    applyViewportHeight(heightsRef.current[activeIndexRef.current] ?? 0);
  }, [applyViewportHeight, measureSlides]);

  const syncViewportToMax = useCallback(() => {
    measureSlides();
    applyViewportHeight(Math.max(...heightsRef.current, 0));
  }, [applyViewportHeight, measureSlides]);

  const scrollToIndex = useCallback((index, behavior = 'smooth') => {
    const el = scrollRef.current;
    if (!el || el.clientWidth === 0) return;
    const clamped = Math.min(Math.max(index, 0), 1);
    isScrollingRef.current = true;
    syncViewportToMax();
    el.scrollTo({ left: clamped * el.clientWidth, behavior });
    setActiveIndex(clamped);
    activeIndexRef.current = clamped;
  }, [syncViewportToMax]);

  const commitScrollPosition = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const nextIndex = readScrollIndex(el);
    setActiveIndex(nextIndex);
    activeIndexRef.current = nextIndex;
    isScrollingRef.current = false;
    measureSlides();
    applyViewportHeight(heightsRef.current[nextIndex] ?? 0);
    const nextMode = indexToMode(nextIndex);
    if (nextMode !== modeRef.current) {
      onChangeRef.current(nextMode);
    }
  }, [applyViewportHeight, measureSlides]);

  // Restore saved mode once; never re-sync scroll from parent during user swipes.
  useLayoutEffect(() => {
    if (!narrativeAvailable || initialSyncDoneRef.current) return undefined;

    const syncInitialScroll = () => {
      if (initialSyncDoneRef.current) return true;
      const el = scrollRef.current;
      if (!el || el.clientWidth === 0) return false;
      const targetIndex = modeToIndex(modeRef.current);
      el.scrollLeft = targetIndex * el.clientWidth;
      setActiveIndex(targetIndex);
      activeIndexRef.current = targetIndex;
      initialSyncDoneRef.current = true;
      measureSlides();
      applyViewportHeight(heightsRef.current[targetIndex] ?? 0);
      return true;
    };

    if (!syncInitialScroll()) {
      const frameId = requestAnimationFrame(() => {
        syncInitialScroll();
      });
      return () => cancelAnimationFrame(frameId);
    }
    return undefined;
  }, [narrativeAvailable, applyViewportHeight, measureSlides]);

  useLayoutEffect(() => {
    if (!narrativeAvailable) return undefined;
    syncViewportToActive();
    return undefined;
  }, [narrativeAvailable, syncViewportToActive]);

  useEffect(() => {
    if (!narrativeAvailable) return undefined;
    const observers = slideRefs.current.map((slide) => {
      if (!slide || typeof ResizeObserver === 'undefined') return null;
      const observer = new ResizeObserver(() => {
        if (isScrollingRef.current) {
          syncViewportToMax();
        } else {
          syncViewportToActive();
        }
      });
      observer.observe(slide);
      return observer;
    });

    return () => {
      observers.forEach((observer) => observer?.disconnect());
    };
  }, [narrativeAvailable, syncViewportToActive, syncViewportToMax]);

  useEffect(() => {
    if (!narrativeAvailable) return undefined;
    const el = scrollRef.current;
    if (!el) return undefined;

    let settleTimer = null;

    const supportsScrollEnd = 'onscrollend' in document.createElement('div');

    const onScroll = () => {
      const nextIndex = readScrollIndex(el);
      setActiveIndex(nextIndex);
      activeIndexRef.current = nextIndex;
      if (!isScrollingRef.current) {
        isScrollingRef.current = true;
        syncViewportToMax();
      }
      if (!supportsScrollEnd) {
        window.clearTimeout(settleTimer);
        settleTimer = window.setTimeout(commitScrollPosition, SCROLL_END_FALLBACK_MS);
      }
    };

    const onScrollEnd = () => {
      commitScrollPosition();
    };

    const onResize = () => {
      const nextIndex = readScrollIndex(el);
      el.scrollLeft = nextIndex * el.clientWidth;
      setActiveIndex(nextIndex);
      activeIndexRef.current = nextIndex;
      syncViewportToActive();
    };

    el.addEventListener('scroll', onScroll, { passive: true });
    if (supportsScrollEnd) {
      el.addEventListener('scrollend', onScrollEnd);
    }
    window.addEventListener('resize', onResize);

    return () => {
      el.removeEventListener('scroll', onScroll);
      if (supportsScrollEnd) {
        el.removeEventListener('scrollend', onScrollEnd);
      }
      window.removeEventListener('resize', onResize);
      window.clearTimeout(settleTimer);
    };
  }, [
    narrativeAvailable,
    commitScrollPosition,
    syncViewportToActive,
    syncViewportToMax,
  ]);

  if (!narrativeAvailable) {
    return <Box sx={SLIDE_CONTENT_SX.bullets}>{bulletsContent}</Box>;
  }

  const slides = [
    { id: 'bullets', label: bulletsLabel, content: bulletsContent, contentSx: SLIDE_CONTENT_SX.bullets },
    { id: 'narrative', label: narrativeLabel, content: narrativeContent, contentSx: SLIDE_CONTENT_SX.narrative },
  ];

  return (
    <Box
      component="section"
      aria-roledescription="carousel"
      aria-label={ariaLabel}
      sx={{ width: '100%', maxWidth: '100%', overflow: 'hidden' }}
    >
      <Box
        sx={{
          overflow: 'hidden',
          height: viewportHeightPx == null ? 'auto' : `${viewportHeightPx}px`,
          transition: 'height 0.22s ease',
        }}
      >
        <Box
          ref={scrollRef}
          sx={{
            display: 'flex',
            alignItems: 'flex-start',
            width: '100%',
            maxWidth: '100%',
            overflowX: 'auto',
            scrollSnapType: 'x mandatory',
            overscrollBehaviorX: 'contain',
            WebkitOverflowScrolling: 'touch',
            scrollbarWidth: 'none',
            '&::-webkit-scrollbar': { display: 'none' },
          }}
        >
          {slides.map((slide, index) => (
            <Box
              key={slide.id}
              id={`profile-section-view-${slide.id}`}
              role="group"
              aria-roledescription="slide"
              aria-label={slide.label}
              aria-hidden={index !== activeIndex}
              ref={(el) => {
                slideRefs.current[index] = el;
              }}
              sx={{
                flex: '0 0 100%',
                width: '100%',
                minWidth: 0,
                maxWidth: '100%',
                scrollSnapAlign: 'start',
                scrollSnapStop: 'always',
                boxSizing: 'border-box',
              }}
            >
              <Box sx={slide.contentSx}>
                {slide.content}
              </Box>
            </Box>
          ))}
        </Box>
      </Box>

      <Box
        role="tablist"
        aria-label={ariaLabel}
        sx={{
          display: 'flex',
          justifyContent: 'center',
          gap: 1,
          mt: 1.25,
        }}
      >
        {slides.map((slide, index) => (
          <Box
            key={slide.id}
            component="button"
            type="button"
            role="tab"
            aria-selected={index === activeIndex}
            aria-controls={`profile-section-view-${slide.id}`}
            aria-label={slide.label}
            title={slide.label}
            onClick={() => scrollToIndex(index)}
            sx={{
              width: index === activeIndex ? 20 : 8,
              height: 8,
              borderRadius: 4,
              border: 'none',
              p: 0,
              cursor: 'pointer',
              bgcolor: index === activeIndex ? 'primary.main' : 'action.disabledBackground',
              transition: 'width 0.2s ease, background-color 0.2s ease',
            }}
          />
        ))}
      </Box>
    </Box>
  );
}
