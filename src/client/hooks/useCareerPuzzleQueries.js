import { useMutation, useQuery } from 'react-query';
import { useMemo } from 'react';
import { queryClient } from '../queryClient';
import { baseUILanguage } from './useProfileQueries';

export const careerPuzzleQueryKey = ['career-puzzle'];

export function getCareerPuzzleQueryKeyFull(lang) {
  const resolved =
    lang != null && String(lang).trim() !== ''
      ? String(lang).toLowerCase().split('-')[0]
      : baseUILanguage();
  return [...careerPuzzleQueryKey, resolved];
}

function authHeaders() {
  const token = localStorage.getItem('token');
  if (!token) throw new Error('Not authenticated');
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
}

async function parseJson(response) {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.message || data.error || 'Request failed');
  }
  return data;
}

export async function fetchCareerPuzzle() {
  const lang = baseUILanguage();
  const response = await fetch(`/api/career-puzzle?lang=${encodeURIComponent(lang)}`, {
    headers: authHeaders(),
  });
  const data = await parseJson(response);
  return data.puzzle;
}

export async function fetchPuzzleNextSteps(pathId) {
  const params = new URLSearchParams();
  if (pathId) params.set('pathId', pathId);
  const qs = params.toString();
  const response = await fetch(`/api/career-puzzle/next-steps${qs ? `?${qs}` : ''}`, {
    headers: authHeaders(),
  });
  return parseJson(response);
}

export async function appendPuzzlePiece({ pieceId, pathId }) {
  const response = await fetch('/api/career-puzzle/pieces', {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ pieceId, pathId }),
  });
  const data = await parseJson(response);
  return data.puzzle;
}

export async function undoPuzzleTip({ pathId } = {}) {
  const params = new URLSearchParams();
  if (pathId) params.set('pathId', pathId);
  const qs = params.toString();
  const response = await fetch(`/api/career-puzzle/pieces/tip${qs ? `?${qs}` : ''}`, {
    method: 'DELETE',
    headers: authHeaders(),
  });
  const data = await parseJson(response);
  return data.puzzle;
}

export async function updatePuzzlePath({ pathId, title, isFavorite, setActive }) {
  const response = await fetch(`/api/career-puzzle/paths/${encodeURIComponent(pathId)}`, {
    method: 'PATCH',
    headers: authHeaders(),
    body: JSON.stringify({ title, isFavorite, setActive }),
  });
  const data = await parseJson(response);
  return data.puzzle;
}

export async function updatePuzzlePathNode({
  pathId,
  instanceId,
  category,
  title,
  shortDescription,
  endDate,
}) {
  const response = await fetch(
    `/api/career-puzzle/paths/${encodeURIComponent(pathId)}/nodes/${encodeURIComponent(instanceId)}`,
    {
      method: 'PATCH',
      headers: authHeaders(),
      body: JSON.stringify({ category, title, shortDescription, endDate }),
    }
  );
  const data = await parseJson(response);
  return data.puzzle;
}

export async function appendLockedPuzzleNode({
  pathId,
  category,
  title,
  shortDescription,
  endDate,
}) {
  const response = await fetch(
    `/api/career-puzzle/paths/${encodeURIComponent(pathId)}/nodes/locked`,
    {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ category, title, shortDescription, endDate }),
    }
  );
  const data = await parseJson(response);
  return data.puzzle;
}

export async function deleteLockedPuzzleNode({ pathId, instanceId }) {
  const response = await fetch(
    `/api/career-puzzle/paths/${encodeURIComponent(pathId)}/nodes/${encodeURIComponent(instanceId)}`,
    {
      method: 'DELETE',
      headers: authHeaders(),
    }
  );
  const data = await parseJson(response);
  return data.puzzle;
}

export async function savePuzzlePathAndReset({ pathId, title }) {
  const response = await fetch('/api/career-puzzle/paths/save', {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ pathId, title }),
  });
  const data = await parseJson(response);
  return data.puzzle;
}

export async function ensurePuzzleDraftPath() {
  const response = await fetch('/api/career-puzzle/paths/ensure-draft', {
    method: 'POST',
    headers: authHeaders(),
  });
  const data = await parseJson(response);
  return data.puzzle;
}

export async function fetchPuzzlePieceDetail(pieceId) {
  const response = await fetch(`/api/career-puzzle/pieces/${encodeURIComponent(pieceId)}`, {
    headers: authHeaders(),
  });
  return parseJson(response);
}

export function useCareerPuzzleQuery(options = {}) {
  const { enabled = true } = options;
  const lang = baseUILanguage();
  return useQuery(getCareerPuzzleQueryKeyFull(lang), fetchCareerPuzzle, {
    enabled,
    staleTime: 60 * 1000,
    retry: 1,
    refetchOnWindowFocus: false,
  });
}

export function usePuzzleNextStepsQuery(pathId, options = {}) {
  const { enabled = true } = options;
  return useQuery(
    ['career-puzzle', 'next-steps', pathId || 'active'],
    () => fetchPuzzleNextSteps(pathId),
    {
      enabled,
      staleTime: 30 * 1000,
      retry: 1,
      refetchOnWindowFocus: false,
    }
  );
}

function setPuzzleCache(puzzle) {
  queryClient.setQueryData(getCareerPuzzleQueryKeyFull(), puzzle);
  // Drop stale next-step options so category chips/options refetch against the new path tip.
  queryClient.removeQueries(['career-puzzle', 'next-steps']);
}

export function useAppendPuzzlePieceMutation() {
  return useMutation(appendPuzzlePiece, {
    onSuccess: (puzzle) => setPuzzleCache(puzzle),
  });
}

export function useUndoPuzzleTipMutation() {
  return useMutation(undoPuzzleTip, {
    onSuccess: (puzzle) => setPuzzleCache(puzzle),
  });
}

export function useUpdatePuzzlePathMutation() {
  return useMutation(updatePuzzlePath, {
    onSuccess: (puzzle) => setPuzzleCache(puzzle),
  });
}

export function useUpdatePuzzlePathNodeMutation() {
  return useMutation(updatePuzzlePathNode, {
    onSuccess: (puzzle) => setPuzzleCache(puzzle),
  });
}

export function useAppendLockedPuzzleNodeMutation() {
  return useMutation(appendLockedPuzzleNode, {
    onSuccess: (puzzle) => setPuzzleCache(puzzle),
  });
}

export function useDeleteLockedPuzzleNodeMutation() {
  return useMutation(deleteLockedPuzzleNode, {
    onSuccess: (puzzle) => setPuzzleCache(puzzle),
  });
}

export function useSavePuzzlePathAndResetMutation() {
  return useMutation(savePuzzlePathAndReset, {
    onSuccess: (puzzle) => setPuzzleCache(puzzle),
  });
}

export function useEnsurePuzzleDraftMutation() {
  return useMutation(ensurePuzzleDraftPath, {
    onSuccess: (puzzle) => setPuzzleCache(puzzle),
  });
}

/** Favorite paths from the career puzzle workspace, newest first. */
export function useSavedCareerPathsQuery(options = {}) {
  const puzzleQuery = useCareerPuzzleQuery(options);
  const savedPaths = useMemo(() => {
    const paths = Array.isArray(puzzleQuery.data?.paths) ? puzzleQuery.data.paths : [];
    return paths
      .filter((path) => Boolean(path?.isFavorite))
      .slice()
      .sort((a, b) => {
        const aTime = new Date(a.updatedAt || a.createdAt || 0).getTime();
        const bTime = new Date(b.updatedAt || b.createdAt || 0).getTime();
        return bTime - aTime;
      });
  }, [puzzleQuery.data?.paths]);

  return {
    ...puzzleQuery,
    data: savedPaths,
  };
}

/** Build a short default title from the tip (last) node of a path. */
export function deriveCareerPathTitle(path, lang, fallback = '') {
  const nodes = Array.isArray(path?.nodes) ? path.nodes : [];
  const tip = nodes.length ? nodes[nodes.length - 1] : null;
  const fromSnapshot = localizedPuzzleText(tip?.snapshot?.title, lang);
  const fromPiece = localizedPuzzleText(tip?.piece?.title, lang);
  return fromSnapshot || fromPiece || fallback || '';
}

export function usePuzzlePieceDetailQuery(pieceId, options = {}) {
  const { enabled = true } = options;
  return useQuery(
    ['career-puzzle', 'piece', pieceId],
    () => fetchPuzzlePieceDetail(pieceId),
    {
      enabled: Boolean(pieceId) && enabled,
      staleTime: 5 * 60 * 1000,
      retry: 1,
      refetchOnWindowFocus: false,
    }
  );
}

export function localizedPuzzleText(localized, lang) {
  if (!localized || typeof localized !== 'object') return '';
  const code = String(lang || 'en').toLowerCase().split('-')[0];
  return localized[code] || localized.en || localized.de || '';
}
