const express = require('express');
const request = require('supertest');
const {
  DOCUMENT_ROUTE_IP_MAX,
  DOCUMENT_ROUTE_IP_WINDOW_MS,
  isCvExtractionStatusPollRequest,
  createDocumentRouteIpLimiter,
} = require('../middleware/documentRouteRateLimit');
const { getAdaptivePollDelayMs, getExtractionPollMaxDurationMs } = require('../../constants/cvExtractionTiming');

describe('documentRouteRateLimit', () => {
  describe('isCvExtractionStatusPollRequest', () => {
    test('matches GET extraction-status under /api/documents', () => {
      expect(
        isCvExtractionStatusPollRequest({
          method: 'GET',
          originalUrl: '/api/documents/507f1f77bcf86cd799439011/extraction-status?_ts=1',
        })
      ).toBe(true);
    });

    test('does not match other document routes', () => {
      expect(
        isCvExtractionStatusPollRequest({
          method: 'GET',
          originalUrl: '/api/documents/507f1f77bcf86cd799439011',
        })
      ).toBe(false);
      expect(
        isCvExtractionStatusPollRequest({
          method: 'POST',
          originalUrl: '/api/documents/upload',
        })
      ).toBe(false);
      expect(
        isCvExtractionStatusPollRequest({
          method: 'GET',
          originalUrl: '/api/documents/507f1f77bcf86cd799439011/download',
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

    test('a full 15-minute poll session exceeds the document IP cap without skip', () => {
      const maxDurationMs = getExtractionPollMaxDurationMs();
      const pollCount = estimatePollCountForSession(maxDurationMs);
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
