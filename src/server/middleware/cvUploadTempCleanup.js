const { unlinkCvUploadTempFile } = require('../config/cvUploadTempStorage');

/**
 * After multer disk storage: unlink temp file on response end unless persist moved it.
 */
function attachCvUploadTempCleanup(req, res, next) {
  const tempPath = req.file?.path;
  if (tempPath) {
    req.cvUploadTempPath = tempPath;
  }
  res.on('finish', () => {
    if (req.cvUploadTempConsumed || !req.cvUploadTempPath) return;
    unlinkCvUploadTempFile(req.cvUploadTempPath).catch(() => {});
  });
  return next();
}

module.exports = {
  attachCvUploadTempCleanup,
};
