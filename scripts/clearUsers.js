const mongoose = require('mongoose');
require('dotenv').config();

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/career-path-explorer';
console.log('clearUsers script MONGODB_URI:', MONGODB_URI);

async function clearUsers() {
  try {
    // Connect to MongoDB
    await mongoose.connect(MONGODB_URI);
    console.log('Connected to MongoDB');

    // Get all collections in the database
    const collections = await mongoose.connection.db.collections();
    console.log('Available collections:', collections.map(c => c.collectionName));

    const User = require('../src/server/models/User');
    
    // List existing users before deletion
    const existingUsers = await User.find({}, 'email');
    console.log('Existing users before deletion:', existingUsers.map(u => u.email));
    
    // Delete all users
    const result = await User.deleteMany({});
    console.log(`Deleted ${result.deletedCount} users`);
    
    // Verify no users remain
    const remainingUsers = await User.find({}, 'email');
    console.log('Remaining users after deletion:', remainingUsers.map(u => u.email));

    // Close the connection
    await mongoose.connection.close();
    console.log('MongoDB connection closed');
    
    process.exit(0);
  } catch (error) {
    console.error('Error:', error);
    if (mongoose.connection) {
      await mongoose.connection.close();
    }
    process.exit(1);
  }
}

clearUsers(); 