import React from 'react';
import { Box, Stack } from '@mui/material';
import PuzzlePiece from './PuzzlePiece';
import PuzzleConnector from './PuzzleConnector';

/**
 * Vertical linear spine of placed pieces + optional empty tip slot.
 * @param {{
 *   nodes: Array,
 *   onTipSlotClick?: () => void,
 *   onPieceEditClick?: (node) => void,
 *   onPieceMoreClick?: (node) => void,
 *   onPieceRemoveClick?: (node) => void,
 *   removingInstanceId?: string|null,
 *   tipDropEnabled?: boolean,
 *   removeDragDisabled?: boolean,
 *   showTipSlot?: boolean,
 * }} props
 */
export default function PuzzleCanvas({
  nodes = [],
  onTipSlotClick,
  onPieceEditClick,
  onPieceMoreClick,
  onPieceRemoveClick,
  removingInstanceId = null,
  tipDropEnabled = true,
  removeDragDisabled = false,
  showTipSlot = true,
}) {
  const lastNode = nodes.length ? nodes[nodes.length - 1] : null;
  const removableInstanceId =
    lastNode && !lastNode.locked ? lastNode.instanceId : null;

  return (
    <Box
      sx={{
        width: '100%',
        maxWidth: 440,
        mx: 'auto',
        py: 1,
      }}
    >
      <Stack spacing={0} alignItems="stretch">
        {nodes.map((node, index) => (
          <React.Fragment key={node.instanceId}>
            {index > 0 ? <PuzzleConnector /> : null}
            <PuzzlePiece
              node={node}
              removable={node.instanceId === removableInstanceId}
              removeDragDisabled={removeDragDisabled}
              removePending={removingInstanceId === node.instanceId}
              onEditClick={
                node.locked && onPieceEditClick
                  ? () => onPieceEditClick(node)
                  : undefined
              }
              onMoreClick={
                !node.locked && onPieceMoreClick
                  ? () => onPieceMoreClick(node)
                  : undefined
              }
              onRemoveClick={
                !node.locked && onPieceRemoveClick
                  ? () => onPieceRemoveClick(node)
                  : undefined
              }
            />
          </React.Fragment>
        ))}
        {showTipSlot ? (
          <>
            {nodes.length > 0 ? <PuzzleConnector /> : null}
            <PuzzlePiece
              empty
              isTipSlot
              onClick={onTipSlotClick}
              dropEnabled={tipDropEnabled}
            />
          </>
        ) : null}
      </Stack>
    </Box>
  );
}
