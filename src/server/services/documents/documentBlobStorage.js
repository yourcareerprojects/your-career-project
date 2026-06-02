const fs = require('fs').promises;
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const DocumentBlob = require('../../models/DocumentBlob');

function shouldUseMongoStorage() {
  const raw = String(process.env.DOCUMENT_STORAGE_MODE || '').trim().toLowerCase();
  if (raw === 'mongo') return true;
  if (raw === 'local') return false;
  return process.env.NODE_ENV === 'production';
}

function safeExt(name) {
  return String(path.extname(name || '') || '').toLowerCase().slice(0, 16);
}

function createStorageKey() {
  return `${Date.now()}-${crypto.randomBytes(8).toString('hex')}`;
}

async function storeDocumentFromPath(file, opts = {}) {
  if (!shouldUseMongoStorage()) return null;
  const filePath = String(file?.path || '');
  if (!filePath) return null;
  const buffer = await fs.readFile(filePath);
  const storageKey = createStorageKey();
  const extension = safeExt(file.originalname || opts.originalName || '');
  const mimeType = String(file.mimetype || opts.mimeType || 'application/octet-stream');
  await DocumentBlob.create({
    storageKey,
    originalName: String(file.originalname || opts.originalName || ''),
    mimeType,
    extension,
    size: buffer.length,
    data: buffer,
  });
  return {
    storageProvider: 'mongo',
    storageKey,
    mimeType,
    extension,
    size: buffer.length,
  };
}

async function resolveDocumentToLocalPath(document) {
  const storageProvider = String(document?.storageProvider || '').toLowerCase();
  const storageKey = String(document?.storageKey || '').trim();
  if (storageProvider !== 'mongo' || !storageKey) {
    return { path: document?.path || '', cleanup: null };
  }
  const blob = await DocumentBlob.findOne({ storageKey }).lean();
  if (!blob || !blob.data) {
    const err = new Error('Document blob not found');
    err.code = 'ENOENT';
    throw err;
  }
  const ext = safeExt(blob.extension || document?.name || document?.path || '');
  const tmpPath = path.join(os.tmpdir(), `cv-blob-${storageKey}${ext}`);
  await fs.writeFile(tmpPath, blob.data);
  return {
    path: tmpPath,
    cleanup: async () => {
      await fs.unlink(tmpPath).catch(() => {});
    },
  };
}

async function sendStoredDocumentDownload(res, document) {
  const storageProvider = String(document?.storageProvider || '').toLowerCase();
  const storageKey = String(document?.storageKey || '').trim();
  if (storageProvider !== 'mongo' || !storageKey) {
    return false;
  }
  const blob = await DocumentBlob.findOne({ storageKey }).lean();
  if (!blob || !blob.data) return false;
  const fileName = String(document?.name || blob.originalName || 'document');
  res.setHeader('Content-Type', blob.mimeType || 'application/octet-stream');
  res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(fileName)}"`);
  res.send(blob.data);
  return true;
}

async function deleteStoredDocumentBlob(document) {
  const storageProvider = String(document?.storageProvider || '').toLowerCase();
  const storageKey = String(document?.storageKey || '').trim();
  if (storageProvider === 'mongo' && storageKey) {
    await DocumentBlob.deleteOne({ storageKey });
  }
}

module.exports = {
  shouldUseMongoStorage,
  storeDocumentFromPath,
  resolveDocumentToLocalPath,
  sendStoredDocumentDownload,
  deleteStoredDocumentBlob,
};
