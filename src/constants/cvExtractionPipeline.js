/**
 * CV extraction pipeline env knobs.
 * - CV_WORKER_STRUCTURED: `defer` (default) | `always` | `auto` (run structured in worker when identity/heuristics are thin)
 */

/** @returns {'defer'|'always'|'auto'} */
function readCvWorkerStructuredMode() {
  const raw = String(process.env.CV_WORKER_STRUCTURED || 'defer').toLowerCase().trim();
  if (raw === 'always') return 'always';
  if (raw === 'auto') return 'auto';
  return 'defer';
}

module.exports = {
  readCvWorkerStructuredMode,
};
