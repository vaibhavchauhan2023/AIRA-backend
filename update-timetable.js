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
    await client.connect();
    const db = client.db(DB_NAME);
    const dataCollection = db.collection('data');
    console.log(`Connected to database: ${DB_NAME}`);

    const data = fs.readFileSync(DB_PATH, 'utf8');
    const databaseJson = JSON.parse(data);
    console.log('Read data from database.json successfully.');

    // --- UPGRADED ---
    const localMasterTimetables = databaseJson.master_timetables;
    const localClassLocations = databaseJson.class_locations;

    if (!localMasterTimetables) {
      console.error('Error: "master_timetables" section not found in database.json');
      return;
    }
    if (!localClassLocations) {
      console.error('Error: "class_locations" section not found in database.json');
      return;
    }

    console.log('Pushing changes to the live database...');
    const result = await dataCollection.updateOne(
      { _id: 'main' }, 
      // --- UPGRADED ---
      // Safely update BOTH master_timetables and class_locations
      // This will not touch your users
      { $set: { 
          master_timetables: localMasterTimetables,
          class_locations: localClassLocations 
        } 
      }
    );

    if (result.modifiedCount > 0) {
      console.log('✅ Success! Your live timetables and class locations have been updated.');
    } else {
      console.log('Your live data is already up-to-date. No changes made.');
    }

  } catch (err) {
    console.error('An error occurred:', err);
  } finally {
    await client.close();
    console.log('Connection closed.');
  }
}

updateTimetables();