const express = require('express');
const request = require('supertest');
const {
  DOCUMENT_ROUTE_IP_MAX,
  DOCUMENT_ROUTE_IP_WINDOW_MS,
  isDocumentHighFrequencyPollRequest,
  createDocumentRouteIpLimiter,
} = require('../middleware/documentRouteRateLimit');
const { getAdaptivePollDelayMs, getExtractionPollMaxDurationMs } = require('../../constants/cvExtractionTiming');

describe('documentRouteRateLimit', () => {
  describe('isDocumentHighFrequencyPollRequest', () => {
    const docId = '507f1f77bcf86cd799439011';

    test('matches GET extraction-status under /api/documents', () => {
      expect(
        isDocumentHighFrequencyPollRequest({
          method: 'GET',
          originalUrl: `/api/documents/${docId}/extraction-status?_ts=1`,
        })
      ).toBe(true);
    });

    test('does not match other document routes', () => {
      expect(
        isDocumentHighFrequencyPollRequest({
          method: 'GET',
          originalUrl: `/api/documents/${docId}`,
        })
      ).toBe(false);
      expect(
        isDocumentHighFrequencyPollRequest({
          method: 'POST',
          originalUrl: '/api/documents/upload',
        })
      ).toBe(false);
      expect(
        isDocumentHighFrequencyPollRequest({
          method: 'GET',
          originalUrl: `/api/documents/${docId}/download`,
        })
      ).toBe(false);
    });

    test('matches narrative-cache-status GET and POST', () => {
      expect(
        isDocumentHighFrequencyPollRequest({
          method: 'GET',
          originalUrl: `/api/documents/${docId}/narrative-cache-status?lang=en`,
        })
      ).toBe(true);
      expect(
        isDocumentHighFrequencyPollRequest({
          method: 'POST',
          originalUrl: `/api/documents/${docId}/narrative-cache-status`,
        })
      ).toBe(true);
    });

    test('does not match uploads or other mutating routes', () => {
      expect(
        isDocumentHighFrequencyPollRequest({
          method: 'POST',
          originalUrl: '/api/documents/upload',
        })
      ).toBe(false);
      expect(
        isDocumentHighFrequencyPollRequest({
          method: 'POST',
          originalUrl: `/api/documents/${docId}/retry-extraction`,
        })
      ).toBe(false);
    });
  });

  describe('createDocumentRouteIpLimiter', () => {
    function buildApp() {
      const app = express();
      app.set('trust proxy', 1);
      app.use('/api/documents', createDocumentRouteIpLimiter());
      app.get('/api/documents/:documentId/extraction-status', (req, res) => {
        res.json({ ok: true });
      });
      app.get('/api/documents/:documentId/narrative-cache-status', (req, res) => {
        res.json({ ok: true });
      });
      app.post('/api/documents/:documentId/narrative-cache-status', (req, res) => {
        res.json({ ok: true });
      });
      app.post('/api/documents/upload', (req, res) => {
        res.status(201).json({ ok: true });
      });
      return app;
    }

    test('does not count extraction-status polls toward the IP cap', async () => {
      const app = buildApp();
      const docId = '507f1f77bcf86cd799439011';
      for (let i = 0; i < DOCUMENT_ROUTE_IP_MAX + 5; i += 1) {
        const res = await request(app).get(`/api/documents/${docId}/extraction-status`);
        expect(res.status).toBe(200);
      }
    });

    test('does not count narrative-cache-status polls toward the IP cap', async () => {
      const app = buildApp();
      const docId = '507f1f77bcf86cd799439011';
      for (let i = 0; i < DOCUMENT_ROUTE_IP_MAX + 5; i += 1) {
        const getRes = await request(app).get(`/api/documents/${docId}/narrative-cache-status`);
        expect(getRes.status).toBe(200);
        const postRes = await request(app)
          .post(`/api/documents/${docId}/narrative-cache-status`)
          .send({});
        expect(postRes.status).toBe(200);
      }
    });

    test('still rate-limits non-extraction-status document routes', async () => {
      const app = buildApp();
      for (let i = 0; i < DOCUMENT_ROUTE_IP_MAX; i += 1) {
        const res = await request(app).post('/api/documents/upload');
        expect(res.status).toBe(201);
      }
      const blocked = await request(app).post('/api/documents/upload');
      expect(blocked.status).toBe(429);
    });
  });

  describe('polling volume vs production cap', () => {
    /**
     * Simulates watchCvExtractionUntilTerminal delay schedule (min delays, no stall multiplier).
     */
    function estimatePollCountForSession(maxDurationMs) {
      let elapsedMs = 0;
      let polls = 0;
      while (elapsedMs < maxDurationMs) {
        polls += 1;
        const delay = getAdaptivePollDelayMs(elapsedMs);
        elapsedMs += delay;
      }
      return polls;
    }

    test('a full 15-minute extraction poll session exceeds the document IP cap without skip', () => {
      const maxDurationMs = getExtractionPollMaxDurationMs();
      const pollCount = estimatePollCountForSession(maxDurationMs);
      expect(pollCount).toBeGreaterThan(DOCUMENT_ROUTE_IP_MAX);
    });

    test('profile review-save narrative polling exceeds the document IP cap without skip', () => {
      const pollIntervalMs = 500;
      const inflightPollMs = 45_000;
      const pollCount = Math.ceil(inflightPollMs / pollIntervalMs);
      expect(pollCount).toBeGreaterThan(DOCUMENT_ROUTE_IP_MAX);
    });

    test('fast-phase polling alone can exceed the cap within three minutes', () => {
      let elapsedMs = 0;
      let polls = 0;
      const fastPhaseMs = 3 * 60 * 1000;
      while (elapsedMs < fastPhaseMs) {
        polls += 1;
        elapsedMs += 2000;
      }
      expect(polls).toBeGreaterThan(DOCUMENT_ROUTE_IP_MAX);
    });
  });
});

describe('documentRouteRateLimit constants', () => {
  test('production document IP window is 15 minutes', () => {
    expect(DOCUMENT_ROUTE_IP_WINDOW_MS).toBe(15 * 60 * 1000);
  });
});
