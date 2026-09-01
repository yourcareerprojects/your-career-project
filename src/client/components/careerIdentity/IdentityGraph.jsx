import React, { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Box, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';
import IdentityNode from './IdentityNode';
import { layoutIdentityBubbles } from './identityLayout';

const FALLBACK_GRAPH_SIZE = { width: 640, height: 480 };

/**
 * Living identity constellation — traits clustered by relatedness (and category fallback).
 */
export default function IdentityGraph({
  nodes = [],
  connections = [],
  selectedTraitId,
  changedTraitIds,
  onSelectTrait,
}) {
  const { t } = useTranslation('dashboard');
  const containerRef = useRef(null);
  const [size, setSize] = useState(FALLBACK_GRAPH_SIZE);

  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return undefined;

    const updateSize = () => {
      const rect = el.getBoundingClientRect();
      const width = Math.max(0, Math.round(rect.width));
      const height = Math.max(0, Math.round(rect.height));
      // Keep a usable layout size if the container briefly measures as 0×0
      // (e.g. during route transitions) so pieces never stay visibility:hidden.
      setSize({
        width: width > 0 ? width : FALLBACK_GRAPH_SIZE.width,
        height: height > 0 ? height : FALLBACK_GRAPH_SIZE.height,
      });
    };

    updateSize();
    const observer = new ResizeObserver(updateSize);
    observer.observe(el);
    return () => observer.disconnect();
  }, [nodes.length]);

  const layout = useMemo(
    () => layoutIdentityBubbles(nodes, size.width, size.height, connections),
    [nodes, connections, size.width, size.height]
  );

  const orderedNodes = useMemo(() => {
    // Emerging first so confirmed paint above in DOM order as well as z-index.
    return [...nodes].sort((a, b) => {
      const aEmerging = a.layer === 'emerging' ? 0 : 1;
      const bEmerging = b.layer === 'emerging' ? 0 : 1;
      return aEmerging - bEmerging;
    });
  }, [nodes]);

  if (!nodes.length) {
    return (
      <Box
        sx={{
          minHeight: 360,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          px: 4,
        }}
      >
        <Typography color="text.secondary" textAlign="center" sx={{ maxWidth: 420 }}>
          {t('careerIdentity.emptyGraph')}
        </Typography>
      </Box>
    );
  }

  return (
    <Box
      ref={containerRef}
      sx={{
        position: 'relative',
        width: '100%',
        height: { xs: 420, md: 500 },
        minHeight: { xs: 420, md: 500 },
      }}
    >
      {orderedNodes.map((node) => {
        const placed = layout.get(node.id);
        const laidOutNode = placed ? { ...node, layout: placed } : node;
        const recentlyChanged = Boolean(
          changedTraitIds?.has?.(node.id) || changedTraitIds?.includes?.(node.id)
        );
        return (
          <IdentityNode
            key={node.id}
            node={laidOutNode}
            selected={selectedTraitId === node.id}
            recentlyChanged={recentlyChanged}
            onSelect={onSelectTrait}
            size={placed?.baseSize}
          />
        );
      })}
    </Box>
  );
}
