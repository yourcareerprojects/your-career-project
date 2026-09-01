import React from 'react';
import {
  Box,
  Chip,
  IconButton,
  Paper,
  Tooltip,
  Typography,
} from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import { useTranslation } from 'react-i18next';
import CareerPathOptionsCarousel from './CareerPathOptionsCarousel';

// Depth (in px) of the jigsaw knob that pokes out of one piece and into the next.
const PUZZLE_TAB = 26;

// Depth (in px) of the decorative knobs on the left/right edges. Slightly smaller than
// the vertical locking knobs since there is no horizontal neighbour to interlock with.
const SIDE_TAB = 18;

// Horizontal breathing room reserved around the column so outward side knobs are not clipped.
const SIDE_ROOM = Math.round(SIDE_TAB * 1.15) + 6;

// Stable hash so each piece's side-knob orientation is irregular but survives re-measures.
function hashSeed(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i += 1) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// Soft, distinguishable tints so each step reads as its own puzzle piece while the
// interlocking knobs make the sequence feel like a single connected jigsaw.
const PUZZLE_PIECE_COLORS = [
  { bg: '#EEF2FF', border: '#C7D2FE' },
  { bg: '#ECFEFF', border: '#A5F3FC' },
  { bg: '#F0FDF4', border: '#BBF7D0' },
  { bg: '#FEF9C3', border: '#FDE68A' },
  { bg: '#FCE7F3', border: '#FBCFE8' },
  { bg: '#F5F3FF', border: '#DDD6FE' },
];

/**
 * Builds an SVG path describing a real jigsaw piece of width `w` and body height `h`.
 * Every edge can carry a knob drawn with cubic beziers so its head is rounder and wider
 * than its neck — the classic locking silhouette:
 *   - top/bottom use the deep `t` knob so a bottom knob nests into the next piece's socket,
 *   - left/right use the shallower `ts` knob and can face outward or inward independently.
 * `leftDir`/`rightDir` are +1 (into the body -> socket) or -1 (out of the body -> knob).
 */
function buildPuzzlePath(w, h, { t, ts, topSocket, bottomKnob, leftDir, rightDir }) {
  const midX = w / 2;
  const midY = h / 2;
  const r = (v) => Math.round(v * 100) / 100;

  // Vertical (top/bottom) knob geometry.
  const neck = 0.5 * t;
  const head = 0.9 * t;
  const flare = 0.3 * t;
  const a1 = 0.1 * t;
  const a2 = 0.4 * t;
  const a3 = 0.7 * t;
  const a4 = 1.0 * t;
  const a5 = 1.15 * t;

  // Horizontal (left/right) knob geometry, clamped so short pieces keep clean corners.
  const te = Math.min(ts, h / 3);
  const sneck = 0.5 * te;
  const shead = 0.9 * te;
  const sflare = 0.3 * te;
  const b1 = 0.1 * te;
  const b2 = 0.4 * te;
  const b3 = 0.7 * te;
  const b4 = 1.0 * te;
  const b5 = 1.15 * te;

  const parts = ['M 0 0'];

  // TOP edge, left -> right. A socket dips DOWN into the body.
  if (topSocket) {
    parts.push(`L ${r(midX - neck)} 0`);
    parts.push(`C ${r(midX - neck - flare)} ${r(a1)}, ${r(midX - head)} ${r(a2)}, ${r(midX - head)} ${r(a3)}`);
    parts.push(`C ${r(midX - head)} ${r(a4)}, ${r(midX - neck)} ${r(a5)}, ${r(midX)} ${r(a5)}`);
    parts.push(`C ${r(midX + neck)} ${r(a5)}, ${r(midX + head)} ${r(a4)}, ${r(midX + head)} ${r(a3)}`);
    parts.push(`C ${r(midX + head)} ${r(a2)}, ${r(midX + neck + flare)} ${r(a1)}, ${r(midX + neck)} 0`);
  }
  parts.push(`L ${r(w)} 0`);

  // RIGHT edge, top -> bottom. dir +1 carves inward (socket), -1 bulges outward (knob).
  if (rightDir) {
    const d = rightDir;
    parts.push(`L ${r(w)} ${r(midY - sneck)}`);
    parts.push(`C ${r(w + d * b1)} ${r(midY - sneck - sflare)}, ${r(w + d * b2)} ${r(midY - shead)}, ${r(w + d * b3)} ${r(midY - shead)}`);
    parts.push(`C ${r(w + d * b4)} ${r(midY - shead)}, ${r(w + d * b5)} ${r(midY - sneck)}, ${r(w + d * b5)} ${r(midY)}`);
    parts.push(`C ${r(w + d * b5)} ${r(midY + sneck)}, ${r(w + d * b4)} ${r(midY + shead)}, ${r(w + d * b3)} ${r(midY + shead)}`);
    parts.push(`C ${r(w + d * b2)} ${r(midY + shead)}, ${r(w + d * b1)} ${r(midY + sneck + sflare)}, ${r(w)} ${r(midY + sneck)}`);
  }
  parts.push(`L ${r(w)} ${r(h)}`);

  // BOTTOM edge, right -> left. A knob bulges DOWN below the body.
  if (bottomKnob) {
    parts.push(`L ${r(midX + neck)} ${r(h)}`);
    parts.push(`C ${r(midX + neck + flare)} ${r(h + a1)}, ${r(midX + head)} ${r(h + a2)}, ${r(midX + head)} ${r(h + a3)}`);
    parts.push(`C ${r(midX + head)} ${r(h + a4)}, ${r(midX + neck)} ${r(h + a5)}, ${r(midX)} ${r(h + a5)}`);
    parts.push(`C ${r(midX - neck)} ${r(h + a5)}, ${r(midX - head)} ${r(h + a4)}, ${r(midX - head)} ${r(h + a3)}`);
    parts.push(`C ${r(midX - head)} ${r(h + a2)}, ${r(midX - neck - flare)} ${r(h + a1)}, ${r(midX - neck)} ${r(h)}`);
  }
  parts.push(`L 0 ${r(h)}`);

  // LEFT edge, bottom -> top. dir +1 carves inward (socket), -1 bulges outward (knob).
  if (leftDir) {
    const d = leftDir;
    parts.push(`L 0 ${r(midY + sneck)}`);
    parts.push(`C ${r(d * b1)} ${r(midY + sneck + sflare)}, ${r(d * b2)} ${r(midY + shead)}, ${r(d * b3)} ${r(midY + shead)}`);
    parts.push(`C ${r(d * b4)} ${r(midY + shead)}, ${r(d * b5)} ${r(midY + sneck)}, ${r(d * b5)} ${r(midY)}`);
    parts.push(`C ${r(d * b5)} ${r(midY - sneck)}, ${r(d * b4)} ${r(midY - shead)}, ${r(d * b3)} ${r(midY - shead)}`);
    parts.push(`C ${r(d * b2)} ${r(midY - shead)}, ${r(d * b1)} ${r(midY - sneck - sflare)}, 0 ${r(midY - sneck)}`);
  }
  parts.push('L 0 0');
  parts.push('Z');

  return parts.join(' ');
}

/**
 * A single jigsaw piece. Because each piece's height depends on its text, we measure the
 * rendered content and draw the exact outline behind it as an SVG whose knob overflows
 * into the piece below.
 */
function PuzzlePiece({ step, index, isFirst, isLast }) {
  const [size, setSize] = React.useState({ w: 0, h: 0 });
  const contentRef = React.useRef(null);

  React.useLayoutEffect(() => {
    const el = contentRef.current;
    if (!el) return undefined;
    const measure = () => setSize({ w: el.offsetWidth, h: el.offsetHeight });
    measure();
    let observer;
    if (typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(measure);
      observer.observe(el);
    }
    return () => {
      if (observer) observer.disconnect();
    };
  }, [step]);

  const topSocket = !isFirst;
  const bottomKnob = !isLast;
  const { border } = PUZZLE_PIECE_COLORS[index % PUZZLE_PIECE_COLORS.length];
  // Irregular but stable: two hash bits decide whether each side faces out or in.
  const seed = hashSeed(`${step.order}-${step.title}`);
  const leftDir = seed & 1 ? 1 : -1;
  const rightDir = seed & 2 ? 1 : -1;
  const path = size.w > 0
    ? buildPuzzlePath(size.w, size.h, {
      t: PUZZLE_TAB,
      ts: SIDE_TAB,
      topSocket,
      bottomKnob,
      leftDir,
      rightDir,
    })
    : '';
  // Reserve room so text never lands under a carved socket or a neighbour's knob.
  const tabPad = `${Math.round(PUZZLE_TAB * 1.15) + 18}px`;
  const sidePad = `${Math.round(SIDE_TAB * 1.15) + 12}px`;
  // Only reserve knob overflow for pieces that actually draw a bottom tab — otherwise
  // the last piece leaves a large empty band before the next section (esp. on mobile).
  const svgHeight = size.h + (bottomKnob ? Math.ceil(PUZZLE_TAB * 1.4) : 0);

  return (
    <Box
      sx={{
        position: 'relative',
        // Flush stacking (minus a hair) so each knob seats fully into the next socket.
        mt: isFirst ? 0 : '-1px',
        zIndex: index,
      }}
    >
      {path ? (
        <Box
          component="svg"
          width={size.w}
          height={svgHeight}
          sx={{
            position: 'absolute',
            top: 0,
            left: 0,
            overflow: 'visible',
            pointerEvents: 'none',
            filter: 'drop-shadow(0 4px 5px rgba(15, 23, 42, 0.18))',
          }}
        >
          <path d={path} fill="#ffffff" stroke={border} strokeWidth="2" strokeLinejoin="round" />
        </Box>
      ) : null}

      <Box
        ref={contentRef}
        sx={{
          position: 'relative',
          zIndex: 1,
          pt: topSocket ? tabPad : 2.5,
          pb: bottomKnob ? tabPad : 2.5,
          // Symmetric horizontal padding that grows on larger screens. The base value
          // stays big enough to clear any inward-facing side knob.
          pl: { xs: sidePad, sm: 5, md: 7, lg: 9 },
          pr: { xs: sidePad, sm: 5, md: 7, lg: 9 },
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'flex-start' }}>
          <Box sx={{ minWidth: 0 }}>
            <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', gap: 1 }}>
              <Typography component="span" variant="subtitle1" sx={{ fontWeight: 700, fontSize: '1.15rem' }}>
                {step.title}
              </Typography>
              {step.duration ? (
                <Typography component="span" variant="caption" color="text.secondary">
                  ({step.duration})
                </Typography>
              ) : null}
            </Box>
            {step.description ? (
              <Typography
                variant="body2"
                color="text.secondary"
                sx={{ mt: 0.5, whiteSpace: 'pre-line' }}
              >
                {step.description}
              </Typography>
            ) : null}
          </Box>
        </Box>
      </Box>
    </Box>
  );
}

/**
 * Renders a sequence of jigsaw puzzle pieces for a career path.
 */
function PathStepsVisualization({ steps }) {
  if (!Array.isArray(steps) || steps.length === 0) return null;

  return (
    <Box sx={{ px: `${SIDE_ROOM}px` }}>
      {steps.map((step, index) => (
        <PuzzlePiece
          key={`${step.order}-${step.title}`}
          step={step}
          index={index}
          isFirst={index === 0}
          isLast={index === steps.length - 1}
        />
      ))}
    </Box>
  );
}

/**
 * Overview of the AI career coach plan: intro, why it fits, path carousel, key skills.
 */
export default function CareerPathOverview({ pathPlan, roleTitle, onBack }) {
  const { t } = useTranslation('dashboard');
  if (!pathPlan) return null;

  const {
    headline,
    summary,
    introduction,
    whyThisPath,
    recommendedPath,
    alternativePaths = [],
    keySkills = [],
  } = pathPlan;

  const introText = String(introduction || '').trim();
  const whyText = String(whyThisPath || '').trim();

  const summaryParagraphs = (!introText && !whyText)
    ? String(summary || '')
      .split(/\n\n+/)
      .map((p) => p.trim())
      .filter(Boolean)
    : [];

  const pathSlides = React.useMemo(() => {
    const slides = [];
    const recommendedSteps = Array.isArray(recommendedPath?.steps) ? recommendedPath.steps : [];
    if (recommendedSteps.length > 0) {
      slides.push({
        id: 'recommended',
        title: t('careerPathPlanning.overview.recommendedPath'),
        steps: recommendedSteps,
      });
    }
    alternativePaths.forEach((alt, index) => {
      const steps = Array.isArray(alt.steps) ? alt.steps : [];
      if (steps.length >= 2) {
        slides.push({
          id: `alternative-${index}-${alt.title}`,
          title: alt.title,
          steps,
        });
      }
    });
    return slides;
  }, [alternativePaths, recommendedPath?.steps, t]);

  return (
    <Box>
      <Paper
        elevation={0}
        sx={{
          p: { xs: 2, sm: 3 },
          mb: 3,
          borderRadius: 2,
          bgcolor: 'primary.main',
          color: 'primary.contrastText',
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          {onBack ? (
            <Tooltip title={t('careerPathPlanning.actions.back')}>
              <IconButton
                onClick={onBack}
                aria-label={t('careerPathPlanning.actions.back')}
                sx={{
                  color: 'inherit',
                  '&:hover': { backgroundColor: 'rgba(255, 255, 255, 0.12)' },
                }}
              >
                <ArrowBackIcon />
              </IconButton>
            </Tooltip>
          ) : null}
          <Typography variant="h5" component="h2" sx={{ fontWeight: 700 }}>
            {headline}
          </Typography>
        </Box>
        <Typography variant="overline" sx={{ opacity: 0.9, display: 'block', mt: 0.5 }}>
          {roleTitle}
        </Typography>
      </Paper>

      {introText ? (
        <Box sx={{ mb: 3 }}>
          <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>
            {t('careerPathPlanning.overview.introduction')}
          </Typography>
          <Typography variant="body1" color="text.secondary" sx={{ lineHeight: 1.7 }}>
            {introText}
          </Typography>
        </Box>
      ) : null}

      {whyText ? (
        <Box sx={{ mb: 3 }}>
          <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>
            {t('careerPathPlanning.overview.whyThisPath')}
          </Typography>
          <Typography variant="body1" color="text.secondary" sx={{ lineHeight: 1.7 }}>
            {whyText}
          </Typography>
        </Box>
      ) : null}

      {summaryParagraphs.length > 0 ? (
        <Box sx={{ mb: 3 }}>
          {summaryParagraphs.map((paragraph) => (
            <Typography
              key={paragraph.slice(0, 48)}
              variant="body1"
              color="text.secondary"
              sx={{ mb: 1.5, lineHeight: 1.7 }}
            >
              {paragraph}
            </Typography>
          ))}
        </Box>
      ) : null}

      {pathSlides.length > 1 ? (
        <Box sx={{ mb: { xs: 1, sm: 3 } }}>
          <CareerPathOptionsCarousel
            slides={pathSlides}
            renderSlide={(slide) => (
              <PathStepsVisualization steps={slide.steps} />
            )}
          />
        </Box>
      ) : null}

      {pathSlides.length === 1 ? (
        <Box sx={{ mb: { xs: 1, sm: 3 } }}>
          <Typography variant="h6" component="h3" sx={{ fontWeight: 700, mb: 1.5 }}>
            {pathSlides[0].title}
          </Typography>
          <PathStepsVisualization steps={pathSlides[0].steps} />
        </Box>
      ) : null}

      {keySkills.length > 0 ? (
        <Box sx={{ mb: 3 }}>
          <Typography variant="h6" component="h3" sx={{ fontWeight: 700, mb: 1.5 }}>
            {t('careerPathPlanning.overview.keySkills')}
          </Typography>
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
            {keySkills.map((skill) => (
              <Chip key={skill} label={skill} size="small" variant="outlined" />
            ))}
          </Box>
        </Box>
      ) : null}

    </Box>
  );
}
