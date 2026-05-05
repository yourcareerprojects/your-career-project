'use strict';

/**
 * One-off: reset a user's profile / simulations / saves while keeping
 * name, email, password, and auth-related fields (tokens, accountStatus, security).
 *
 * Usage:
 *   node scripts/resetTestUserKeepAuth.js
 *     → defaults (Hans / test3@gmail.com / hardcoded id)
 *   node scripts/resetTestUserKeepAuth.js <userId> <email> <name>
 *     → DB user's email must match <email> before reset (case-insensitive).
 */

require('dotenv').config();
const mongoose = require('mongoose');

const DEFAULT_USER_ID = '69de5414d4b320e0ca92254f';
const DEFAULT_EXPECTED_EMAIL = 'test3@gmail.com';
const DEFAULT_TARGET_NAME = 'Hans';

function parseArgs() {
  const a = process.argv.slice(2);
  if (a.length === 0) {
    return {
      userId: DEFAULT_USER_ID,
      expectedEmail: DEFAULT_EXPECTED_EMAIL,
      targetName: DEFAULT_TARGET_NAME,
    };
  }
  if (a.length !== 3) {
    console.error(
      'Usage: node scripts/resetTestUserKeepAuth.js [<userId> <email> <name>]'
    );
    process.exit(1);
  }
  const [userId, email, name] = a;
  return {
    userId: userId.trim(),
    expectedEmail: email.trim().toLowerCase(),
    targetName: name.trim(),
  };
}

function emptyNarrative() {
  return {
    raw_items: [],
    summary_text: { original_language: 'en', original: null, translations: {} },
  };
}

function defaultProfile() {
  const nar = emptyNarrative();
  return {
    personalInfo: {},
    seniority: {
      currentStatus: '',
      yearsOfExperience: null,
      highestDegree: '',
      mostSeniorWorkExperience: '',
    },
    careerPreferences: {
      domains: [],
      workEnvironment: [],
      locationPreferences: [],
      salaryExpectations: {},
    },
    structuredUserInfo: {
      skillDomains: { ...nar },
      skills: { ...nar },
      skillsInDevelopment: { ...nar },
      keyResponsibilities: { ...nar },
      domains: { ...nar },
      excludedDerivedInferredIscoCodes: [],
    },
    userIdentityAnswers: {
      workEnjoyMost: '',
      topicsIndustriesInterest: '',
      naturallyGoodAt: '',
      workEnvironmentFit: '',
      workingLifeAchievement: '',
    },
    who_are_you: {
      raw_answers: [],
      summary_text: { original_language: 'en', original: null, translations: {} },
      identity_embedding_text: '',
    },
    documents: [],
    socialMedia: { linkedin: {} },
    careerSimulationInputs: {
      structuredUserInfo: {
        skillDomains: emptyNarrative(),
        skills: emptyNarrative(),
        skillsInDevelopment: emptyNarrative(),
        keyResponsibilities: emptyNarrative(),
        domains: emptyNarrative(),
        excludedDerivedInferredIscoCodes: [],
      },
      userIdentity: {
        workEnjoyMost: '',
        topicsIndustriesInterest: '',
        naturallyGoodAt: '',
        workEnvironmentFit: '',
        workingLifeAchievement: '',
      },
      seniority: {
        currentStatus: '',
        yearsOfExperience: null,
        highestDegree: '',
        mostSeniorWorkExperience: '',
      },
      embeddingOptimizedUserIdentityText: '',
      embeddingUserIdentitySourceFingerprint: '',
      documentEnrichment: {
        status: 'none',
        message: '',
        extractedSkills: [],
        extractedWorkExperience: [],
        extractedEducation: [],
        extractedCertifications: [],
        extractedProjects: [],
        sourceDocumentIds: [],
        lastParsedAt: null,
      },
      isManuallyEdited: false,
      editHistory: [],
    },
  };
}

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    throw new Error('MONGODB_URI is not set');
  }

  const { userId: userIdArg, expectedEmail: EXPECTED_EMAIL, targetName: TARGET_NAME } =
    parseArgs();
  const oid = new mongoose.Types.ObjectId(userIdArg);

  await mongoose.connect(uri);

  const User = require('../src/server/models/User');
  const SimulationTraitUsage = require('../src/server/models/SimulationTraitUsage');
  const RoleFitExplanation = require('../src/server/models/RoleFitExplanation');
  const SimulationPrioritizedItem = require('../src/server/models/SimulationPrioritizedItem');

  const user = await User.findById(oid).lean();
  if (!user) {
    console.error('User not found:', userIdArg);
    process.exitCode = 1;
    await mongoose.disconnect();
    return;
  }

  const dbEmail = String(user.email || '').toLowerCase();
  if (dbEmail !== EXPECTED_EMAIL) {
    console.error(
      `Refusing to reset: DB email "${user.email}" !== expected "${EXPECTED_EMAIL}".`
    );
    process.exitCode = 1;
    await mongoose.disconnect();
    return;
  }

  const [traitDel, explainDel, priorDel] = await Promise.all([
    SimulationTraitUsage.deleteMany({ userId: oid }),
    RoleFitExplanation.deleteMany({ userId: oid }),
    SimulationPrioritizedItem.deleteMany({ userId: oid }),
  ]);

  const authPreserve = {
    password: user.password,
    tokenVersion: user.tokenVersion,
    emailVerified: user.emailVerified,
    emailVerificationToken: user.emailVerificationToken,
    emailVerificationExpiresAt: user.emailVerificationExpiresAt,
    accountStatus: user.accountStatus,
    security: user.security,
  };

  const res = await User.updateOne(
    { _id: oid },
    {
      $set: {
        name: TARGET_NAME,
        email: EXPECTED_EMAIL,
        ...authPreserve,
        language: 'en',
        profile: defaultProfile(),
        lastSimulationResult: {
          results: null,
          selectedGoal: { en: null, de: null },
          date: null,
        },
        simulationResults: [],
        savedCareerSteps: [],
        updatedAt: new Date(),
      },
      $unset: { preferences: '' },
    }
  );

  console.log(JSON.stringify({
    matchedCount: res.matchedCount,
    modifiedCount: res.modifiedCount,
    deletedSimulationTraitUsage: traitDel.deletedCount,
    deletedRoleFitExplanation: explainDel.deletedCount,
    deletedSimulationPrioritizedItem: priorDel.deletedCount,
  }, null, 2));

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
  return mongoose.disconnect().catch(() => {});
});
