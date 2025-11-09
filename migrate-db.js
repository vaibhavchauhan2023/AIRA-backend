// This is a one-time script to add new attendance fields to your database
require('dotenv').config();
const { MongoClient } = require('mongodb');

const MONGO_URI = process.env.MONGO_URI;
const DB_NAME = 'proxy-project';

async function migrate() {
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

    const dbData = await dataCollection.findOne({ _id: 'main' });
    if (!dbData) {
      console.error('Database document not found.');
      await client.close();
      return;
    }

    let migrationCount = 0;
    
    // Loop through all existing classes
    for (const classCode in dbData.class_locations) {
      const classData = dbData.class_locations[classCode];
      
      // Check if this class is in the OLD format (missing the new fields)
      if (classData.presentCount === undefined) {
        classData.presentCount = 0;
        classData.presentList = [];
        // 'isAttendanceActive' and 'location' should already exist from our last update
        if (classData.isAttendanceActive === undefined) {
           classData.isAttendanceActive = false;
        }
        
        migrationCount++;
        console.log(`Migrating class: ${classCode}`);
      }
    }

    if (migrationCount > 0) {
      // Save the updated document back to MongoDB
      await dataCollection.updateOne({ _id: 'main' }, { $set: { class_locations: dbData.class_locations } });
      console.log(`✅ Success! Migrated ${migrationCount} classes.`);
    } else {
      console.log('Database is already up-to-date. No migration needed.');
    }

  } catch (err) {
    console.error('An error occurred:', err);
  } finally {
    await client.close();
    console.log('Connection closed.');
  }
}

migrate();