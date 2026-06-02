const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const multer = require('multer');

/** Default: `/tmp/cv-uploads` on Linux (`os.tmpdir()` is usually `/tmp`). Override via env. */
const CV_UPLOAD_TEMP_DIR =
  process.env.CV_UPLOAD_TEMP_DIR || path.join(os.tmpdir(), 'cv-uploads');

const DOCUMENT_UPLOAD_FILE_SIZE_LIMIT = 10 * 1024 * 1024;

const DOCUMENT_UPLOAD_ALLOWED_MIMES = [
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/plain',
  'image/jpeg',
  'image/png',
];

function ensureCvUploadTempDirSync() {
  fs.mkdirSync(CV_UPLOAD_TEMP_DIR, { recursive: true });
}

const documentUploadDiskStorage = multer.diskStorage({
  destination(_req, _file, cb) {
    try {
      ensureCvUploadTempDirSync();
      cb(null, CV_UPLOAD_TEMP_DIR);
    } catch (err) {
      cb(err);
    }
  },
  filename(_req, file, cb) {
    const ext = path.extname(file.originalname || '').toLowerCase();
    const unique = `${Date.now()}-${crypto.randomBytes(8).toString('hex')}${ext}`;
    cb(null, unique);
  },
});

function documentUploadFileFilter(_req, file, cb) {
  if (DOCUMENT_UPLOAD_ALLOWED_MIMES.includes(file.mimetype)) {
    cb(null, true);
    return;
  }
  cb(
    new Error(
      'Invalid file type. Only PDF, DOCX, DOC, TXT, JPG, JPEG, and PNG files are allowed.'
    )
  );
}

function createDocumentUploadMulter() {
  return multer({
    storage: documentUploadDiskStorage,
    limits: { fileSize: DOCUMENT_UPLOAD_FILE_SIZE_LIMIT },
    fileFilter: documentUploadFileFilter,
  });
}

function isPathUnderCvUploadTemp(filePath) {
  if (!filePath) return false;
  const resolved = path.resolve(filePath);
  const tempRoot = path.resolve(CV_UPLOAD_TEMP_DIR);
  return resolved === tempRoot || resolved.startsWith(`${tempRoot}${path.sep}`);
}

/**
 * Remove a multer temp upload. Only deletes paths under {@link CV_UPLOAD_TEMP_DIR}.
 * @param {string} [filePath]
 */
async function unlinkCvUploadTempFile(filePath) {
  if (!filePath || !isPathUnderCvUploadTemp(filePath)) return;
  try {
    await fs.promises.unlink(path.resolve(filePath));
  } catch (err) {
    if (err && err.code === 'ENOENT') return;
    throw err;
  }
}

module.exports = {
  CV_UPLOAD_TEMP_DIR,
  DOCUMENT_UPLOAD_FILE_SIZE_LIMIT,
  DOCUMENT_UPLOAD_ALLOWED_MIMES,
  createDocumentUploadMulter,
  unlinkCvUploadTempFile,
  isPathUnderCvUploadTemp,
};
