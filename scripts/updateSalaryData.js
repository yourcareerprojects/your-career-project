const mongoose = require('mongoose');
const CareerPath = require('../src/server/models/CareerPath');

// Connect to MongoDB
mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/career-path-explorer', {
  useNewUrlParser: true,
  useUnifiedTopology: true,
});

/**
 * Deprecated:
 * Salary fields were removed from the job-role dataset due to low-quality heuristics.
 * This script is kept only to avoid confusion/broken references.
 */
async function updateSalaryData() {
  try {
    console.log('updateSalaryData is deprecated: salary fields were removed from CareerPath.');
  } catch (error) {
    console.error('Error updating salary data:', error);
  } finally {
    mongoose.connection.close();
  }
}

// Run the update if this script is executed directly
if (require.main === module) {
  updateSalaryData();
}

module.exports = { updateSalaryData };
