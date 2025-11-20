// This is a one-time script to add hashed passwords to our database
require('dotenv').config();
const { MongoClient } = require('mongodb');
const bcrypt = require('bcrypt');

const MONGO_URI = process.env.MONGO_URI;
const DB_NAME = 'proxy-project';
const SALT_ROUNDS = 10; // Standard for bcrypt

async function addPasswords() {
  if (!MONGO_URI) {
    console.error('Error: MONGO_URI not found in .env file.');
    return;
  }

  const client = new MongoClient(MONGO_URI);

  try {
    await client.connect();
    const db = client.db(DB_NAME);
    const dataCollection = db.collection('data');
    console.log('Connected to database...');

    // 1. Get the current database document
    const dbData = await dataCollection.findOne({ _id: 'main' });
    if (!dbData) {
      console.error('Database document not found. Run upload-data.js first.');
      return;
    }

    // 2. Hash a default password (e.g., "12345")
    console.log('Hashing password "12345"...');
    const defaultPassword = '12345';
    const hash = await bcrypt.hash(defaultPassword, SALT_ROUNDS);
    console.log('Hash created:', hash);

    // 3. Add the hash to both users
    if (dbData.users['student-101']) {
      dbData.users['student-101'].passwordHash = hash;
      console.log('Added hash to student-101');
    }
    if (dbData.users['teacher-201']) {
      dbData.users['teacher-201'].passwordHash = hash;
      console.log('Added hash to teacher-201');
    }

    // 4. Save the updated document back to MongoDB
    await dataCollection.updateOne({ _id: 'main' }, { $set: dbData });
    console.log('Successfully updated users with new password hashes.');

  } catch (err) {
    console.error('An error occurred:', err);
  } finally {
    await client.close();
    console.log('Connection closed.');
  }
}

addPasswords();