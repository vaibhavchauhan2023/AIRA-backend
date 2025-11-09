// 1. Import necessary libraries
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { MongoClient, ObjectId } = require('mongodb'); // ObjectId is not used, but good to know
const path = require('path');
const bcrypt = require('bcrypt');

// 2. Initialize the app
const app = express();
const PORT = 4000;
const MONGO_URI = process.env.MONGO_URI;
const DB_NAME = 'proxy-project';

// 3. Setup middleware
app.use(cors()); 
app.use(express.json());

// ==========================================================
// Database Connection (No changes)
// ==========================================================
let db; 

async function connectToDb() {
  try {
    const client = new MongoClient(MONGO_URI);
    await client.connect();
    db = client.db(DB_NAME);
    console.log(`[SERVER] Successfully connected to MongoDB Atlas: ${DB_NAME}`);
  } catch (err) {
    console.error('[SERVER] Failed to connect to MongoDB', err);
    process.exit(1);
  }
}

// These read/write functions are now our main DB interface
async function readDatabase() {
  if (!db) throw new Error('Database not connected');
  const data = await db.collection('data').findOne({ _id: 'main' });
  if (data) delete data._id;
  return data;
}

async function writeDatabase(data) {
  if (!db) throw new Error('Database not connected');
  await db.collection('data').updateOne(
    { _id: 'main' },
    { $set: data }
  );
}

// ==========================================================
// Date and Time Helpers (No changes)
// ==========================================================
function getCurrentDay() { /* ... no change ... */ }
function getCurrentTime() { /* ... no change ... */ }

// --- UPGRADED: These functions now also pass 'presentList' ---
function getStudentTimetable(timetableForToday, classLocations, userId) {
  const now = getCurrentTime();
  
  return timetableForToday.map(cls => {
    const classStatus = classLocations[cls.code];

    const isTimeCorrect = (now >= cls.startTime && now < cls.endTime);
    const isTeacherActive = (classStatus && classStatus.isAttendanceActive === true);
    const isLive = isTimeCorrect && isTeacherActive;
    
    // --- NEW ---
    // Check if this student's ID is in the presentList
    const isMarked = (classStatus && classStatus.presentList.includes(userId));
    
    return { ...cls, live: isLive, isMarked: isMarked }; // <-- Send isMarked
  });
}

function getTeacherTimetable(timetableForToday, classLocations) {
  const now = getCurrentTime();
  
  return timetableForToday.map(cls => {
    const classStatus = classLocations[cls.code];

    const isTimeCorrect = (now >= cls.startTime && now < cls.endTime);
    
    // --- NEW ---
    // Pass the presentCount to the teacher's dashboard
    const presentCount = (classStatus ? classStatus.presentCount : 0);
    
    return { ...cls, live: isTimeCorrect, presentCount: presentCount }; // <-- Send presentCount
  });
}


// ==========================================================
// API Endpoints
// ==========================================================

// --- Login Endpoint (UPGRADED) ---
app.post('/api/login', async (req, res) => {
  try {
    const { userType, userId, password } = req.body;
    const dbData = await readDatabase();
    
    const key = `${userType}-${userId}`;
    const user = dbData.users[key];

    if (!user) { /* ... no change ... */ }
    if (!user.passwordHash) { /* ... no change ... */ }

    const isMatch = await bcrypt.compare(password, user.passwordHash);

    if (isMatch) {
      const today = getCurrentDay();
      const timetableId = user.timetableId;
      const weeklyTimetable = dbData.master_timetables[timetableId];
      const timetableForToday = weeklyTimetable ? (weeklyTimetable[today] || []) : [];
      
      let dynamicTimetable;
      
      if (user.type === 'teacher') {
        // --- UPGRADED ---
        // Pass classLocations so we can get the presentCount
        dynamicTimetable = getTeacherTimetable(timetableForToday, dbData.class_locations);
      } else {
        // --- UPGRADED ---
        // Pass the user.id so we can check if they are marked
        dynamicTimetable = getStudentTimetable(timetableForToday, dbData.class_locations, user.id);
      }
      
      const userToSend = { ...user };
      delete userToSend.passwordHash;

      res.json({ success: true, user: userToSend, timetable: dynamicTimetable });
    } else {
      res.status(401).json({ success: false, message: 'Invalid User ID or Password' });
    }
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error: ' + err.message });
  }
});


// --- Teacher Starts Session Endpoint (UPGRADED) ---
app.post('/api/start-session', async (req, res) => {
  try {
    const { classCode, coords } = req.body;
    
    // --- THIS IS YOUR "RESET" LOGIC ---
    // We use a direct DB command for efficiency.
    // This finds the one 'main' document, then updates one item
    // in the 'class_locations' map.
    
    // This $set command resets the class, sets it active, and adds the location.
    const updateOperation = {
      $set: {
        [`class_locations.${classCode}.isAttendanceActive`]: true,
        [`class_locations.${classCode}.location`]: coords,
        [`class_locations.${classCode}.presentCount`]: 0,
        [`class_locations.${classCode}.presentList`]: []
      }
    };

    await db.collection('data').updateOne({ _id: 'main' }, updateOperation);
    
    console.log(`[SERVER] Session started for ${classCode}. Attendance reset.`);
    res.json({ success: true, message: `Session for ${classCode} started.` });

  } catch (err) {
    console.error("[SERVER] Error starting session:", err);
    res.status(500).json({ success: false, message: 'Server error: ' + err.message });
  }
});

// --- NEW ENDPOINT: Student Marks Attendance ---
app.post('/api/mark-attendance', async (req, res) => {
  try {
    const { classCode, userId } = req.body;

    if (!classCode || !userId) {
      return res.status(400).json({ success: false, message: 'Missing class code or user ID.' });
    }

    // This is an "atomic" operation. It's safe and fast.
    // It finds the class, increments ($inc) the count,
    // and adds the user's ID to the list ($addToSet).
    // $addToSet ensures a student can't be added twice.
    const updateOperation = {
      $inc: { [`class_locations.${classCode}.presentCount`]: 1 },
      $addToSet: { [`class_locations.${classCode}.presentList`]: userId }
    };
    
    const result = await db.collection('data').updateOne({ _id: 'main' }, updateOperation);

    if (result.modifiedCount > 0) {
      console.log(`[SERVER] Attendance marked for ${userId} in ${classCode}.`);
      res.json({ success: true, message: 'Attendance Marked!' });
    } else {
      // This happens if $addToSet finds the user is already in the list!
      console.log(`[SERVER] Attendance was already marked for ${userId}.`);
      res.json({ success: true, message: 'Attendance Already Marked.' });
    }

  } catch (err) {
    console.error("[SERVER] Error marking attendance:", err);
    res.status(500).json({ success: false, message: 'Server error: ' + err.message });
  }
});

// --- Student Verifies Location Endpoint (No changes) ---
app.post('/api/verify-location', async (req, res) => { /* ... no change ... */ });

// --- Start Server (No changes) ---
async function startServer() { /* ... no change ... */ }
startServer();

// --- Haversine Formula (No changes) ---
function calculateHaversineDistance(lat1, lon1, lat2, lon2) { /* ... no change ... */ }

// Helper function definitions for date/time (to avoid "not defined" errors)
function getCurrentDay() {
  const options = { weekday: 'long', timeZone: 'Asia/KKolkata' };
  return new Intl.DateTimeFormat('en-US', options).format(new Date());
}
function getCurrentTime() {
  const options = { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata', hour12: false };
  const parts = new Intl.DateTimeFormat('en-IN', options).formatToParts(new Date());
  const hour = parts.find(p => p.type === 'hour').value;
  const minute = parts.find(p => p.type === 'minute').value;
  return `${hour}:${minute}`;
}