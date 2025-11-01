const bcrypt = require('bcrypt'); // <-- ADD THIS LINE
// 1. Import necessary libraries
require('dotenv').config(); // Load the .env file AT THE VERY TOP
const express = require('express');
const cors = require('cors');
const { MongoClient } = require('mongodb'); // Import MongoDB
const path = require('path');

// 2. Initialize the app
const app = express();
const PORT = 4000;
const MONGO_URI = process.env.MONGO_URI;
const DB_NAME = 'proxy-project'; // The database name we used in the upload script

// 3. Setup middleware
app.use(cors({
  origin: 'http://localhost:5173' // Only allow requests from our React app
}));
app.use(express.json());

// ==========================================================
// Our New "Database" Connection
// ==========================================================
let db; // This variable will hold our database connection

/**
 * Connects to MongoDB Atlas.
 * We will store ALL our data in one collection ("data")
 * and in one document ("_id: 'main'")
 */
async function connectToDb() {
  try {
    const client = new MongoClient(MONGO_URI);
    await client.connect();
    db = client.db(DB_NAME); // Set the global db variable
    console.log(`[SERVER] Successfully connected to MongoDB Atlas: ${DB_NAME}`);
  } catch (err) {
    console.error('[SERVER] Failed to connect to MongoDB', err);
    process.exit(1); // Exit the app if we can't connect
  }
}

/**
 * Replaces our old fs.readFileSync
 * Fetches the one "main" document from our "data" collection
 */
async function readDatabase() {
  if (!db) throw new Error('Database not connected');
  // Find the one document that holds all our app's data
  const data = await db.collection('data').findOne({ _id: 'main' });
  // We remove the _id field so it looks just like our old JSON file
  if (data) delete data._id;
  return data;
}

/**
 * Replaces our old fs.writeFileSync
 * Updates the "main" document in our "data" collection
 * @param {object} newData - The entire database object to save
 */
async function writeDatabase(newData) {
  if (!db) throw new Error('Database not connected');
  // Update the 'main' document with the new data
  await db.collection('data').updateOne(
    { _id: 'main' },
    { $set: newData }
  );
}

// ==========================================================
// Date and Time Helpers (No changes here)
// ==========================================================
function getCurrentDay() {
  const options = { weekday: 'long', timeZone: 'Asia/Kolkata' };
  return new Intl.DateTimeFormat('en-US', options).format(new Date());
}
function getCurrentTime() {
  const options = { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata', hour12: false };
  const parts = new Intl.DateTimeFormat('en-IN', options).formatToParts(new Date());
  const hour = parts.find(p => p.type === 'hour').value;
  const minute = parts.find(p => p.type === 'minute').value;
  return `${hour}:${minute}`;
}
function getDynamicTimetable(timetableForToday) {
  const now = getCurrentTime();
  return timetableForToday.map(cls => ({
    ...cls,
    live: (now >= cls.startTime && now < cls.endTime)
  }));
}

// ==========================================================
// API Endpoints (Now using async/await for the database)
// ==========================================================

// --- Login Endpoint (UPGRADED) ---
// --- Login Endpoint (UPGRADED WITH BCRYPT) ---
// --- Login Endpoint (UPGRADED WITH BCRYPT) ---
app.post('/api/login', async (req, res) => {
  try {
    const { userType, userId, password } = req.body;

    // --- ADD THIS DEBUG LINE ---
    console.log(`[DEBUG] Login attempt: type=${userType}, id=${userId}`);
    
    if (!password) {
      return res.status(400).json({ success: false, message: 'Password is required.' });
    }

    const dbData = await readDatabase();
    
    const key = `${userType}-${userId}`;
    const user = dbData.users[key];
    
    // --- ADD THIS DEBUG LINE ---
    console.log(`[DEBUG] User found in DB:`, user);

    // Step 1: Check if user exists
    if (!user) {
      return res.status(401).json({ success: false, message: 'Invalid User ID or Password' });
    }

    // Step 2: Check if user has a password set
    if (!user.passwordHash) {
      return res.status(500).json({ success: false, message: 'User has no password set. Please contact admin.' });
    }

    // Step 3: Securely compare the provided password with the stored hash
    const isMatch = await bcrypt.compare(password, user.passwordHash);

    // --- ADD THIS DEBUG LINE ---
    console.log(`[DEBUG] Password match result: ${isMatch}`);

    if (isMatch) {
      // --- PASSWORD IS CORRECT ---
      // ... (rest of the success logic)
// ... (rest of the code is the same)
      const today = getCurrentDay();
      const weeklyTimetable = dbData.timetables[key];
      const timetableForToday = weeklyTimetable ? (weeklyTimetable[today] || []) : [];
      const dynamicTimetable = getDynamicTimetable(timetableForToday);
      
      const userToSend = { ...user };
      delete userToSend.passwordHash;

      res.json({ success: true, user: userToSend, timetable: dynamicTimetable });
    } else {
      // --- PASSWORD IS WRONG ---
      res.status(401).json({ success: false, message: 'Invalid User ID or Password' });
    }
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error: ' + err.message });
  }
});

// --- Teacher Sets Class Location Endpoint (UPGRADED) ---
app.post('/api/set-location', async (req, res) => { // <-- Now 'async'
  try {
    const { classCode, coords } = req.body;
    const dbData = await readDatabase(); // <-- Now 'await'
    
    if (classCode in dbData.class_locations) {
      dbData.class_locations[classCode] = coords;
      
      await writeDatabase(dbData); // <-- Now 'await'
      
      console.log(`[SERVER] Location for ${classCode} set to:`, coords);
      res.json({ success: true, message: `Location for ${classCode} set.` });
    } else {
      res.status(404).json({ success: false, message: 'Class not found' });
    }
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error: ' + err.message });
  }
});

// --- Student Verifies Location Endpoint (UPGRADED) ---
app.post('/api/verify-location', async (req, res) => { // <-- Now 'async'
  try {
    const { classCode, coords: studentCoords } = req.body;
    const dbData = await readDatabase(); // <-- Now 'await'
    const goldenCoords = dbData.class_locations[classCode];
    
    if (!goldenCoords) {
      return res.status(400).json({ success: false, message: 'Teacher has not set the location for this class yet.' });
    }
    
    const distance = calculateHaversineDistance(
      goldenCoords.lat, goldenCoords.lon,
      studentCoords.lat, studentCoords.lon
    );
    
    const GEOFENCE_RADIUS = 50;
    
    if (distance <= GEOFENCE_RADIUS) {
      res.json({ success: true, message: 'Location Verified.' });
    } else {
      res.status(400).json({
        success: false,
        message: `Location Mismatch. You are ${Math.round(distance)} meters away from class.`
      });
    }
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error: ' + err.message });
  }
});

// ==========================================================
// Start the Server
// ==========================================================
async function startServer() {
  console.log("!!!!!!!!!! SERVER IS RUNNING THE LATEST CODE !!!!!!!!!!");

  await connectToDb(); // Connect to database FIRST
  
  app.listen(PORT, () => { // THEN start listening for requests
    console.log(`[SERVER] Backend server is running on http://localhost:${PORT}`);
    console.log(`[SERVER] Current server day: ${getCurrentDay()}`);
    console.log(`[SERVER] Current server time (IST): ${getCurrentTime()}`);
  });
}

startServer(); // Run the async start function

// ==========================================================
// Helper Function: Haversine Formula (No changes here)
// ==========================================================
function calculateHaversineDistance(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const phi1 = (lat1 * Math.PI) / 180;
  const phi2 = (lat2 * Math.PI) / 180;
  const deltaPhi = ((lat2 - lat1) * Math.PI) / 180;
  const deltaLambda = ((lon2 - lon1) * Math.PI) / 180;
  const a = Math.sin(deltaPhi / 2) * Math.sin(deltaPhi / 2) +
            Math.cos(phi1) * Math.cos(phi2) *
            Math.sin(deltaLambda / 2) * Math.sin(deltaLambda / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}