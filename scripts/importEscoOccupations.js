// importEscoOccupations.js
// Script to import ESCO occupation data from CSV into MongoDB CareerPath collection

const fs = require('fs');
const path = require('path');
const csv = require('csv-parser');
const mongoose = require('mongoose');
require('dotenv').config();

// Path to the CSV file
const CSV_PATH = path.join(__dirname, '../ESCO dataset - v1.2.0 - classification - en - csv/occupations_en.csv');

// MongoDB connection URI
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/career-path-explorer';

// CareerPath model
const CareerPath = require('../src/server/models/CareerPath');

function splitLabels(value) {
  if (!value) return [];
  // ESCO exports often separate labels with newlines inside the CSV cell
  return String(value)
    .split(/\r?\n/g)
    .map(s => s.trim())
    .filter(Boolean);
}

async function importOccupations() {
  await mongoose.connect(MONGODB_URI);
  console.log('Connected to MongoDB');

  let count = 0;
  const occupations = [];

  fs.createReadStream(CSV_PATH)
    .pipe(csv())
    .on('data', (row) => {
      // Map CSV columns to CareerPath fields
      const occupation = {
        escoId: row['conceptUri'],
        code: row['code'] || undefined,
        iscoGroup: row['iscoGroup'] ? String(row['iscoGroup']).trim() : undefined,
        title: row['preferredLabel'],
        altTitles: splitLabels(row['altLabels']),
        hiddenTitles: splitLabels(row['hiddenLabels']),
        description: row['description'] || row['definition'] || '',
        source: 'ESCO',
        sourceVersion: 'v1.2.0',
        importedFrom: 'csv',
        // Add more fields as needed
      };
      occupations.push(occupation);
    })
    .on('end', async () => {
      console.log(`Parsed ${occupations.length} occupations. Importing...`);
      console.log('Sample occupation:', occupations[0]); // Debug: show first occupation
      
      for (const occ of occupations) {
        try {
          const result = await CareerPath.findOneAndUpdate(
            { escoId: occ.escoId },
            { $set: occ },
            { upsert: true, new: true }
          );
          count++;
          if (count % 1000 === 0) console.log(`Imported ${count} occupations...`);
        } catch (error) {
          console.error(`Error importing occupation ${occ.title}:`, error.message);
        }
      }
      console.log(`Import complete. Total occupations imported: ${count}`);
      
      // Verify import by counting documents
      const totalDocs = await CareerPath.countDocuments();
      console.log(`Total documents in database: ${totalDocs}`);
      
      await mongoose.disconnect();
      process.exit(0);
    })
    .on('error', (err) => {
      console.error('Error reading CSV:', err);
      process.exit(1);
    });
}

importOccupations(); 