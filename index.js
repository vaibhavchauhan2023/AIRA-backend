// 1. Import necessary libraries
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { MongoClient } = require('mongodb');
const path = require('path');
const bcrypt = require('bcrypt'); // Make sure bcrypt is here

// 2. Initialize the app
const app = express();
const PORT = 4000;
const MONGO_URI = process.env.MONGO_URI;
const DB_NAME = 'proxy-project';

// 3. Setup middleware
// --- UPGRADE ---
// We are making our CORS policy more open for deployment
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

// --- UPGRADE: This function now also checks if the teacher started the class ---
// --- NEW FUNCTION FOR STUDENTS ---
// This is our old function, renamed.
// A student's class is "live" only if the time is right AND the teacher has started it.

function getStudentTimetable(timetableForToday, classLocations) {
  const now = getCurrentTime();

  return timetableForToday.map(cls => {
    const classStatus = classLocations[cls.code];

    // Check 1: Is the time correct?
    const isTimeCorrect = (now >= cls.startTime && now < cls.endTime);

    // Check 2: Did the teacher activate this class?
    const isTeacherActive = (classStatus && classStatus.isAttendanceActive === true);

    // "live" is only true if BOTH are true
    const isLive = isTimeCorrect && isTeacherActive;

    return {
      ...cls,
      live: isLive
    };
  });
}

// --- NEW FUNCTION FOR TEACHERS ---
// A teacher's class is "live" if ONLY the time is right.
// This allows them to see the button to start the session.
function getTeacherTimetable(timetableForToday) {
  const now = getCurrentTime();

  return timetableForToday.map(cls => {
    // Check 1: Is the time correct?
    const isTimeCorrect = (now >= cls.startTime && now < cls.endTime);

    return {
      ...cls,
      live: isTimeCorrect // The 'live' flag is set based ONLY on time.
    };
  });
}

// ==========================================================
// API Endpoints
// ==========================================================

// --- Login Endpoint (UPGRADED) ---
app.post('/api/login', async (req, res) => {
  try {
    const { userType, userId, password } = req.body;
    
    console.log(`[DEBUG] Login attempt: type=${userType}, id=${userId}`);
    
    if (!password) {
      return res.status(400).json({ success: false, message: 'Password is required.' });
    }

    const dbData = await readDatabase();
    
    // --- UPGRADE ---
    // The key for the user list is now just the user ID,
    // because we combined student and teacher logins.
    // Or, we can keep using the old key for simplicity. Let's stick to the old key.
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

      // --- HERE IS THE FIX ---
      if (user.type === 'teacher') {
        // Teachers only need to check the time
        dynamicTimetable = getTeacherTimetable(timetableForToday);
      } else {
        // Students need to check both time AND teacher activation
        dynamicTimetable = getStudentTimetable(timetableForToday, dbData.class_locations);
      } 
      // ---------------------

      const userToSend = { ...user };
      delete userToSend.passwordHash;

      res.json({ success: true, user: userToSend, timetable: dynamicTimetable });
      
      delete userToSend.passwordHash;

      res.json({ success: true, user: userToSend, timetable: dynamicTimetable });
    } else {
      res.status(401).json({ success: false, message: 'Invalid User ID or Password' });
    }
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error: ' + err.message });
  }
});


// --- NEW/UPGRADED: Teacher Starts Session Endpoint ---
// This replaces '/api/set-location'
app.post('/api/start-session', async (req, res) => {
  try {
    const { classCode, coords } = req.body;
    const dbData = await readDatabase();
    
    if (!(classCode in dbData.class_locations)) {
      return res.status(404).json({ success: false, message: 'Class not found' });
    }

    // --- NEW LOGIC: Reset all other classes ---
    // This ensures only one class can be active at a time.
    for (const code in dbData.class_locations) {
      if (code !== classCode) {
        dbData.class_locations[code].isAttendanceActive = false;
      }
    }
    
    // --- NEW LOGIC: Activate the current class ---
    dbData.class_locations[classCode].location = coords;
    dbData.class_locations[classCode].isAttendanceActive = true;
      
    await writeDatabase(dbData);
    
    console.log(`[SERVER] Session started for ${classCode} at:`, coords);
    res.json({ success: true, message: `Session for ${classCode} started.` });

  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error: ' + err.message });
  }
});


// --- Student Verifies Location Endpoint (UPGRADED) ---
// We just need to check the new data structure
app.post('/api/verify-location', async (req, res) => {
  try {
    const { classCode, coords: studentCoords } = req.body;
    const dbData = await readDatabase();
    
    // --- UPGRADE: Read location from new structure ---
    const classStatus = dbData.class_locations[classCode];
    const goldenCoords = classStatus ? classStatus.location : null;
    
    if (!goldenCoords) {
      return res.status(400).json({ success: false, message: 'Teacher has not started this session yet.' });
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
// Start the Server (Added our debug log line)
// ==========================================================
async function startServer() {
  console.log("!!!!!!!!!! SERVER IS RUNNING THE LATEST CODE !!!!!!!!!!");
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