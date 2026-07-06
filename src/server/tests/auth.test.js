const request = require('supertest');
const app = require('../app'); // You'll need to export your Express app
const User = require('../models/User');
const crypto = require('crypto');

describe('Authentication System Tests', () => {
  // Note: DB connection + cleanup is handled by `src/server/tests/setup.js`

  describe('Email Registration Tests', () => {
    test('should register with valid email and password', async () => {
      const res = await request(app)
        .post('/api/auth/register')
        .send({
          name: 'Test User',
          email: 'test@example.com',
          password: 'Test123!@#'
        });

      expect(res.status).toBe(201);
      expect(res.body).toHaveProperty('token');
      expect(res.body.user).toHaveProperty('email', 'test@example.com');
      expect(res.body.user).toHaveProperty('isVerified', false);
    });

    test('should reject disposable email domains', async () => {
      const res = await request(app)
        .post('/api/auth/register')
        .send({
          name: 'Test User',
          email: 'test@tempmail.com',
          password: 'Test123!@#'
        });

      expect(res.status).toBe(400);
      expect(res.body.errors).toBeDefined();
      expect(res.body.errors[0].msg).toContain('disposable email');
    });

    test('should accept email aliases for supported providers', async () => {
      const res = await request(app)
        .post('/api/auth/register')
        .send({
          name: 'Alias User',
          email: 'test+alias@gmail.com',
          password: 'Test123!@#'
        });

      expect(res.status).toBe(201);
      expect(res.body.user).toHaveProperty('email', 'test+alias@gmail.com');
    });

    test('should enforce rate limiting for verification attempts', async () => {
      // First registration
      const registerRes = await request(app)
        .post('/api/auth/register')
        .send({
          name: 'Test User',
          email: 'test@example.com',
          password: 'Test123!@#'
        });
      const authToken = registerRes.body.token;

      // Try to resend verification multiple times
      for (let i = 0; i < 4; i++) {
        const res = await request(app)
          .post('/api/auth/resend-verification')
          .set('Authorization', `Bearer ${authToken}`)
          .send({
            email: 'test@example.com'
          });

        if (i < 3) {
          expect(res.status).toBe(200);
        } else {
          expect(res.status).toBe(429);
          expect(res.body.error).toContain('Too many resend requests');
        }
      }
    });
  });

  describe('Email Verification Tests', () => {
    let verificationToken;

    beforeEach(async () => {
      // Register a new user and capture the verification token
      verificationToken = 'test-token';
      const verificationTokenHash = crypto
        .createHash('sha256')
        .update(verificationToken)
        .digest('hex');
      await User.create({
        email: 'test@example.com',
        password: 'Test123!@#',
        emailVerificationToken: verificationTokenHash,
        emailVerificationExpiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        accountStatus: {
          isVerified: false,
          verificationToken: verificationTokenHash,
          tokenExpiry: new Date(Date.now() + 24 * 60 * 60 * 1000)
        }
      });
    });

    test('should verify email with valid token via explicit POST request', async () => {
      const res = await request(app)
        .post('/api/auth/verify-email')
        .send({ token: verificationToken });

      expect(res.status).toBe(200);
      expect(res.body.state).toBe('verified');
      expect(res.body.message).toContain('verified successfully');
      expect(res.body.user).toBeDefined();
      expect(res.body.user.isVerified).toBe(true);

      // Verify user status in database
      const user = await User.findOne({ email: 'test@example.com' });
      expect(user.accountStatus.isVerified).toBe(true);
    });

    test('should return already_verified on repeated verification attempts with the same token', async () => {
      const firstRes = await request(app)
        .post('/api/auth/verify-email')
        .send({ token: verificationToken });

      expect(firstRes.status).toBe(200);
      expect(firstRes.body.state).toBe('verified');

      const secondRes = await request(app)
        .post('/api/auth/verify-email')
        .send({ token: verificationToken });

      expect(secondRes.status).toBe(200);
      expect(secondRes.body.state).toBe('already_verified');
      expect(secondRes.body.user).toBeDefined();
      expect(secondRes.body.user.isVerified).toBe(true);
    });

    test('should handle concurrent verification requests consistently', async () => {
      const [resA, resB] = await Promise.all([
        request(app).post('/api/auth/verify-email').send({ token: verificationToken }),
        request(app).post('/api/auth/verify-email').send({ token: verificationToken })
      ]);

      expect(resA.status).toBe(200);
      expect(resB.status).toBe(200);

      const states = [resA.body.state, resB.body.state].sort();
      expect(states).toEqual(['already_verified', 'verified']);

      const user = await User.findOne({ email: 'test@example.com' });
      expect(user.accountStatus.isVerified).toBe(true);
      expect(user.emailVerified).toBe(true);
    });

    test('should reject expired token', async () => {
      // Update token expiry to past
      await User.updateOne(
        { email: 'test@example.com' },
        {
          emailVerificationExpiresAt: new Date(Date.now() - 1000),
          'accountStatus.tokenExpiry': new Date(Date.now() - 1000),
        }
      );

      const res = await request(app)
        .post('/api/auth/verify-email')
        .send({ token: verificationToken });

      expect(res.status).toBe(400);
      expect(res.body.state).toBe('expired');
      expect(res.body.error).toContain('expired');
    });

    test('should return already_verified for a previously issued token after verification is complete', async () => {
      const oldToken = 'old-token';
      const currentToken = 'current-token';
      const oldTokenHash = crypto.createHash('sha256').update(oldToken).digest('hex');
      const currentTokenHash = crypto.createHash('sha256').update(currentToken).digest('hex');

      await User.create({
        email: 'verified@example.com',
        password: 'Test123!@#',
        emailVerified: true,
        emailVerificationToken: null,
        emailVerificationExpiresAt: null,
        accountStatus: {
          isVerified: true,
          verificationTokenHistory: [currentTokenHash, oldTokenHash]
        }
      });

      const res = await request(app)
        .post('/api/auth/verify-email')
        .send({ token: oldToken });

      expect(res.status).toBe(200);
      expect(res.body.state).toBe('already_verified');
      expect(res.body.user).toBeDefined();
      expect(res.body.user.email).toBe('verified@example.com');
      expect(res.body.user.isVerified).toBe(true);
    });

    test('should return invalid for superseded tokens when the user is not yet verified', async () => {
      const supersededToken = 'superseded-token';
      const currentToken = 'current-token';
      const supersededTokenHash = crypto.createHash('sha256').update(supersededToken).digest('hex');
      const currentTokenHash = crypto.createHash('sha256').update(currentToken).digest('hex');

      await User.create({
        email: 'pending@example.com',
        password: 'Test123!@#',
        emailVerified: false,
        emailVerificationToken: currentTokenHash,
        emailVerificationExpiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        accountStatus: {
          isVerified: false,
          verificationToken: currentTokenHash,
          tokenExpiry: new Date(Date.now() + 24 * 60 * 60 * 1000),
          verificationTokenHistory: [currentTokenHash, supersededTokenHash]
        }
      });

      const res = await request(app)
        .post('/api/auth/verify-email')
        .send({ token: supersededToken });

      expect(res.status).toBe(400);
      expect(res.body.state).toBe('invalid');
    });

    test('should redirect legacy GET routes to the frontend verification page without consuming tokens', async () => {
      const getByParamRes = await request(app)
        .get(`/api/auth/verify-email/${verificationToken}`);
      expect(getByParamRes.status).toBe(302);
      expect(getByParamRes.headers.location).toBe(
        `${process.env.CLIENT_URL}/verify-email?token=${encodeURIComponent(verificationToken)}`
      );

      let user = await User.findOne({ email: 'test@example.com' });
      expect(user.accountStatus.isVerified).toBe(false);
      expect(user.emailVerificationToken).toBeTruthy();

      const getByQueryRes = await request(app)
        .get('/api/auth/verify-email')
        .query({ token: verificationToken });
      expect(getByQueryRes.status).toBe(302);
      expect(getByQueryRes.headers.location).toBe(
        `${process.env.CLIENT_URL}/verify-email?token=${encodeURIComponent(verificationToken)}`
      );

      user = await User.findOne({ email: 'test@example.com' });
      expect(user.accountStatus.isVerified).toBe(false);
      expect(user.emailVerificationToken).toBeTruthy();

      const postRes = await request(app)
        .post('/api/auth/verify-email')
        .send({ token: verificationToken });
      expect(postRes.status).toBe(200);

      user = await User.findOne({ email: 'test@example.com' });
      expect(user.accountStatus.isVerified).toBe(true);
    });

    test('should redirect legacy GET route without token to the frontend verification page', async () => {
      const res = await request(app)
        .get('/api/auth/verify-email');

      expect(res.status).toBe(302);
      expect(res.headers.location).toBe(`${process.env.CLIENT_URL}/verify-email`);
    });

    test('should reject explicit verification requests without a token', async () => {
      const res = await request(app)
        .post('/api/auth/verify-email')
        .send({});

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('Verification token is required');
    });

    test('should return invalid for unknown verification tokens', async () => {
      const res = await request(app)
        .post('/api/auth/verify-email')
        .send({ token: 'definitely-not-valid' });

      expect(res.status).toBe(400);
      expect(res.body.state).toBe('invalid');
    });

    test('should resend verification from an expired token without requiring authentication', async () => {
      const originalUser = await User.findOne({ email: 'test@example.com' });
      const originalTokenHash = originalUser.emailVerificationToken;

      await User.updateOne(
        { email: 'test@example.com' },
        {
          emailVerificationExpiresAt: new Date(Date.now() - 1000),
          'accountStatus.tokenExpiry': new Date(Date.now() - 1000),
        }
      );

      const res = await request(app)
        .post('/api/auth/resend-verification')
        .send({ token: verificationToken });

      expect(res.status).toBe(200);
      expect(res.body.message).toContain('eligible');

      const user = await User.findOne({ email: 'test@example.com' });
      expect(user.accountStatus.isVerified).toBe(false);
      expect(user.emailVerificationToken).toBeTruthy();
      expect(user.emailVerificationToken).not.toBe(originalTokenHash);
    });

    test('should return generic success for public resend requests with unknown token', async () => {
      const res = await request(app)
        .post('/api/auth/resend-verification')
        .send({ token: 'unknown-token' });

      expect(res.status).toBe(200);
      expect(res.body.message).toContain('eligible');
    });

    test('should return generic success for public resend requests on verified accounts', async () => {
      await User.create({
        email: 'verified-public@example.com',
        password: 'Test123!@#',
        emailVerified: true,
        accountStatus: {
          isVerified: true,
          isActive: true
        }
      });

      const res = await request(app)
        .post('/api/auth/resend-verification')
        .send({ email: 'verified-public@example.com' });

      expect(res.status).toBe(200);
      expect(res.body.message).toContain('eligible');
    });

    test('should allow resending verification email', async () => {
      await User.create({
        email: 'resend@example.com',
        password: 'Test123!@#',
        emailVerificationToken: crypto.createHash('sha256').update('resend-token').digest('hex'),
        emailVerificationExpiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        accountStatus: {
          isVerified: false,
          verificationToken: crypto.createHash('sha256').update('resend-token').digest('hex'),
          tokenExpiry: new Date(Date.now() + 24 * 60 * 60 * 1000)
        }
      });

      const res = await request(app)
        .post('/api/auth/resend-verification')
        .send({
          email: 'resend@example.com'
        });

      expect(res.status).toBe(200);
      expect(res.body.message).toContain('eligible');

      // Verify new token was generated
      const user = await User.findOne({ email: 'resend@example.com' });
      expect(user.accountStatus.verificationToken).not.toBe(crypto.createHash('sha256').update('resend-token').digest('hex'));
    });
  });

  describe('Login Tests', () => {
    beforeEach(async () => {
      // Create a verified user
      await User.create({
        email: 'test@example.com',
        password: 'Test123!@#',
        accountStatus: {
          isVerified: true,
          isActive: true
        }
      });
    });

    test('should login with verified account', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({
          email: 'test@example.com',
          password: 'Test123!@#'
        });

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('token');
      expect(res.body.user).toHaveProperty('isVerified', true);
    });

    test('should login with unverified account', async () => {
      await User.create({
        email: 'unverified@example.com',
        password: 'Test123!@#',
        accountStatus: {
          isVerified: false,
          isActive: true
        }
      });

      const res = await request(app)
        .post('/api/auth/login')
        .send({
          email: 'unverified@example.com',
          password: 'Test123!@#'
        });

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('token');
      expect(res.body.user).toHaveProperty('isVerified', false);
    });

    test('should login with Gmail address that contains dots in local part', async () => {
      await User.create({
        email: 'your.career.projects@gmail.com',
        password: 'Test123!@#',
        accountStatus: {
          isVerified: true,
          isActive: true
        }
      });

      const res = await request(app)
        .post('/api/auth/login')
        .send({
          email: 'your.career.projects@gmail.com',
          password: 'Test123!@#'
        });

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('token');
      expect(res.body.user).toHaveProperty('email', 'your.career.projects@gmail.com');
    });
  });

  describe('Password Reset Tests', () => {
    const resetToken = 'reset-token-123';
    const resetTokenHash = crypto.createHash('sha256').update(resetToken).digest('hex');
    const newPassword = 'NewPass1!@#';

    beforeEach(async () => {
      await User.create({
        email: 'reset@example.com',
        password: 'Test123!@#',
        emailVerified: true,
        tokenVersion: 0,
        accountStatus: {
          isVerified: true,
          isActive: true,
          resetPasswordToken: resetTokenHash,
          resetPasswordExpires: Date.now() + 60 * 60 * 1000
        }
      });
    });

    test('should send reset email for verified account without revealing existence', async () => {
      const res = await request(app)
        .post('/api/auth/request-password-reset')
        .send({ email: 'reset@example.com' });

      expect(res.status).toBe(200);
      expect(res.body.message).toContain('eligible');

      const user = await User.findOne({ email: 'reset@example.com' });
      expect(user.accountStatus.resetPasswordToken).toBeTruthy();
      expect(user.accountStatus.resetPasswordToken).not.toBe(resetTokenHash);
      expect(user.accountStatus.resetPasswordToken).toHaveLength(64);
    });

    test('should return generic success for unknown email', async () => {
      const res = await request(app)
        .post('/api/auth/request-password-reset')
        .send({ email: 'missing@example.com' });

      expect(res.status).toBe(200);
      expect(res.body.message).toContain('eligible');
    });

    test('should reset password with valid token and invalidate old sessions', async () => {
      const res = await request(app)
        .post('/api/auth/reset-password')
        .send({
          token: resetToken,
          password: newPassword
        });

      expect(res.status).toBe(200);
      expect(res.body.message).toContain('successful');

      const user = await User.findOne({ email: 'reset@example.com' });
      expect(user.accountStatus.resetPasswordToken).toBeUndefined();
      expect(user.accountStatus.resetPasswordExpires).toBeUndefined();
      expect(user.tokenVersion).toBe(1);

      const loginRes = await request(app)
        .post('/api/auth/login')
        .send({
          email: 'reset@example.com',
          password: newPassword
        });

      expect(loginRes.status).toBe(200);
      expect(loginRes.body).toHaveProperty('token');
    });

    test('should reject invalid reset token', async () => {
      const res = await request(app)
        .post('/api/auth/reset-password')
        .send({
          token: 'invalid-token',
          password: newPassword
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('Invalid or expired');
    });

    test('should reject weak password on reset', async () => {
      const res = await request(app)
        .post('/api/auth/reset-password')
        .send({
          token: resetToken,
          password: 'weak'
        });

      expect(res.status).toBe(400);
      expect(res.body.errors).toBeDefined();
    });

    test('should reject duplicate reset attempts after token is consumed', async () => {
      const firstRes = await request(app)
        .post('/api/auth/reset-password')
        .send({
          token: resetToken,
          password: newPassword
        });

      expect(firstRes.status).toBe(200);

      const secondRes = await request(app)
        .post('/api/auth/reset-password')
        .send({
          token: resetToken,
          password: newPassword
        });

      expect(secondRes.status).toBe(400);
      expect(secondRes.body.error).toContain('Invalid or expired');
    });

    test('should keep reset token when new password matches current password', async () => {
      const res = await request(app)
        .post('/api/auth/reset-password')
        .send({
          token: resetToken,
          password: 'Test123!@#'
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('different from the current password');

      const user = await User.findOne({ email: 'reset@example.com' });
      expect(user.accountStatus.resetPasswordToken).toBe(resetTokenHash);
    });
  });
}); 