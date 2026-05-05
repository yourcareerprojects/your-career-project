// clearDocuments.js
// Script to delete all documents for the currently authenticated user (from DB and disk)

const axios = require('axios');
const readline = require('readline');

const API_BASE = 'http://localhost:3000/api';

async function promptToken() {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question('Enter your JWT token: ', (token) => {
      rl.close();
      resolve(token.trim());
    });
  });
}

async function main() {
  let token = process.env.JWT_TOKEN;
  if (!token) {
    token = await promptToken();
  }
  if (!token) {
    console.error('No JWT token provided. Set JWT_TOKEN env variable or enter it when prompted.');
    process.exit(1);
  }

  try {
    // Fetch all documents for the user
    const res = await axios.get(`${API_BASE}/documents`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    const documents = res.data.documents || [];
    if (documents.length === 0) {
      console.log('No documents found for this user.');
      return;
    }
    console.log(`Found ${documents.length} documents. Deleting...`);
    for (const doc of documents) {
      try {
        await axios.delete(`${API_BASE}/documents/${doc.id}`, {
          headers: { Authorization: `Bearer ${token}` }
        });
        console.log(`Deleted document: ${doc.name || doc.originalName || doc.id}`);
      } catch (err) {
        console.error(`Failed to delete document ${doc.id}:`, err.response?.data || err.message);
      }
    }
    console.log('All possible documents deleted.');
  } catch (err) {
    console.error('Error fetching documents:', err.response?.data || err.message);
  }
}

main(); 