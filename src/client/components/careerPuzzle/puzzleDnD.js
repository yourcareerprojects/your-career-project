/** Shared dnd-kit IDs for Career Puzzle tip-slot / remove drops. */
export const PUZZLE_TIP_DROPPABLE_ID = 'career-puzzle-tip-slot';
export const PUZZLE_REMOVE_DROPPABLE_ID = 'career-puzzle-remove-zone';

export function nextStepDragId(pieceId) {
  return `career-puzzle-next-${pieceId}`;
}

export function pathTipDragId(instanceId) {
  return `career-puzzle-path-tip-${instanceId}`;
}

/** Build a piece-shaped object for drag overlays from a path node. */
export function pieceFromPathNode(node) {
  if (!node) return null;
  return {
    id: node.pieceId,
    category: node.snapshot?.category || node.piece?.category || '',
    title: node.snapshot?.title || node.piece?.title,
    shortDescription:
      node.snapshot?.shortDescription || node.piece?.shortDescription || '',
  };
}
