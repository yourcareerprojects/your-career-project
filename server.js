const path = require('path');
const envFile = process.env.NODE_ENV === 'production' ? '.env.production' : '.env';
require('dotenv').config({ path: path.resolve(__dirname, envFile) });

const logger = require('./src/server/utils/logger');

const isProduction = process.env.NODE_ENV === 'production';

if (isProduction) {
  const productionRequiredEnv = ['JWT_SECRET', 'MONGODB_URI'];
  const missingProductionEnv = productionRequiredEnv.filter((key) => {
    const val = process.env[key];
    return val == null || String(val).trim() === '';
  });
  if (missingProductionEnv.length > 0) {
    logger.error('Production startup aborted: missing required environment variables', {
      missingKeys: missingProductionEnv,
    });
    process.exit(1);
  }

  if (process.env.OPENAI_API_KEY == null || String(process.env.OPENAI_API_KEY).trim() === '') {
    logger.warn('OPENAI_API_KEY is not set. AI-powered endpoints may fail until this env var is configured.');
  }
}

const jwtSecret = process.env.JWT_SECRET && String(process.env.JWT_SECRET).trim();
if (!jwtSecret) {
  console.error(
    'FATAL: JWT_SECRET is missing or empty. Copy env-template.txt to .env and set JWT_SECRET to a long random string (e.g. openssl rand -hex 32).'
  );
  process.exit(1);
}
process.env.JWT_SECRET = jwtSecret;
const express = require('express');
const fs = require('fs');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const multer = require('multer');
const rateLimit = require('express-rate-limit');
const connectDB = require('./config/database');
const languageResolutionMiddleware = require('./src/server/middleware/languageResolution');
const { corsOptions } = require('./src/server/config/corsOptions');

/** Separate limiters per prefix so quotas are not shared across route groups. Production only — see mounts below. */
function createAiHeavyRouteLimiter() {
  return rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 60,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many requests. Please try again later.' },
  });
}

// Initialize express app
const app = express();
const port = process.env.PORT || 3000;

// Connect to MongoDB
connectDB();

const publicRoot = path.join(__dirname, 'public');
const spaIndexPath = path.join(publicRoot, 'dist', 'index.html');

function sendSpaIndex(res) {
  if (!fs.existsSync(spaIndexPath)) {
    return res.status(503).type('html').send(
      '<!DOCTYPE html><html><head><meta charset="utf-8"><title>Setup required</title></head><body>' +
      '<p>The app is not built yet. Run <code>npm run build</code> and restart the server.</p>' +
      '</body></html>'
    );
  }
  return res.sendFile(spaIndexPath);
}

// Middleware (order: security headers → compression → CORS → parsers)
app.use(helmet());
app.use(compression());
app.use(cors(corsOptions));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

if (isProduction) {
  app.use((req, res, next) => {
    const started = Date.now();
    let safePath = req.originalUrl.split('?')[0];
    if (safePath.length > 512) safePath = safePath.slice(0, 512);
    res.on('finish', () => {
      logger.info('HTTP request completed', {
        method: req.method,
        path: safePath,
        statusCode: res.statusCode,
        durationMs: Date.now() - started,
      });
    });
    next();
  });
}

// --- API (before static + SPA so /api never returns HTML) ---
app.get('/api/health', (req, res) => {
  res.json({ ok: true, timestamp: new Date().toISOString() });
});

// Resolve request language once for all API routes.
app.use('/api', languageResolutionMiddleware);

if (isProduction) {
  app.use('/api/ai', createAiHeavyRouteLimiter());
  app.use('/api/embeddings', createAiHeavyRouteLimiter());
}

const authRoutes = require('./src/server/routes/auth');
app.use('/api/auth', authRoutes);
console.log('Auth routes mounted at /api/auth');

const profileRoutes = require('./src/server/routes/profile');
app.use('/api/profile', profileRoutes);
console.log('Profile routes mounted at /api/profile');

const documentRoutes = require('./src/server/routes/documents');
if (isProduction) {
  app.use('/api/documents', createAiHeavyRouteLimiter(), documentRoutes);
} else {
  app.use('/api/documents', documentRoutes);
}
console.log('Document routes mounted at /api/documents');

const occupationRoutes = require('./src/server/routes/occupations');
app.use('/api/occupations', occupationRoutes);
console.log('Occupation routes mounted at /api/occupations');

const shareRoutes = require('./src/server/routes/share');
app.use('/api/share', shareRoutes);
console.log('Share routes mounted at /api/share');

const jobAnalysisRoutes = require('./src/server/routes/jobAnalysis');
app.use('/api/job-analysis', jobAnalysisRoutes);
console.log('Job analysis routes mounted at /api/job-analysis');

// --- Static assets (no automatic public/index.html for GET /) ---
app.use(express.static(publicRoot, { index: false }));

const uploadsDir = path.join(__dirname, 'src/uploads');
const uploadSubDirs = ['documents', 'profile-pictures'];
fs.mkdirSync(uploadsDir, { recursive: true });
uploadSubDirs.forEach(subDir => fs.mkdirSync(path.join(uploadsDir, subDir), { recursive: true }));
app.use('/uploads', express.static(uploadsDir));

// --- Client-side routes: serve React app (same as webpack dev on :3001) ---
app.use((req, res, next) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return next();
  }
  if (req.path.startsWith('/api')) {
    return res.status(404).json({ error: 'Not found' });
  }
  if (req.path.startsWith('/uploads')) {
    return res.status(404).send('Not found');
  }
  return sendSpaIndex(res);
});

// Error handling middleware (must be last)
app.use((err, req, res, next) => {
    if (res.headersSent) {
        return next(err);
    }
    let status = Number(err.status || err.statusCode) || 500;
    if (err instanceof multer.MulterError) {
        status = err.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
    } else if (/^Invalid file type/i.test(String(err.message || ''))) {
        status = 400;
    }
    logger.error('Unhandled Express error', err);
    const body = isProduction
        ? { error: status >= 500 ? 'Internal server error' : 'Request could not be processed' }
        : { error: err.message || 'Internal server error' };
    res.status(status).json(body);
});

// Catch unhandled promise rejections (prevents ERR_EMPTY_RESPONSE from silent crashes)
process.on('unhandledRejection', (reason, _promise) => {
  if (reason instanceof Error) {
    logger.error('Unhandled promise rejection', reason);
  } else {
    logger.error('Unhandled promise rejection', {
      reasonPreview: String(reason).slice(0, 500),
    });
  }
});

// Start server
app.listen(port, () => {
    console.log(`Server is running at http://localhost:${port}`);
});
