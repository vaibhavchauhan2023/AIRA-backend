// This is a one-time script to move our data from database.json to MongoDB Atlas

require('dotenv').config(); // Load the .env file
const fs = require('fs');
const path = require('path');
const { MongoClient } = require('mongodb');

const DB_PATH = path.join(__dirname, 'database.json');
const MONGO_URI = process.env.MONGO_URI;

// The name of our database in MongoDB Atlas
const DB_NAME = 'proxy-project'; 

async function upload() {
  if (!MONGO_URI) {
    console.error('Error: MONGO_URI not found in .env file.');
    return;
  }

  const client = new MongoClient(MONGO_URI);

  try {
    // 1. Connect to the database
    await client.connect();
    const db = client.db(DB_NAME);
    console.log(`Connected to database: ${DB_NAME}`);

    // 2. Read the local database.json file
    const data = fs.readFileSync(DB_PATH, 'utf8');
    const databaseJson = JSON.parse(data);
    console.log('Read data from database.json successfully.');

    // 3. Get the 'data' collection (or create it)
    const dataCollection = db.collection('data');

    // 4. We will store ALL our data in a SINGLE document.
    // This makes reading and writing very simple for our app.
    // We will find the document with _id: "main" or create it if it doesn't exist.
    
    // This is an "upsert": it will update if it exists, or insert if it doesn't.
    const result = await dataCollection.updateOne(
      { _id: 'main' },  // The document we are looking for
      { $set: databaseJson }, // The data we want to set
      { upsert: true } // The "upsert" option
    );

    if (result.upsertedCount > 0) {
      console.log('Successfully created and uploaded new database document.');
    } else if (result.modifiedCount > 0) {
      console.log('Successfully updated existing database document.');
    } else {
      console.log('Database document was already up-to-date.');
    }

  } catch (err) {
    console.error('An error occurred:', err);
  } finally {
    // 5. Close the connection
    await client.close();
    console.log('Connection closed.');
  }
}

// Run the upload function
upload();