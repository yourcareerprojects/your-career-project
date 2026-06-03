jest.mock('../services/documents/documentProfileEnrichment', () => ({
  parseDocumentToTextWithMeta: jest.fn(),
}));

const CvExtractedTextCache = require('../models/CvExtractedTextCache');
const { parseDocumentToTextWithMeta } = require('../services/documents/documentProfileEnrichment');
const {
  upsertCvExtractedTextCache,
  getCachedCvExtractedText,
  deleteCvExtractedTextCacheForDocument,
  resolveCvDocumentPlainText,
  capPlainText,
} = require('../services/documents/cvExtractedTextCacheService');
const { CV_EXTRACTED_TEXT_MAX_BYTES } = require('../../constants/cvExtractedTextCache');
const User = require('../models/User');

describe('cvExtractedTextCacheService', () => {
  let userId;
  let documentId;

  beforeEach(async () => {
    jest.clearAllMocks();
    process.env.CV_REUSE_EXTRACTED_TEXT = 'true';
    const user = await User.create({
      name: 'Cache Tester',
      email: `cv-text-cache-${Date.now()}@example.com`,
      password: 'Test123!@#',
      emailVerified: true,
      accountStatus: { isVerified: true, isActive: true },
      profile: { documents: [] },
    });
    userId = user._id;
    user.profile.documents.push({
      type: 'resume',
      name: 'cv.pdf',
      path: 'uploads/cv.pdf',
      uploadDate: new Date(),
    });
    await user.save();
    documentId = user.profile.documents[0]._id;
  });

  afterEach(async () => {
    await CvExtractedTextCache.deleteMany({ userId });
    await User.deleteMany({ _id: userId });
  });

  test('upsert and get cached text by document', async () => {
    await upsertCvExtractedTextCache({
      userId,
      documentId,
      text: 'Jane Doe\nEngineer',
      source: 'pdf_text_layer',
      jobId: 'job-1',
    });

    const cached = await getCachedCvExtractedText(userId, documentId);
    expect(cached).toEqual({
      text: 'Jane Doe\nEngineer',
      source: 'pdf_text_layer',
      textLength: 'Jane Doe\nEngineer'.length,
    });
  });

  test('resolveCvDocumentPlainText returns cache without parsing', async () => {
    await upsertCvExtractedTextCache({
      userId,
      documentId,
      text: 'Cached CV body',
      source: 'pdf_ocr',
    });

    const resolved = await resolveCvDocumentPlainText({
      userId,
      documentId,
      filePath: '/tmp/should-not-read.pdf',
    });

    expect(resolved).toEqual({
      text: 'Cached CV body',
      fromCache: true,
      source: 'pdf_ocr',
    });
    expect(parseDocumentToTextWithMeta).not.toHaveBeenCalled();
  });

  test('resolveCvDocumentPlainText parses on cache miss', async () => {
    parseDocumentToTextWithMeta.mockResolvedValue({ text: 'Parsed body', source: 'docx' });

    const resolved = await resolveCvDocumentPlainText({
      userId,
      documentId,
      filePath: '/tmp/cv.docx',
    });

    expect(parseDocumentToTextWithMeta).toHaveBeenCalledWith('/tmp/cv.docx');
    expect(resolved).toEqual({
      text: 'Parsed body',
      fromCache: false,
      source: 'docx',
    });
  });

  test('deleteCvExtractedTextCacheForDocument removes row', async () => {
    await upsertCvExtractedTextCache({
      userId,
      documentId,
      text: 'To delete',
      source: 'txt',
    });

    await deleteCvExtractedTextCacheForDocument(userId, documentId);
    expect(await getCachedCvExtractedText(userId, documentId)).toBeNull();
  });

  test('capPlainText truncates oversized utf8', () => {
    const big = 'x'.repeat(CV_EXTRACTED_TEXT_MAX_BYTES + 500);
    const { text, truncated, textLength } = capPlainText(big);
    expect(truncated).toBe(true);
    expect(Buffer.byteLength(text, 'utf8')).toBeLessThanOrEqual(CV_EXTRACTED_TEXT_MAX_BYTES);
    expect(textLength).toBe(text.length);
  });
});
