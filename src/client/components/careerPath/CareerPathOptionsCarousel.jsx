import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Box, Typography, useMediaQuery } from '@mui/material';
import { useTheme } from '@mui/material/styles';
import { useTranslation } from 'react-i18next';

/**
 * Horizontal swipe carousel for career path options (Home carousel pattern).
 * Slide titles sit above the swipe track so vertical page scroll moves the whole section.
 */
export default function CareerPathOptionsCarousel({ slides, renderSlide }) {
  const { t } = useTranslation('dashboard');
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
  const scrollRef = useRef(null);
  const sectionRef = useRef(null);
  const slideRefs = useRef([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [trackHeight, setTrackHeight] = useState(null);

  const updateActiveIndex = useCallback(() => {
    const el = scrollRef.current;
    if (!el || el.clientWidth === 0) return;
    const index = Math.round(el.scrollLeft / el.clientWidth);
    setActiveIndex(Math.min(Math.max(index, 0), slides.length - 1));
  }, [slides.length]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return undefined;
    updateActiveIndex();
    el.addEventListener('scroll', updateActiveIndex, { passive: true });
    window.addEventListener('resize', updateActiveIndex);
    return () => {
      el.removeEventListener('scroll', updateActiveIndex);
      window.removeEventListener('resize', updateActiveIndex);
    };
  }, [updateActiveIndex]);

  // On mobile, size the track to the active path only — otherwise a taller sibling path
  // leaves a large empty band before the next section (e.g. key skills).
  useLayoutEffect(() => {
    if (!isMobile) {
      setTrackHeight(null);
      return undefined;
    }

    const measure = () => {
      const slideEl = slideRefs.current[activeIndex];
      if (!slideEl) return;
      const nextHeight = slideEl.offsetHeight;
      if (nextHeight > 0) setTrackHeight(nextHeight);
    };

    measure();

    const slideEl = slideRefs.current[activeIndex];
    if (!slideEl || typeof ResizeObserver === 'undefined') return undefined;

    const observer = new ResizeObserver(measure);
    observer.observe(slideEl);
    return () => observer.disconnect();
  }, [activeIndex, isMobile, slides]);

  // Horizontal overflow containers capture wheel events even when they cannot scroll
  // vertically. Forward vertical wheel gestures to the page instead.
  useEffect(() => {
    const section = sectionRef.current;
    if (!section) return undefined;

    const onWheel = (event) => {
      const { deltaX, deltaY } = event;
      if (Math.abs(deltaY) <= Math.abs(deltaX)) return;

      event.preventDefault();
      window.scrollBy({ top: deltaY, left: 0, behavior: 'auto' });
    };

    section.addEventListener('wheel', onWheel, { passive: false, capture: true });
    return () => {
      section.removeEventListener('wheel', onWheel, { capture: true });
    };
  }, []);

  const scrollToIndex = (index) => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ left: index * el.clientWidth, behavior: 'smooth' });
    setActiveIndex(index);
  };

  if (!Array.isArray(slides) || slides.length === 0) return null;

  const activeSlide = slides[activeIndex] || slides[0];

  return (
    <Box
      ref={sectionRef}
      component="section"
      aria-roledescription="carousel"
      aria-labelledby="career-path-active-title"
      sx={{ width: '100%', maxWidth: '100%', overflowX: 'hidden' }}
    >
      <Box
        role="tablist"
        aria-label={t('careerPathPlanning.overview.pathsCarousel.dots')}
        sx={{
          display: 'flex',
          justifyContent: 'center',
          gap: 1,
          mb: 2,
        }}
      >
        {slides.map((slide, index) => (
          <Box
            key={slide.id}
            component="button"
            type="button"
            role="tab"
            aria-selected={index === activeIndex}
            aria-controls={`career-path-slide-${slide.id}`}
            aria-label={t('careerPathPlanning.overview.pathsCarousel.goToSlide', {
              index: index + 1,
              title: slide.title,
            })}
            title={slide.title}
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

      <Typography
        id="career-path-active-title"
        variant="h6"
        component="h3"
        aria-live="polite"
        sx={{ fontWeight: 700, mb: 1.5, px: 0.5 }}
      >
        {activeSlide.title}
      </Typography>

      <Box
        ref={scrollRef}
        sx={{
          display: 'flex',
          alignItems: 'flex-start',
          width: '100%',
          maxWidth: '100%',
          overflowX: 'auto',
          overflowY: 'clip',
          scrollSnapType: 'x mandatory',
          scrollBehavior: 'smooth',
          overscrollBehaviorX: 'contain',
          overscrollBehaviorY: 'none',
          WebkitOverflowScrolling: 'touch',
          scrollbarWidth: 'none',
          '&::-webkit-scrollbar': { display: 'none' },
          ...(isMobile && trackHeight
            ? {
                height: trackHeight,
                transition: 'height 0.2s ease',
              }
            : null),
        }}
      >
        {slides.map((slide, index) => (
          <Box
            key={slide.id}
            id={`career-path-slide-${slide.id}`}
            ref={(el) => {
              slideRefs.current[index] = el;
            }}
            role="group"
            aria-roledescription="slide"
            aria-label={t('careerPathPlanning.overview.pathsCarousel.slide', {
              current: index + 1,
              total: slides.length,
              title: slide.title,
            })}
            aria-hidden={index !== activeIndex}
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
            {renderSlide(slide, index)}
          </Box>
        ))}
      </Box>
    </Box>
  );
}
