const mongoose = require('mongoose');

// MongoDB connection options
const options = {
    autoIndex: true, // Build indexes
    maxPoolSize: 10, // Maintain up to 10 socket connections
    serverSelectionTimeoutMS: 5000, // Keep trying to send operations for 5 seconds
    socketTimeoutMS: 45000, // Close sockets after 45 seconds of inactivity
    family: 4 // Use IPv4, skip trying IPv6
};

// Connection URI (you'll need to set this in your environment variables)
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/career-path-explorer';

const CONNECT_MAX_ATTEMPTS = Math.max(1, Number(process.env.MONGODB_CONNECT_ATTEMPTS) || 5);
const CONNECT_RETRY_MS = Math.max(250, Number(process.env.MONGODB_CONNECT_RETRY_MS) || 1500);

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function connectWithRetry() {
    let lastError = null;
    for (let attempt = 1; attempt <= CONNECT_MAX_ATTEMPTS; attempt += 1) {
        try {
            await mongoose.connect(MONGODB_URI, options);
            return;
        } catch (error) {
            lastError = error;
            console.error(
                `MongoDB connect attempt ${attempt}/${CONNECT_MAX_ATTEMPTS} failed:`,
                error.message
            );
            if (attempt < CONNECT_MAX_ATTEMPTS) {
                await sleep(CONNECT_RETRY_MS * attempt);
            }
        }
    }
    throw lastError || new Error('MongoDB connection failed');
}

// Connect to MongoDB
const connectDB = async () => {
    try {
        await connectWithRetry();
        console.log('MongoDB connected successfully');

        // Reconcile CareerPathPlan indexes: drops the obsolete {userId, escoId} unique
        // index so per-language plans ({userId, escoId, language}) are allowed.
        try {
            const CareerPathPlan = require('../src/server/models/CareerPathPlan');
            await CareerPathPlan.syncIndexes();
        } catch (indexErr) {
            console.warn('CareerPathPlan index sync skipped:', indexErr.message);
        }

        // Seed curated DACH Career Puzzle catalog (pieces + edges) once per boot.
        try {
            const {
                ensurePuzzleCatalogSeededOnce,
            } = require('../src/server/services/careerPuzzle/puzzleCatalogService');
            const seedResult = await ensurePuzzleCatalogSeededOnce();
            console.log(
                `Career Puzzle catalog ready (${seedResult.piecesUpserted} pieces, ${seedResult.edgesUpserted} edges)`
            );
        } catch (seedErr) {
            console.warn('Career Puzzle catalog seed skipped:', seedErr.message);
        }

        // Handle connection events
        mongoose.connection.on('error', err => {
            console.error('MongoDB connection error:', err.message);
        });

        mongoose.connection.on('disconnected', () => {
            console.log('MongoDB disconnected');
        });

        // Handle application termination
        process.on('SIGINT', async () => {
            await mongoose.connection.close();
            console.log('MongoDB connection closed through app termination');
            process.exit(0);
        });

    } catch (error) {
        console.error('Error connecting to MongoDB:', error.message);
        process.exit(1);
    }
};

module.exports = connectDB;
