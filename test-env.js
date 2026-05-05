require('dotenv').config();

// Check required environment variables
const requiredEnvVars = [
  'MONGODB_URI',
  'PORT',
  'NODE_ENV',
  'SESSION_SECRET',
  'CORS_ORIGIN'
];

console.log('Checking environment variables...\n');

// Check if all required variables are present
const missingVars = requiredEnvVars.filter(varName => !process.env[varName]);

if (missingVars.length > 0) {
  console.error('❌ Missing required environment variables:');
  missingVars.forEach(varName => console.error(`   - ${varName}`));
  process.exit(1);
}

// Display the values (excluding sensitive data)
console.log('✅ All required environment variables are present:');
console.log(`MONGODB_URI: ${process.env.MONGODB_URI}`);
console.log(`PORT: ${process.env.PORT}`);
console.log(`NODE_ENV: ${process.env.NODE_ENV}`);
console.log(`CORS_ORIGIN: ${process.env.CORS_ORIGIN}`);
console.log(`SESSION_SECRET: ${process.env.SESSION_SECRET ? '✓ Set' : '✗ Not set'}`);

// Test MongoDB connection
const mongoose = require('mongoose');
console.log('\nTesting MongoDB connection...');

mongoose.connect(process.env.MONGODB_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true
})
.then(() => {
  console.log('✅ Successfully connected to MongoDB');
  mongoose.connection.close();
})
.catch(err => {
  console.error('❌ MongoDB connection error:', err.message);
  process.exit(1);
}); 