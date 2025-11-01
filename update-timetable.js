// This is a safe script to update ONLY the timetables in your database
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { MongoClient } = require('mongodb');

const DB_PATH = path.join(__dirname, 'database.json');
const MONGO_URI = process.env.MONGO_URI;
const DB_NAME = 'proxy-project';

async function updateTimetables() {
  if (!MONGO_URI) {
    console.error('Error: MONGO_URI not found in .env file.');
    return;
  }

  const client = new MongoClient(MONGO_URI);

  try {
    // 1. Connect to the database
    await client.connect();
    const db = client.db(DB_NAME);
    const dataCollection = db.collection('data');
    console.log(`Connected to database: ${DB_NAME}`);

    // 2. Read the local database.json file
    const data = fs.readFileSync(DB_PATH, 'utf8');
    const databaseJson = JSON.parse(data);
    console.log('Read data from database.json successfully.');

    // 3. Get ONLY the 'timetables' object
    const localTimetables = databaseJson.timetables;

    if (!localTimetables) {
      console.error('Error: "timetables" section not found in database.json');
      return;
    }

    // 4. Safely update ONLY the 'timetables' field in the database
    // This uses $set, so it won't overwrite users or class_locations
    console.log('Pushing timetable changes to the live database...');
    const result = await dataCollection.updateOne(
      { _id: 'main' }, // Find our one main document
      { $set: { timetables: localTimetables } } // And $set (update) only the timetables field
    );

    if (result.modifiedCount > 0) {
      console.log('✅ Success! Your live timetables have been updated.');
    } else {
      console.log('Your live timetables are already up-to-date. No changes made.');
    }

  } catch (err) {
    console.error('An error occurred:', err);
  } finally {
    // 5. Close the connection
    await client.close();
    console.log('Connection closed.');
  }
}

// Run the update function
updateTimetables();