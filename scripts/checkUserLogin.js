const mongoose = require('mongoose');
const User = require('../src/server/models/User');
require('dotenv').config();

async function checkUserLogin() {
  try {
    const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/career-path-explorer';
    console.log('Connecting to MongoDB...');
    await mongoose.connect(MONGODB_URI);
    console.log('✅ Connected to MongoDB\n');

    const email = 'test@gmail.com';
    console.log(`Checking user: ${email}\n`);

    // Find user
    const user = await User.findOne({ email });
    
    if (!user) {
      console.log('❌ User not found in database');
      console.log('\n💡 You may need to register this user first.');
      await mongoose.disconnect();
      return;
    }

    console.log('✅ User found!');
    console.log(`   User ID: ${user._id}`);
    console.log(`   Email: ${user.email}`);
    console.log(`   Has password: ${!!user.password}`);
    
    if (user.password) {
      console.log(`   Password hash length: ${user.password.length}`);
      console.log(`   Password hash starts with: ${user.password.substring(0, 10)}...`);
      console.log(`   Is valid bcrypt hash: ${user.password.startsWith('$2')}`);
      
      // Test password comparison
      console.log('\nTesting password comparison...');
      const testPasswords = ['Test123!@#', 'test123', 'password', 'Career5ucce$$'];
      
      for (const testPassword of testPasswords) {
        try {
          const result = await user.comparePassword(testPassword);
          console.log(`   Password "${testPassword}": ${result ? '✅ MATCH' : '❌ No match'}`);
        } catch (error) {
          console.log(`   Password "${testPassword}": ❌ ERROR - ${error.message}`);
        }
      }
    } else {
      console.log('❌ User has no password set!');
    }

    console.log(`\n   Account verified: ${user.accountStatus?.isVerified || false}`);
    console.log(`   Account active: ${user.accountStatus?.isActive !== false}`);
    console.log(`   Token version: ${user.tokenVersion || 0}`);

    await mongoose.disconnect();
    console.log('\n✅ Database connection closed.');
  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error(error.stack);
    await mongoose.disconnect();
  }
}

checkUserLogin();

