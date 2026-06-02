// Tests must not depend on a developer .env for JWT; server.js enforces JWT_SECRET at runtime.
if (!process.env.JWT_SECRET || !String(process.env.JWT_SECRET).trim()) {
  process.env.JWT_SECRET = 'test-only-jwt-secret-do-not-use-in-production';
}

const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const { resetEmailVerificationRateLimit } = require('../middleware/emailValidation');
const { resetRateLimitStoreForTests } = require('../services/rateLimit/createRateLimitStore');
const { resetRateLimitServiceForTests } = require('../services/rateLimit/RateLimitService');

let mongoServer;
let usingMemoryServer = false;

// Silence noisy logs during tests (opt-out with SHOW_TEST_LOGS=true)
const shouldMuteTestLogs = String(process.env.SHOW_TEST_LOGS || '').toLowerCase() !== 'true';
const originalConsole = {};

if (shouldMuteTestLogs) {
  beforeAll(() => {
    originalConsole.log = console.log;
    originalConsole.info = console.info;
    originalConsole.debug = console.debug;
    originalConsole.warn = console.warn;

    console.log = jest.fn();
    console.info = jest.fn();
    console.debug = jest.fn();
    console.warn = jest.fn();
  });

  afterAll(() => {
    if (originalConsole.log) console.log = originalConsole.log;
    if (originalConsole.info) console.info = originalConsole.info;
    if (originalConsole.debug) console.debug = originalConsole.debug;
    if (originalConsole.warn) console.warn = originalConsole.warn;
  });
}

// Prefer a local MongoDB for tests (fast, no binary download). If you want the
// in-memory server, set `USE_MEMORY_MONGODB=true` in your environment.
//
// NOTE: MongoMemoryServer may need to download a MongoDB binary on first run,
// which can be very slow on some networks.
jest.setTimeout(300000);

const tryConnectLocalMongo = async () => {
  const uri = process.env.MONGODB_TEST_URI || 'mongodb://127.0.0.1:27017/career-path-test';
  await mongoose.connect(uri, {
    serverSelectionTimeoutMS: 3000
  });
  return uri;
};

// Setup before all tests
beforeAll(async () => {
  const useMemory = String(process.env.USE_MEMORY_MONGODB || '').toLowerCase() === 'true';

  if (!useMemory) {
    try {
      await tryConnectLocalMongo();
      return;
    } catch (err) {
      // Fallback to in-memory Mongo so pure unit tests can run out-of-the-box.
      // NOTE: This may download a MongoDB binary on first run.
      const warn = [
        'Failed to connect to local MongoDB for tests; falling back to mongodb-memory-server.',
        'To force local Mongo, start it and/or set MONGODB_TEST_URI.',
        `Original error: ${err.message}`
      ].join(' ');
      // eslint-disable-next-line no-console
      console.warn(warn);
    }
  }

  usingMemoryServer = true;
  mongoServer = await MongoMemoryServer.create();
  const mongoUri = mongoServer.getUri();
  await mongoose.connect(mongoUri);
});

// Cleanup after all tests
afterAll(async () => {
  await mongoose.disconnect();
  if (usingMemoryServer && mongoServer) {
    await mongoServer.stop();
  }
});

// Clear database between tests
beforeEach(async () => {
  // Reset in-memory rate limit state between tests
  if (typeof resetEmailVerificationRateLimit === 'function') {
    resetEmailVerificationRateLimit();
  }
  resetRateLimitStoreForTests();
  resetRateLimitServiceForTests();

  // Some unit-only test suites don't establish a DB connection; guard accordingly.
  if (mongoose.connection && mongoose.connection.readyState === 1) {
    const collections = mongoose.connection.collections;
    for (const key in collections) {
      await collections[key].deleteMany();
    }
  }
});

// Mock nodemailer for email testing
jest.mock('nodemailer', () => ({
  createTransport: jest.fn().mockReturnValue({
    sendMail: jest.fn().mockResolvedValue({
      messageId: 'test-message-id'
    })
  }),
  // Used when the app falls back to test accounts
  createTestAccount: jest.fn().mockResolvedValue({
    user: 'test-user',
    pass: 'test-pass'
  }),
  getTestMessageUrl: jest.fn().mockReturnValue('https://example.test/message')
}));

// Mock DNS resolution for email domain testing
jest.mock('dns', () => ({
  promises: {
    resolveMx: jest.fn().mockImplementation((domain) => {
      if (domain === 'invalid.com') {
        return Promise.reject(new Error('No MX records'));
      }
      return Promise.resolve([{ exchange: 'mail.' + domain, priority: 10 }]);
    })
  }
})); 