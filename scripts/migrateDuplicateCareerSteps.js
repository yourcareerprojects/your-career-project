/**
 * Migration Script: Consolidate Duplicate Career Steps
 * 
 * This script identifies and consolidates duplicate career steps in the database.
 * It preserves the most recent save when consolidating duplicates.
 */

const mongoose = require('mongoose');
const User = require('../src/server/models/User');
const { generateStepId, generateResultStepId } = require('../src/client/utils/stepIdUtils');

// Database connection
const connectDB = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/career-path-explorer');
    console.log('Connected to MongoDB');
  } catch (error) {
    console.error('Database connection error:', error);
    process.exit(1);
  }
};

/**
 * Normalizes text for comparison
 */
const normalizeText = (text) => {
  if (!text) return '';
  return text
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[^\w\s]/g, '')
    .trim();
};

/**
 * Checks if two career steps are duplicates
 */
const areDuplicates = (step1, step2) => {
  // Exact stepId match
  if (step1.stepId === step2.stepId) {
    return { type: 'exact', confidence: 1.0 };
  }
  
  // Content-based matching
  const title1 = normalizeText(step1.title);
  const title2 = normalizeText(step2.title);
  const desc1 = normalizeText(step1.description || '');
  const desc2 = normalizeText(step2.description || '');
  
  // Same title and description
  if (title1 === title2 && desc1 === desc2) {
    return { type: 'content', confidence: 1.0 };
  }
  
  // Same title and simulation result ID
  if (title1 === title2 && 
      step1.simulationResultId === step2.simulationResultId &&
      step1.simulationResultId) {
    return { type: 'content', confidence: 0.9 };
  }
  
  // Similar titles (basic similarity check)
  if (title1 === title2 && 
      Math.abs((desc1.length - desc2.length) / Math.max(desc1.length, desc2.length, 1)) < 0.2) {
    return { type: 'semantic', confidence: 0.8 };
  }
  
  return null;
};

/**
 * Consolidates duplicate career steps for a user
 */
const consolidateUserDuplicates = async (user) => {
  const savedSteps = user.savedCareerSteps || [];
  const duplicates = [];
  const processed = new Set();
  
  console.log(`Processing user ${user.email} with ${savedSteps.length} saved steps`);
  
  // Find duplicates
  for (let i = 0; i < savedSteps.length; i++) {
    if (processed.has(i)) continue;
    
    const currentStep = savedSteps[i];
    const duplicateGroup = [currentStep];
    const duplicateIndices = [i];
    
    for (let j = i + 1; j < savedSteps.length; j++) {
      if (processed.has(j)) continue;
      
      const otherStep = savedSteps[j];
      const duplicateInfo = areDuplicates(currentStep, otherStep);
      
      if (duplicateInfo) {
        duplicateGroup.push(otherStep);
        duplicateIndices.push(j);
        processed.add(j);
      }
    }
    
    if (duplicateGroup.length > 1) {
      duplicates.push({
        group: duplicateGroup,
        indices: duplicateIndices,
        type: duplicateGroup[0].stepId === duplicateGroup[1].stepId ? 'exact' : 'content'
      });
    }
    
    processed.add(i);
  }
  
  if (duplicates.length === 0) {
    console.log(`No duplicates found for user ${user.email}`);
    return { duplicatesFound: 0, duplicatesRemoved: 0 };
  }
  
  console.log(`Found ${duplicates.length} duplicate groups for user ${user.email}`);
  
  // Consolidate duplicates
  let duplicatesRemoved = 0;
  const newSavedSteps = [...savedSteps];
  
  // Process duplicates in reverse order to maintain indices
  duplicates.sort((a, b) => b.indices[0] - a.indices[0]);
  
  for (const duplicate of duplicates) {
    const { group, indices } = duplicate;
    
    // Keep the most recent step (latest savedAt)
    const sortedGroup = group.sort((a, b) => new Date(b.savedAt) - new Date(a.savedAt));
    const keepStep = sortedGroup[0];
    const removeIndices = indices.slice(1); // Remove all except the first (most recent)
    
    console.log(`Consolidating ${group.length} duplicates for "${keepStep.title}"`);
    console.log(`Keeping step saved at: ${keepStep.savedAt}`);
    console.log(`Removing ${removeIndices.length} duplicates`);
    
    // Remove duplicate steps (in reverse order to maintain indices)
    removeIndices.sort((a, b) => b - a).forEach(index => {
      newSavedSteps.splice(index, 1);
      duplicatesRemoved++;
    });
  }
  
  // Update user with consolidated steps
  user.savedCareerSteps = newSavedSteps;
  await user.save();
  
  console.log(`Consolidated ${duplicates.length} duplicate groups, removed ${duplicatesRemoved} duplicates for user ${user.email}`);
  
  return { duplicatesFound: duplicates.length, duplicatesRemoved };
};

/**
 * Updates legacy stepIds to use new format
 */
const updateLegacyStepIds = async (user) => {
  const savedSteps = user.savedCareerSteps || [];
  let updatedCount = 0;
  
  for (const step of savedSteps) {
    // Check if it's a legacy stepId
    const isLegacy = step.stepId.includes(Date.now().toString().substring(0, 8)) ||
                    step.stepId.match(/^[a-z-]+-\d+$/) ||
                    step.stepId.match(/^[a-z-]+-\d+-[a-z0-9]+$/);
    
    if (isLegacy) {
      const oldStepId = step.stepId;
      
      // Generate new stepId based on content
      if (step.simulationResultId) {
        step.stepId = generateResultStepId(step.title, step.simulationResultId, step.simulationResultId);
      } else {
        // For steps without simulation context, use a generic format
        step.stepId = generateStepId(step.title, 'legacy', 'unknown', 0);
      }
      
      console.log(`Updated stepId for "${step.title}": ${oldStepId} -> ${step.stepId}`);
      updatedCount++;
    }
  }
  
  if (updatedCount > 0) {
    await user.save();
    console.log(`Updated ${updatedCount} legacy stepIds for user ${user.email}`);
  }
  
  return updatedCount;
};

/**
 * Main migration function
 */
const runMigration = async () => {
  try {
    await connectDB();
    
    console.log('Starting duplicate career steps migration...');
    
    const users = await User.find({ 'savedCareerSteps.0': { $exists: true } });
    console.log(`Found ${users.length} users with saved career steps`);
    
    let totalDuplicatesFound = 0;
    let totalDuplicatesRemoved = 0;
    let totalStepIdsUpdated = 0;
    
    for (const user of users) {
      try {
        // Update legacy stepIds first
        const stepIdsUpdated = await updateLegacyStepIds(user);
        totalStepIdsUpdated += stepIdsUpdated;
        
        // Consolidate duplicates
        const result = await consolidateUserDuplicates(user);
        totalDuplicatesFound += result.duplicatesFound;
        totalDuplicatesRemoved += result.duplicatesRemoved;
        
      } catch (error) {
        console.error(`Error processing user ${user.email}:`, error);
      }
    }
    
    console.log('\n=== Migration Summary ===');
    console.log(`Users processed: ${users.length}`);
    console.log(`Legacy stepIds updated: ${totalStepIdsUpdated}`);
    console.log(`Duplicate groups found: ${totalDuplicatesFound}`);
    console.log(`Duplicate steps removed: ${totalDuplicatesRemoved}`);
    console.log('Migration completed successfully!');
    
  } catch (error) {
    console.error('Migration failed:', error);
  } finally {
    await mongoose.disconnect();
    console.log('Disconnected from MongoDB');
    process.exit(0);
  }
};

// Run migration if called directly
if (require.main === module) {
  runMigration();
}

module.exports = {
  runMigration,
  consolidateUserDuplicates,
  updateLegacyStepIds,
  areDuplicates
};
