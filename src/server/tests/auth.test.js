const request = require('supertest');
const app = require('../app'); // You'll need to export your Express app
const User = require('../models/User');
const jwt = require('jsonwebtoken');
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
    let authToken;

    beforeEach(async () => {
      // Register a new user and capture the verification token
      verificationToken = 'test-token';
      const verificationTokenHash = crypto
        .createHash('sha256')
        .update(verificationToken)
        .digest('hex');
      const user = await User.create({
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
      authToken = jwt.sign(
        { userId: user._id, tokenVersion: user.tokenVersion || 0 },
        process.env.JWT_SECRET,
        { expiresIn: process.env.JWT_EXPIRATION || '24h' }
      );
    });

    test('should verify email with valid token', async () => {
      const res = await request(app)
        .get(`/api/auth/verify-email/${verificationToken}`);

      expect(res.status).toBe(200);
      expect(res.body.message).toContain('verified successfully');

      // Verify user status in database
      const user = await User.findOne({ email: 'test@example.com' });
      expect(user.accountStatus.isVerified).toBe(true);
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
        .get(`/api/auth/verify-email/${verificationToken}`);

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('expired');
    });

    test('should allow resending verification email', async () => {
      const res = await request(app)
        .post('/api/auth/resend-verification')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          email: 'test@example.com'
        });

      expect(res.status).toBe(200);
      expect(res.body.message).toContain('resent');

      // Verify new token was generated
      const user = await User.findOne({ email: 'test@example.com' });
      expect(user.accountStatus.verificationToken).not.toBe(verificationToken);
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

    test('should reject login with unverified account', async () => {
      // Create unverified user
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

      expect(res.status).toBe(401);
      expect(res.body.error).toContain('verify your email');
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
}); 