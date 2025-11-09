// --- VERSION 2 ---
// 1. Import necessary libraries
// --- V4 FINAL DEPLOY ----
// --- V5 FINAL DEPLOY ----
require('dotenv').config();
const express = require('express');
const cors = require('cors'); // <-- We will use this
const { MongoClient, ObjectId } = require('mongodb');
const path = require('path');
const bcrypt = require('bcrypt');

// 2. Initialize the app
const app = express();
const PORT = 4000;
const MONGO_URI = process.env.MONGO_URI;
const DB_NAME = 'proxy-project';

// 3. Setup middleware
// --- THIS IS THE FIX ---
// This simple version allows ALL websites to make requests.
// This is more robust and solves our problem.
app.use(cors()); 
// -----------------------
app.use(express.json());

// ==========================================================
// Database Connection
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
// Date and Time Helpers
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

function getStudentTimetable(timetableForToday, classLocations, userId) {
  const now = getCurrentTime();
  
  return timetableForToday.map(cls => {
    const classStatus = classLocations[cls.code];
    const isTimeCorrect = (now >= cls.startTime && now < cls.endTime);
    const isTeacherActive = (classStatus && classStatus.isAttendanceActive === true);
    const isLive = isTimeCorrect && isTeacherActive;
    const isMarked = (classStatus && classStatus.presentList.includes(userId));
    
    return { ...cls, live: isLive, isMarked: isMarked };
  });
}

function getTeacherTimetable(timetableForToday, classLocations) {
  const now = getCurrentTime();
  
  return timetableForToday.map(cls => {
    const classStatus = classLocations[cls.code];
    const isTimeCorrect = (now >= cls.startTime && now < cls.endTime);
    const presentCount = (classStatus ? classStatus.presentCount : 0);
    
    return { ...cls, live: isTimeCorrect, presentCount: presentCount };
  });
}

// ==========================================================
// API Endpoints
// ==========================================================

// --- Login Endpoint ---
app.post('/api/login', async (req, res) => {
  try {
    const { userType, userId, password } = req.body;
    console.log(`[DEBUG] Login attempt: type=${userType}, id=${userId}`);
    
    if (!password) {
      return res.status(400).json({ success: false, message: 'Password is required.' });
    }

    const dbData = await readDatabase();
    const key = `${userType}-${userId}`;
    const user = dbData.users[key];
    
    console.log(`[DEBUG] User found in DB:`, user);

    if (!user) {
      return res.status(401).json({ success: false, message: 'Invalid User ID or Password' });
    }
    if (!user.passwordHash) {
      return res.status(500).json({ success: false, message: 'User has no password set.' });
    }

    const isMatch = await bcrypt.compare(password, user.passwordHash);
    console.log(`[DEBUG] Password match result: ${isMatch}`);

    if (isMatch) {
      const today = getCurrentDay();
      const timetableId = user.timetableId;
      const weeklyTimetable = dbData.master_timetables[timetableId];
      const timetableForToday = weeklyTimetable ? (weeklyTimetable[today] || []) : [];
      
      let dynamicTimetable;
      
      if (user.type === 'teacher') {
        dynamicTimetable = getTeacherTimetable(timetableForToday, dbData.class_locations);
      } else {
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


// --- Teacher Starts Session Endpoint ---
app.post('/api/start-session', async (req, res) => {
  try {
    const { classCode, coords } = req.body;
    
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
    
    const updateOperation = {
      $inc: { [`class_locations.${classCode}.presentCount`]: 1 },
      $addToSet: { [`class_locations.${classCode}.presentList`]: userId }
    };
    
    const result = await db.collection('data').updateOne({ _id: 'main' }, updateOperation);

    if (result.modifiedCount > 0) {
      console.log(`[SERVER] Attendance marked for ${userId} in ${classCode}.`);
      res.json({ success: true, message: 'Attendance Marked!' });
    } else {
      console.log(`[SERVER] Attendance was already marked for ${userId}.`);
      res.json({ success: true, message: 'Attendance Already Marked.' });
    }

  } catch (err) {
    console.error("[SERVER] Error marking attendance:", err);
    res.status(500).json({ success: false, message: 'Server error: ' + err.message });
  }
});

// --- Student Verifies Location Endpoint ---
app.post('/api/verify-location', async (req, res) => {
  try {
    const { classCode, coords: studentCoords } = req.body;
    
    const dbData = await readDatabase(); 
    const classStatus = dbData.class_locations[classCode];
    const goldenCoords = classStatus ? classStatus.location : null;
    
    if (!goldenCoords) {
      return res.status(400).json({ success: false, message: 'Teacher has not started this session yet.' });
    }
    
    const distance = calculateHaversineDistance(
      goldenCoords.lat, goldenCoords.lon,
      studentCoords.lat, studentCoords.lon
    );
    
    // Using a 2km "demo" radius
    const GEOFENCE_RADIUS = 2000; 
    
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
  console.log("!!!!!!!!!! SERVER IS RUNNING THE LATEST CODE (v2) !!!!!!!!!!");
  await connectToDb();
  
  app.listen(PORT, () => {
    console.log(`[SERVER] Backend server is running on http://localhost:${PORT}`);
    console.log(`[SERVER] Current server day: ${getCurrentDay()}`);
    console.log(`[SERVER] Current server time (IST): ${getCurrentTime()}`);
  });
}

startServer();

// ==========================================================
// Helper Function: Haversine Formula (No changes)
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