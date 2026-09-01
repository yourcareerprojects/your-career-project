import React, { useLayoutEffect, useRef, useState } from 'react';
import { Box } from '@mui/material';
import { getCategoryColor, getEmergingCategoryColor } from './identityVisuals';
import {
  PUZZLE_VIEWBOX,
  PUZZLE_OUTER_SCALE,
  buildPuzzlePiecePath,
  getPuzzleEdgesForTrait,
} from './identityPuzzleShape';
import { baseUILanguage } from '../../hooks/useProfileQueries';

/** Keep label inside the flat body, clear of knobs/sockets. */
const LABEL_SAFE_RATIO = 0.62;
const MIN_FONT_PX = 8;
const MAX_FONT_PX = 13.5;

function startingFontSizePx(name, bodySize) {
  const len = String(name || '').trim().length;
  let factor = 0.132;
  if (len > 28) factor = 0.09;
  else if (len > 22) factor = 0.1;
  else if (len > 16) factor = 0.11;
  else if (len > 11) factor = 0.12;
  return Math.max(MIN_FONT_PX, Math.min(MAX_FONT_PX, bodySize * factor));
}

/**
 * Puzzle-piece node representing an identity trait.
 * Confirmed pieces use bold category strokes; emerging pieces are thinner and muted.
 * Recently changed pieces get a category-colored pulse glow (one visit only).
 */
export default function IdentityNode({
  node,
  selected,
  recentlyChanged = false,
  onSelect,
  size = 96,
}) {
  const lang = baseUILanguage();
  const isEmerging = node.layer === 'emerging';
  const color = isEmerging
    ? getEmergingCategoryColor(node.category)
    : getCategoryColor(node.category);
  const accentColor = getCategoryColor(node.category);
  const showChangeGlow = Boolean(recentlyChanged) && !selected;
  const bodySize = Number.isFinite(node.layout?.bodySize)
    ? node.layout.bodySize
    : size;
  const outerSize = bodySize * PUZZLE_OUTER_SCALE;
  const labelBox = bodySize * LABEL_SAFE_RATIO;
  const left = node.layout?.leftPct;
  const top = node.layout?.topPct;
  const hasLayout = Number.isFinite(left) && Number.isFinite(top);
  const edges =
    node.layout?.edges ||
    getPuzzleEdgesForTrait(node.id || node.traitId || node.name);
  const path = buildPuzzlePiecePath(edges);
  const strokeWidth = selected || showChangeGlow ? 2.6 : isEmerging ? 1.55 : 2.35;
  const boxRef = useRef(null);
  const textRef = useRef(null);
  const [fontSize, setFontSize] = useState(() =>
    startingFontSizePx(node.name, bodySize)
  );

  useLayoutEffect(() => {
    const box = boxRef.current;
    const text = textRef.current;
    if (!box || !text || !hasLayout) return undefined;

    let next = startingFontSizePx(node.name, bodySize);
    text.style.fontSize = `${next}px`;

    const fits = () =>
      text.offsetHeight <= box.clientHeight + 0.5 &&
      text.scrollWidth <= box.clientWidth + 0.5;

    while (next > MIN_FONT_PX && !fits()) {
      next -= 0.35;
      text.style.fontSize = `${next}px`;
    }

    setFontSize(Math.round(next * 100) / 100);
    return undefined;
  }, [node.name, bodySize, labelBox, hasLayout, lang]);

  const layoutZ = Number.isFinite(node.layout?.zIndex)
    ? node.layout.zIndex
    : isEmerging
      ? 1
      : 2;
  const baseZ = selected ? 6 : showChangeGlow ? Math.max(layoutZ, 5) : layoutZ;

  const idleFilter = selected
    ? `drop-shadow(0 0 6px ${accentColor}66) drop-shadow(0 4px 10px rgba(20,28,40,0.12))`
    : showChangeGlow
      ? `drop-shadow(0 0 8px ${accentColor}99) drop-shadow(0 0 16px ${accentColor}55) drop-shadow(0 4px 10px rgba(20,28,40,0.12))`
      : isEmerging
        ? `drop-shadow(0 1px 4px ${color}22)`
        : `drop-shadow(0 3px 8px ${accentColor}40)`;

  return (
    <Box
      component="button"
      type="button"
      onClick={() => onSelect?.(node)}
      aria-pressed={selected}
      aria-label={node.name}
      title={node.name}
      data-recently-changed={showChangeGlow ? 'true' : undefined}
      sx={{
        position: 'absolute',
        left: hasLayout
          ? `${left}%`
          : `calc(50% + ${(node.position?.x || 0) * 42}%)`,
        top: hasLayout
          ? `${top}%`
          : `calc(50% + ${(node.position?.y || 0) * 42}%)`,
        transform: 'translate(-50%, -50%)',
        width: outerSize,
        height: outerSize,
        p: 0,
        m: 0,
        border: 'none',
        background: 'transparent',
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        visibility: hasLayout ? 'visible' : 'hidden',
        zIndex: baseZ,
        opacity: isEmerging ? 0.84 : 1,
        filter: idleFilter,
        transition:
          'transform 0.35s ease, filter 0.3s ease, opacity 0.3s ease, left 0.35s ease, top 0.35s ease',
        animation: showChangeGlow
          ? 'identityNodeIn 0.8s ease both, identityNodeChangedGlow 1.8s ease-in-out 0.8s infinite'
          : 'identityNodeIn 0.8s ease both',
        '@keyframes identityNodeIn': {
          from: { opacity: 0, transform: 'translate(-50%, -50%) scale(0.7)' },
          to: {
            opacity: isEmerging ? 0.84 : 1,
            transform: 'translate(-50%, -50%) scale(1)',
          },
        },
        '@keyframes identityNodeChangedGlow': {
          '0%, 100%': {
            filter: `drop-shadow(0 0 7px ${accentColor}88) drop-shadow(0 0 14px ${accentColor}44) drop-shadow(0 4px 10px rgba(20,28,40,0.12))`,
          },
          '50%': {
            filter: `drop-shadow(0 0 12px ${accentColor}cc) drop-shadow(0 0 22px ${accentColor}77) drop-shadow(0 4px 12px rgba(20,28,40,0.14))`,
          },
        },
        '&:hover': {
          zIndex: 7,
          opacity: 1,
          transform: 'translate(-50%, -50%) scale(1.04)',
          animation: 'identityNodeIn 0.8s ease both',
          filter: showChangeGlow
            ? `drop-shadow(0 0 10px ${accentColor}aa) drop-shadow(0 0 18px ${accentColor}66) drop-shadow(0 6px 12px rgba(20,28,40,0.14))`
            : `drop-shadow(0 0 6px ${accentColor}44) drop-shadow(0 6px 12px rgba(20,28,40,0.14))`,
        },
        '&:focus-visible': {
          outline: `2px solid ${accentColor}`,
          outlineOffset: 4,
          opacity: 1,
        },
      }}
    >
      <Box
        component="svg"
        viewBox={PUZZLE_VIEWBOX}
        aria-hidden
        sx={{
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          overflow: 'visible',
          pointerEvents: 'none',
        }}
      >
        <path
          d={path}
          fill="#ffffff"
          stroke={color}
          strokeWidth={strokeWidth}
          strokeLinejoin="round"
          strokeLinecap="round"
          strokeDasharray={isEmerging ? '3.5 3' : undefined}
          vectorEffect="non-scaling-stroke"
        />
      </Box>

      <Box
        ref={boxRef}
        sx={{
          position: 'relative',
          zIndex: 1,
          width: labelBox,
          height: labelBox,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          overflow: 'hidden',
          pointerEvents: 'none',
          px: 0.2,
        }}
      >
        <Box
          ref={textRef}
          component="span"
          lang={lang}
          sx={{
            color: isEmerging ? 'rgba(20,28,40,0.7)' : 'rgba(20,28,40,0.9)',
            fontWeight: isEmerging ? 600 : 700,
            textAlign: 'center',
            lineHeight: 1.1,
            fontSize: `${fontSize}px`,
            width: '100%',
            whiteSpace: 'normal',
            overflowWrap: 'break-word',
            wordBreak: 'normal',
            hyphens: 'auto',
            WebkitHyphens: 'auto',
            msHyphens: 'auto',
          }}
        >
          {node.name}
        </Box>
      </Box>
    </Box>
  );
}
