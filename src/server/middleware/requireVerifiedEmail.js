const User = require('../models/User');

module.exports = async (req, res, next) => {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const user = await User.findById(userId).select('emailVerified accountStatus.isVerified');
    if (!user) {
      return res.status(401).json({ error: 'User not found' });
    }

    if (!(user.emailVerified || user.accountStatus?.isVerified)) {
      return res.status(403).json({
        error: 'Email verification required',
        code: 'EMAIL_VERIFICATION_REQUIRED'
      });
    }

    return next();
  } catch (error) {
    console.error('requireVerifiedEmail middleware error:', error);
    return res.status(500).json({ error: 'Unable to verify email status' });
  }
};
