const path = require('path');
const crypto = require('crypto');
const fs = require('fs').promises;

const { isPathUnderCvUploadTemp, unlinkCvUploadTempFile } = require('../config/cvUploadTempStorage');

const ALLOWED_EXT = new Set(['.pdf', '.docx', '.doc', '.txt', '.jpg', '.jpeg', '.png']);
const INVALID_TYPE_MESSAGE = 'Invalid file type. Only PDF, DOCX, DOC, TXT, JPG, JPEG, and PNG files are allowed.';
const CONTENT_MISMATCH_MESSAGE = 'File content does not match an allowed type. Only PDF, DOCX, DOC, TXT, JPG, JPEG, and PNG are accepted.';
const TXT_MISMATCH_MESSAGE = 'File content does not match plain text. Only PDF, DOCX, DOC, TXT, JPG, JPEG, and PNG are accepted.';

/** Max bytes read for magic-byte / text validation (not loaded into a persistent buffer on the request). */
const VALIDATION_READ_BYTES = 512 * 1024;

const MIME_BY_EXT = {
  '.pdf': ['application/pdf'],
  '.docx': ['application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
  '.doc': ['application/msword'],
  '.txt': ['text/plain'],
  '.jpg': ['image/jpeg'],
  '.jpeg': ['image/jpeg'],
  '.png': ['image/png'],
};

const OLE_MAGIC = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);

function isPdf(buf) {
  return buf.length >= 5 && buf.slice(0, 5).toString('latin1') === '%PDF-';
}

function isOleCompound(buf) {
  return buf.length >= 8 && buf.slice(0, 8).equals(OLE_MAGIC);
}

function isZipOk(buf) {
  return buf.length >= 4 && buf[0] === 0x50 && buf[1] === 0x4b && buf[2] === 0x03 && buf[3] === 0x04;
}

function isJpeg(buf) {
  return buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
}

function isPng(buf) {
  return (
    buf.length >= 8 &&
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47 &&
    buf[4] === 0x0d &&
    buf[5] === 0x0a &&
    buf[6] === 0x1a &&
    buf[7] === 0x0a
  );
}

/** DOCX is ZIP; distinguish from spreadsheets by typical OOXML paths in local headers. */
function zipSnippetLooksLikeDocx(buf) {
  const n = Math.min(buf.length, 24576);
  const head = buf.slice(0, n).toString('latin1');
  if (head.includes('xl/worksheets')) return false;
  return head.includes('word/') || head.includes('wordprocessingml.document');
}

/** Reject obvious binary gibberish for .txt uploads (UTF-8 text only). */
function looksLikeUtf8Text(buf) {
  let start = 0;
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) start = 3;
  const max = Math.min(buf.length, 512 * 1024);
  for (let i = start; i < max; i++) {
    const b = buf[i];
    if (b === 0) return false;
    if (b === 9 || b === 10 || b === 13) continue;
    if (b < 32) return false;
  }
  return buf.length > 0;
}

/**
 * @param {Buffer} buf
 * @param {{ originalname?: string, mimetype?: string }} file
 * @returns {string} normalized extension
 */
function validateDocumentBuffer(file) {
  const buf = file.buffer;
  if (!buf || !Buffer.isBuffer(buf)) {
    throw new Error('Invalid upload payload.');
  }
  const ext = path.extname(file.originalname || '').toLowerCase();
  if (!ALLOWED_EXT.has(ext)) {
    throw new Error(INVALID_TYPE_MESSAGE);
  }
  const allowedMimes = MIME_BY_EXT[ext];
  const mime = String(file.mimetype || '').toLowerCase();
  if (!allowedMimes.includes(mime)) {
    throw new Error(INVALID_TYPE_MESSAGE);
  }

  if (ext === '.pdf') {
    if (!isPdf(buf)) {
      throw new Error(CONTENT_MISMATCH_MESSAGE);
    }
    return ext;
  }
  if (ext === '.docx') {
    if (!isZipOk(buf) || !zipSnippetLooksLikeDocx(buf)) {
      throw new Error(CONTENT_MISMATCH_MESSAGE);
    }
    return ext;
  }
  if (ext === '.doc') {
    if (!isOleCompound(buf)) {
      throw new Error(CONTENT_MISMATCH_MESSAGE);
    }
    return ext;
  }
  if (ext === '.txt') {
    if (!looksLikeUtf8Text(buf)) {
      throw new Error(TXT_MISMATCH_MESSAGE);
    }
    return ext;
  }
  if (ext === '.jpg' || ext === '.jpeg') {
    if (!isJpeg(buf)) {
      throw new Error(CONTENT_MISMATCH_MESSAGE);
    }
    return ext;
  }
  if (ext === '.png') {
    if (!isPng(buf)) {
      throw new Error(CONTENT_MISMATCH_MESSAGE);
    }
    return ext;
  }
  throw new Error(INVALID_TYPE_MESSAGE);
}

/**
 * Read only the prefix needed for content validation.
 * @param {string} filePath
 * @returns {Promise<Buffer>}
 */
async function readValidationSnippet(filePath) {
  const handle = await fs.open(filePath, 'r');
  try {
    const stat = await handle.stat();
    const len = Math.min(stat.size, VALIDATION_READ_BYTES);
    if (len <= 0) {
      return Buffer.alloc(0);
    }
    const buf = Buffer.alloc(len);
    const { bytesRead } = await handle.read(buf, 0, len, 0);
    return bytesRead === len ? buf : buf.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

/**
 * Runs after multer disk temp storage: validates magic bytes from a prefix read, then moves to uploads/documents.
 */
async function persistValidatedDocumentUpload(req, res, next) {
  const tempPath = req.file?.path;
  if (!req.file || !tempPath) {
    return next();
  }

  try {
    const snippet = await readValidationSnippet(tempPath);
    validateDocumentBuffer({ ...req.file, buffer: snippet });

    const uploadDir = path.join(__dirname, '../../uploads/documents');
    await fs.mkdir(uploadDir, { recursive: true });
    const stamp = Date.now();
    const rand = crypto.randomBytes(8).toString('hex');
    const ext = path.extname(req.file.originalname || '').toLowerCase();
    const filename = `${stamp}-${rand}${ext}`;
    const fullPath = path.join(uploadDir, filename);

    await fs.rename(tempPath, fullPath);

    req.file.path = fullPath;
    req.file.filename = filename;
    req.file.destination = uploadDir;
    req.cvUploadTempConsumed = true;
    delete req.cvUploadTempPath;
    return next();
  } catch (err) {
    if (isPathUnderCvUploadTemp(tempPath)) {
      await unlinkCvUploadTempFile(tempPath).catch(() => {});
    }
    req.cvUploadTempConsumed = true;
    return res.status(400).json({
      message: err.message || 'Invalid file upload',
    });
  }
}

module.exports = {
  persistValidatedDocumentUpload,
  validateDocumentBuffer,
  readValidationSnippet,
};
