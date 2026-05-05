const express = require('express');
const cors = require('cors');
const { corsOptions } = require('./config/corsOptions');

// Keep this file side-effect free:
// - no DB connections
// - no app.listen()
// It exists primarily for tests (supertest) and reuse.

const authRoutes = require('./routes/auth');
const occupationsRoutes = require('./routes/occupations');
const languageResolutionMiddleware = require('./middleware/languageResolution');

const app = express();

app.use(cors(corsOptions));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

app.use('/api', languageResolutionMiddleware);
app.use('/api/auth', authRoutes);
app.use('/api/occupations', occupationsRoutes);

module.exports = app;

