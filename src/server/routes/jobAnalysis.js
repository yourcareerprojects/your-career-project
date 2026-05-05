const express = require('express');
const router = express.Router();
const jobAnalysisController = require('../controllers/jobAnalysisController');

// POST /api/job-analysis/extract-responsibilities
router.post('/extract-responsibilities', jobAnalysisController.extractResponsibilities);

module.exports = router;
