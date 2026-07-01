const User = require('../models/User');
const {
  computeProfileCompletion,
  MIN_SIMULATION_PROFILE_COMPLETION_PCT,
} = require('../controllers/profileController').__careerSimulationDepsForEngine;

module.exports = async (req, res, next) => {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const user = await User.findById(userId).select('profile');
    if (!user) {
      return res.status(401).json({ error: 'User not found' });
    }

    const overall = computeProfileCompletion(user.profile).overall;
    if (overall < MIN_SIMULATION_PROFILE_COMPLETION_PCT) {
      return res.status(403).json({
        error: 'Profile completion required',
        code: 'PROFILE_COMPLETION_REQUIRED',
        minRequired: MIN_SIMULATION_PROFILE_COMPLETION_PCT,
        current: overall,
      });
    }

    return next();
  } catch (error) {
    console.error('requireCompletedProfile middleware error:', error);
    return res.status(500).json({ error: 'Unable to verify profile completion' });
  }
};
