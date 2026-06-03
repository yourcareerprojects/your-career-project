/** Message keys that trigger a deferred structured semantic retry after heuristic/timeout worker paths. */
const CV_POST_EXTRACTION_HEURISTIC_RETRY_MESSAGE_KEYS = new Set([
  'documentUpload.extraction.heuristicFallback',
  'documentUpload.extraction.aiTimeout',
]);

module.exports = {
  CV_POST_EXTRACTION_HEURISTIC_RETRY_MESSAGE_KEYS,
};
