const mongoose = require('mongoose');
const User = require('../../server/models/User');

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/career-path-explorer';

async function listAllUsers() {
  try {
    await mongoose.connect(MONGODB_URI, { useNewUrlParser: true, useUnifiedTopology: true });
    const users = await User.find({}, 'email');
    if (users.length === 0) {
      console.log('No users found in the database.');
    } else {
      console.log('All users in the database:');
      users.forEach(user => {
        console.log(`- ${user.email}`);
      });
    }
    await mongoose.disconnect();
  } catch (error) {
    console.error('Error listing users:', error);
  }
}

listAllUsers(); 