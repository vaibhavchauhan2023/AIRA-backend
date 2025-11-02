require('dotenv').config();
const { MongoClient } = require('mongodb');
const bcrypt = require('bcrypt');

const MONGO_URI = process.env.MONGO_URI;
const DB_NAME = 'proxy-project';
const SALT_ROUNDS = 10;

function getCommandLineArgs() {
  const args = process.argv.slice(2); 

  if (args.length !== 5) {
    console.error('Error: Incorrect number of arguments.');
    console.log('Usage: node create-user.js <userType> <userId> "<UserName>" <password> <timetableId>');
    console.log('Example: node create-user.js student e23cseu01183 "Vaibhav Chauhan" 12345 CSE-3rd-Year');
    return null; 
  }

  const [userType, userId, userName, password, timetableId] = args;

  if (userType !== 'student' && userType !== 'teacher') {
    console.error('Error: userType must be "student" or "teacher".');
    return null;
  }

  return { userType, userId, userName, password, timetableId };
}

async function createOrUpdateUser() {
  const input = getCommandLineArgs();
  if (!input) {
    return; 
  }

  const { userType, userId, userName, password, timetableId } = input;

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

    const dbData = await dataCollection.findOne({ _id: 'main' });
    if (!dbData) {
      console.error('Database document not found. Run upload-data.js first.');
      await client.close();
      return;
    }

    if (!dbData.master_timetables[timetableId]) {
      console.error(`Error: Timetable ID "${timetableId}" does not exist in master_timetables.`);
      console.log('Available IDs are:', Object.keys(dbData.master_timetables));
      await client.close();
      return; 
    }
    
    const userKey = `${userType}-${userId}`;
    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);

    if (dbData.users[userKey]) {
      // --- UPGRADE ---
      // User *does* exist. Let's just update them.
      console.log(`User ${userKey} already exists. Updating their info and password...`);
      dbData.users[userKey].name = userName;
      dbData.users[userKey].passwordHash = passwordHash;
      dbData.users[userKey].timetableId = timetableId;

      await dataCollection.updateOne({ _id: 'main' }, { $set: dbData });
      console.log('✅ Success! User updated:');
      console.log(dbData.users[userKey]);
      // ---------------

    } else {
      // --- ORIGINAL CODE ---
      // User does not exist. Let's create them.
      console.log(`Hashing password "${password}"...`);

      const newUser = {
        type: userType,
        id: userId,
        name: userName,
        passwordHash: passwordHash,
        timetableId: timetableId 
      };

      dbData.users[userKey] = newUser;

      await dataCollection.updateOne({ _id: 'main' }, { $set: dbData });
      console.log('---------------------------------');
      console.log('✅ Success! User created:');
      console.log(newUser);
      console.log('---------------------------------');
    }

  } catch (err) {
    console.error('An error occurred:', err);
  } finally {
    await client.close();
    console.log('Connection closed.');
  }
}

createOrUpdateUser(); // Renamed the function