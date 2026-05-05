const express = require('express');
const router = express.Router();
const User = require('../src/server/models/User');

// POST /api/users/register - Register a new user
router.post('/register', async (req, res) => {
    try {
        const { email, password, personalInfo } = req.body;

        // Check if user already exists
        const existingUser = await User.findOne({ email });
        if (existingUser) {
            return res.status(400).json({ message: 'User already exists with this email' });
        }

        // Create new user
        const user = new User({
            email,
            password,
            personalInfo: personalInfo || {}
        });

        // Save user to database
        await user.save();

        // Return success response (excluding password)
        const userResponse = user.toObject();
        delete userResponse.password;
        
        res.status(201).json({
            message: 'User registered successfully',
            user: userResponse
        });
    } catch (error) {
        console.error('Registration error:', error);
        res.status(500).json({ 
            message: 'Error registering user',
            error: error.message 
        });
    }
});

module.exports = router; 