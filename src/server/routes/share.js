const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const crypto = require('crypto');
const QRCode = require('qrcode');
const User = require('../models/User');

// In-memory storage for shared links (in production, use a database)
const sharedLinks = new Map();

// Generate shareable link
router.post('/generate-link', auth, async (req, res) => {
  try {
    const { resultId, title, description, category, matchScore, matchedInputs, privacySettings } = req.body;
    const userId = req.user.userId || req.user.id;

    // Generate unique share ID
    const shareId = crypto.randomBytes(16).toString('hex');
    const baseUrl = process.env.BASE_URL || 'http://localhost:3000';
    const shareableLink = `${baseUrl}/shared-result/${shareId}`;

    // Store shared content
    const sharedContent = {
      id: shareId,
      userId,
      resultId,
      title,
      description,
      category,
      matchScore,
      matchedInputs,
      privacySettings,
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days
      accessCount: 0
    };

    sharedLinks.set(shareId, sharedContent);

    // Generate QR code
    let qrCodeUrl = '';
    try {
      qrCodeUrl = await QRCode.toDataURL(shareableLink);
    } catch (error) {
      console.error('Error generating QR code:', error);
    }

    res.json({
      success: true,
      shareableLink,
      qrCodeUrl,
      shareId,
      expiresAt: sharedContent.expiresAt
    });
  } catch (error) {
    console.error('Error generating shareable link:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to generate shareable link'
    });
  }
});

// Share via email (with authentication)
router.post('/email', auth, async (req, res) => {
  try {
    const { recipient, message, resultId, shareableLink, privacySettings, title } = req.body;
    const userId = req.user.userId || req.user.id;
    const currentUser = await User.findById(userId).select('email');

    // Validate required fields
    if (!recipient || !shareableLink) {
      return res.status(400).json({
        success: false,
        message: 'Recipient email and shareable link are required'
      });
    }

    // Import and use email service
    const emailService = require('../services/emailService');
    
    const emailResult = await emailService.sendShareEmail({
      from: currentUser?.email || req.user.email,
      to: recipient,
      subject: `Career Opportunity: ${title || 'Career Step'}`,
      message: message || '',
      shareableLink
    });

    res.json({
      success: true,
      message: 'Email sent successfully',
      messageId: emailResult.messageId,
      previewURL: emailResult.previewURL
    });
  } catch (error) {
    console.error('Error sending email:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to send email: ' + error.message
    });
  }
});



// Get shared content by share ID
router.get('/shared/:shareId', async (req, res) => {
  try {
    const { shareId } = req.params;
    const sharedContent = sharedLinks.get(shareId);

    if (!sharedContent) {
      return res.status(404).json({
        success: false,
        message: 'Shared content not found'
      });
    }

    // Check if link has expired
    if (new Date() > sharedContent.expiresAt) {
      sharedLinks.delete(shareId);
      return res.status(410).json({
        success: false,
        message: 'Shared link has expired'
      });
    }

    // Increment access count
    sharedContent.accessCount++;

    // Return shared content based on privacy settings
    const response = {
      success: true,
      title: sharedContent.title,
      description: sharedContent.description,
      category: sharedContent.category
    };

    if (sharedContent.privacySettings.includeMatchScore) {
      response.matchScore = sharedContent.matchScore;
    }

    if (sharedContent.privacySettings.includeMatchedInputs) {
      response.matchedInputs = sharedContent.matchedInputs;
    }

    res.json(response);
  } catch (error) {
    console.error('Error retrieving shared content:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve shared content'
    });
  }
});

// Get user's shared content history
router.get('/history', auth, async (req, res) => {
  try {
    const userId = req.user.userId || req.user.id;
    const userSharedContent = [];

    for (const [shareId, content] of sharedLinks.entries()) {
      if (content.userId === userId) {
        userSharedContent.push({
          shareId,
          title: content.title,
          category: content.category,
          createdAt: content.createdAt,
          expiresAt: content.expiresAt,
          accessCount: content.accessCount,
          isExpired: new Date() > content.expiresAt
        });
      }
    }

    // Sort by creation date (newest first)
    userSharedContent.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    res.json({
      success: true,
      sharedContent: userSharedContent
    });
  } catch (error) {
    console.error('Error retrieving share history:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve share history'
    });
  }
});

// Revoke shared link
router.delete('/revoke/:shareId', auth, async (req, res) => {
  try {
    const { shareId } = req.params;
    const userId = req.user.userId || req.user.id;

    const sharedContent = sharedLinks.get(shareId);

    if (!sharedContent) {
      return res.status(404).json({
        success: false,
        message: 'Shared content not found'
      });
    }

    if (sharedContent.userId !== userId) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to revoke this link'
      });
    }

    sharedLinks.delete(shareId);

    res.json({
      success: true,
      message: 'Shared link revoked successfully'
    });
  } catch (error) {
    console.error('Error revoking shared link:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to revoke shared link'
    });
  }
});

// Clean up expired links (run periodically)
const cleanupExpiredLinks = () => {
  const now = new Date();
  for (const [shareId, content] of sharedLinks.entries()) {
    if (now > content.expiresAt) {
      sharedLinks.delete(shareId);
    }
  }
};

// Run cleanup every hour
setInterval(cleanupExpiredLinks, 60 * 60 * 1000);

module.exports = router; 