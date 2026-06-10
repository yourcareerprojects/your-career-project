import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Box } from '@mui/material';
import HomeFeatureCard from './HomeFeatureCard';

const HomeFeaturesCarousel = ({ features }) => {
  const { t } = useTranslation('common');
  const scrollRef = useRef(null);
  const [activeIndex, setActiveIndex] = useState(0);

  const updateActiveIndex = useCallback(() => {
    const el = scrollRef.current;
    if (!el || el.clientWidth === 0) {
      return;
    }
    const index = Math.round(el.scrollLeft / el.clientWidth);
    setActiveIndex(Math.min(Math.max(index, 0), features.length - 1));
  }, [features.length]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) {
      return undefined;
    }
    updateActiveIndex();
    el.addEventListener('scroll', updateActiveIndex, { passive: true });
    window.addEventListener('resize', updateActiveIndex);
    return () => {
      el.removeEventListener('scroll', updateActiveIndex);
      window.removeEventListener('resize', updateActiveIndex);
    };
  }, [updateActiveIndex]);

  const scrollToIndex = (index) => {
    const el = scrollRef.current;
    if (!el) {
      return;
    }
    el.scrollTo({ left: index * el.clientWidth, behavior: 'smooth' });
    setActiveIndex(index);
  };

  return (
    <Box
      component="section"
      aria-roledescription="carousel"
      aria-label={t('home.features.carousel.region')}
      sx={{ width: '100%', maxWidth: '100%', overflow: 'hidden' }}
    >
      <Box
        ref={scrollRef}
        sx={{
          display: 'flex',
          width: '100%',
          maxWidth: '100%',
          overflowX: 'auto',
          scrollSnapType: 'x mandatory',
          scrollBehavior: 'smooth',
          WebkitOverflowScrolling: 'touch',
          scrollbarWidth: 'none',
          '&::-webkit-scrollbar': { display: 'none' },
        }}
      >
        {features.map((feature, index) => (
          <Box
            key={feature.title}
            id={`home-feature-slide-${index}`}
            role="group"
            aria-roledescription="slide"
            aria-label={t('home.features.carousel.slide', {
              current: index + 1,
              total: features.length,
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
            <HomeFeatureCard {...feature} />
          </Box>
        ))}
      </Box>

      <Box
        role="tablist"
        aria-label={t('home.features.carousel.dots')}
        sx={{
          display: 'flex',
          justifyContent: 'center',
          gap: 1,
          mt: 2,
        }}
      >
        {features.map((feature, index) => (
          <Box
            key={feature.title}
            component="button"
            type="button"
            role="tab"
            aria-selected={index === activeIndex}
            aria-controls={`home-feature-slide-${index}`}
            aria-label={t('home.features.carousel.goToSlide', { index: index + 1 })}
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
};

export default HomeFeaturesCarousel;
