const path = require('path');
const crypto = require('crypto');
const fs = require('fs').promises;

const ALLOWED_EXT = new Set(['.pdf', '.docx', '.doc', '.txt', '.jpg', '.jpeg', '.png']);
const INVALID_TYPE_MESSAGE = 'Invalid file type. Only PDF, DOCX, DOC, TXT, JPG, JPEG, and PNG files are allowed.';
const CONTENT_MISMATCH_MESSAGE = 'File content does not match an allowed type. Only PDF, DOCX, DOC, TXT, JPG, JPEG, and PNG are accepted.';
const TXT_MISMATCH_MESSAGE = 'File content does not match plain text. Only PDF, DOCX, DOC, TXT, JPG, JPEG, and PNG are accepted.';

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
 * Runs after multer.memoryStorage(): validates magic bytes / content, then writes under uploads/documents.
 */
async function persistValidatedDocumentUpload(req, res, next) {
  try {
    if (!req.file || !req.file.buffer) {
      return next();
    }
    validateDocumentBuffer(req.file);
    const uploadDir = path.join(__dirname, '../../uploads/documents');
    await fs.mkdir(uploadDir, { recursive: true });
    const stamp = Date.now();
    const rand = crypto.randomBytes(8).toString('hex');
    const ext = path.extname(req.file.originalname || '').toLowerCase();
    const filename = `${stamp}-${rand}${ext}`;
    const fullPath = path.join(uploadDir, filename);
    await fs.writeFile(fullPath, req.file.buffer);
    req.file.path = fullPath;
    req.file.filename = filename;
    req.file.destination = uploadDir;
    delete req.file.buffer;
    return next();
  } catch (err) {
    if (req.file && req.file.buffer) delete req.file.buffer;
    return res.status(400).json({
      message: err.message || 'Invalid file upload',
    });
  }
}

module.exports = {
  persistValidatedDocumentUpload,
  validateDocumentBuffer,
};
