const mongoose = require('mongoose');
const User = require('./src/server/models/User');

// Test database connection
async function testConnection() {
  try {
    console.log('Testing database connection...');
    
    // Try to connect to MongoDB
    const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/career-path-explorer';
    console.log('Connecting to:', MONGODB_URI);
    
    await mongoose.connect(MONGODB_URI, {
      autoIndex: true,
      maxPoolSize: 10,
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 45000,
      family: 4
    });
    
    console.log('✅ MongoDB connected successfully!');
    
    // Check for existing users
    console.log('\nChecking for existing users...');
    const existingUsers = await User.find({});
    console.log(`Found ${existingUsers.length} existing users:`);
    
    existingUsers.forEach((user, index) => {
      console.log(`${index + 1}. Email: ${user.email}`);
      if (user.profile?.personalInfo?.firstName) {
        console.log(`   Name: ${user.profile.personalInfo.firstName} ${user.profile.personalInfo.lastName}`);
      }
      if (user.profile?.documents?.length > 0) {
        console.log(`   Documents: ${user.profile.documents.length}`);
      }
      console.log(`   Created: ${user.createdAt}`);
      console.log('');
    });
    
    // Test creating a user
    console.log('Testing user creation...');
    const testUser = new User({
      email: 'test@example.com',
      password: 'testpassword123',
      profile: {
        personalInfo: {
          firstName: 'John',
          lastName: 'Doe',
          dateOfBirth: new Date('1990-01-01'),
          location: 'New York'
        },
        professionalInfo: {
          currentStatus: 'employed',
          currentPosition: 'Software Developer',
          currentCompany: 'Tech Corp',
          skills: [
            {
              name: 'JavaScript',
              level: 'advanced'
            },
            {
              name: 'React',
              level: 'intermediate'
            }
          ]
        },
        careerPreferences: {
          domains: ['Technology', 'Finance'],
          workEnvironment: ['Remote', 'Hybrid'],
          locationPreferences: ['New York', 'San Francisco'],
          salaryExpectations: {
            currency: 'USD',
            range: {
              min: 80000,
              max: 120000
            }
          },
          workLifeBalance: 'balanced'
        },
        documents: [
          {
            type: 'cv',
            name: 'John_Doe_CV.pdf',
            path: '/uploads/documents/test-cv.pdf',
            uploadDate: new Date(),
            isArchived: false,
            version: 1
          }
        ]
      }
    });
    
    await testUser.save();
    console.log('✅ Test user created successfully!');
    console.log('User ID:', testUser._id);
    
    // Test retrieving the user
    console.log('\nTesting user retrieval...');
    const retrievedUser = await User.findById(testUser._id);
    if (retrievedUser) {
      console.log('✅ User retrieved successfully!');
      console.log('Email:', retrievedUser.email);
      console.log('Name:', retrievedUser.profile.personalInfo.firstName, retrievedUser.profile.personalInfo.lastName);
      console.log('Position:', retrievedUser.profile.professionalInfo.currentPosition);
      console.log('Documents count:', retrievedUser.profile.documents.length);
    } else {
      console.log('❌ Failed to retrieve user');
    }
    
    // Clean up - delete test user
    console.log('\nCleaning up...');
    await User.findByIdAndDelete(testUser._id);
    console.log('✅ Test user deleted');
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    
    if (error.name === 'MongoNetworkError') {
      console.log('\n💡 MongoDB is not running. Please start MongoDB first.');
      console.log('You can install MongoDB from: https://www.mongodb.com/try/download/community');
      console.log('Or use MongoDB Atlas (cloud): https://www.mongodb.com/atlas');
    }
    
    if (error.name === 'MongoServerSelectionError') {
      console.log('\n💡 Cannot connect to MongoDB server.');
      console.log('Make sure MongoDB is running on localhost:27017');
    }
  } finally {
    await mongoose.disconnect();
    console.log('\nDatabase connection closed.');
  }
}

// Run the test
testConnection(); 