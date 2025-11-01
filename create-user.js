// This is a reusable script to add new users to our database
require('dotenv').config();
const { MongoClient } = require('mongodb');
const bcrypt = require('bcrypt');

const MONGO_URI = process.env.MONGO_URI;
const DB_NAME = 'proxy-project';
const SALT_ROUNDS = 10;

/**
 * This function gets the new user details from your terminal command.
 * process.argv is an array of what you typed in the terminal.
 * [ 'node', 'create-user.js', 'student', '102', 'Priya Sharma', 'abcde' ]
 * (0)        (1)             (2)       (3)         (4)          (5)
 */
function getCommandLineArgs() {
  const args = process.argv.slice(2); // Get all args after 'node create-user.js'

  if (args.length !== 4) {
    console.error('Error: Incorrect number of arguments.');
    console.log('Usage: node create-user.js <userType> <userId> "<UserName>" <password>');
    console.log('Example: node create-user.js student 102 "Priya Sharma" 12345');
    return null; // Exit
  }

  const [userType, userId, userName, password] = args;

  if (userType !== 'student' && userType !== 'teacher') {
    console.error('Error: userType must be "student" or "teacher".');
    return null;
  }

  return { userType, userId, userName, password };
}

async function createNewUser() {
  const input = getCommandLineArgs();
  if (!input) {
    return; // Stop if input is invalid
  }

  const { userType, userId, userName, password } = input;

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

    // 2. Check if user already exists
    const userKey = `${userType}-${userId}`;
    if (dbData.users[userKey]) {
      console.error(`Error: User ${userKey} already exists.`);
      return;
    }

    // 3. Hash the new password
    console.log(`Hashing password "${password}"...`);
    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);

    // 4. Create the new user object
    const newUser = {
      type: userType,
      id: userId,
      name: userName,
      passwordHash: passwordHash
    };

    // 5. Add the new user
    dbData.users[userKey] = newUser;
    // Also add an empty timetable for them
    dbData.timetables[userKey] = {
      "Monday": [], "Tuesday": [], "Wednesday": [], "Thursday": [], "Friday": [], "Saturday": [], "Sunday": []
    };

    // 6. Save the updated document back to MongoDB
    await dataCollection.updateOne({ _id: 'main' }, { $set: dbData });
    console.log('---------------------------------');
    console.log('✅ Success! User created:');
    console.log(newUser);
    console.log('---------------------------------');

  } catch (err) {
    console.error('An error occurred:', err);
  } finally {
    await client.close();
    console.log('Connection closed.');
  }
}

createNewUser();