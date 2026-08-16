const express = require('express');
const path = require('path');
const fs = require('fs');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;
const DB_FILE = path.join(__dirname, 'database.json');

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname)));

// Load Database
let db = {
  riders: {},
  credentials: {},
  gpxRoute: null,
  checkpoints: [],
  mode: 'fixed'
};

function loadDB() {
  if (fs.existsSync(DB_FILE)) {
    try {
      const raw = fs.readFileSync(DB_FILE, 'utf8');
      db = JSON.parse(raw);
      if (!db.riders) db.riders = {};
      if (!db.credentials) db.credentials = {};
    } catch (e) {
      console.error('DB Load Error:', e);
    }
  }
}

function saveDB() {
  try {
    fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2), 'utf8');
  } catch (e) {
    console.error('DB Save Error:', e);
  }
}

loadDB();

// Server-Sent Events (SSE) clients for Public Live Stream
let sseClients = [];

function broadcastToPublic(event, data) {
  sseClients.forEach(client => {
    client.res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  });
}

/* ==========================================================================
   PUBLIC SPECTATOR ENDPOINTS
   ========================================================================== */

// 1. Get All Active Riders for Spectator View
app.get('/api/riders', (req, res) => {
  res.json(Object.values(db.riders));
});

// 2. Get Event GPX Route & Mode
app.get('/api/route', (req, res) => {
  res.json({
    route: db.gpxRoute,
    checkpoints: db.checkpoints || [],
    mode: db.mode || 'fixed'
  });
});

// 3. SSE Stream for Real-time Public Spectator Map
app.get('/api/events', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const clientId = Date.now();
  const newClient = { id: clientId, res };
  sseClients.push(newClient);

  // Send current state to newly connected spectator
  res.write(`event: INITIAL_STATE\ndata: ${JSON.stringify({
    riders: Object.values(db.riders),
    route: db.gpxRoute,
    checkpoints: db.checkpoints || [],
    mode: db.mode || 'fixed'
  })}\n\n`);

  req.on('close', () => {
    sseClients = sseClients.filter(c => c.id !== clientId);
  });
});

/* ==========================================================================
   RIDER TRACKER AUTH & GPS ENDPOINTS
   ========================================================================== */

// Rider Login with BIB & PIN
app.post('/api/auth/login', (req, res) => {
  const { bib, pin } = req.body;
  if (!bib || !pin) {
    return res.status(400).json({ error: 'BIB dan PIN wajib diisi.' });
  }

  const cleanBib = String(bib).trim();
  const cleanPin = String(pin).trim();

  if (db.credentials[cleanBib] && db.credentials[cleanBib] === cleanPin) {
    const rider = db.riders[cleanBib] || {
      bib: cleanBib,
      name: `Rider #${cleanBib}`,
      category: 'Solo Unsupported'
    };
    return res.json({ success: true, rider });
  } else {
    return res.status(401).json({ error: 'Nomor BIB atau PIN salah! Hubungi Panitia/Admin.' });
  }
});

// Rider sends GPS Location Update
app.post('/api/location', (req, res) => {
  const data = req.body;
  const { bib, pin, lat, lng, speed, distanceKm, battery, status, lastUpdate } = data;

  if (!bib) return res.status(400).json({ error: 'Missing BIB' });

  const cleanBib = String(bib).trim();

  // Verify PIN if credential exists
  if (db.credentials[cleanBib] && pin && db.credentials[cleanBib] !== String(pin).trim()) {
    return res.status(401).json({ error: 'Unauthorized PIN' });
  }

  let rider = db.riders[cleanBib];
  if (!rider) {
    rider = {
      id: `rider-${cleanBib}`,
      bib: cleanBib,
      name: data.name || `Rider #${cleanBib}`,
      category: data.category || 'Solo Unsupported',
      status: status || 'moving',
      speed: speed || 0,
      distanceKm: distanceKm || 0,
      lat,
      lng,
      battery: battery || 100,
      lastUpdate: lastUpdate || new Date().toLocaleTimeString(),
      trail: []
    };
    db.riders[cleanBib] = rider;
  } else {
    rider.lat = lat;
    rider.lng = lng;
    rider.speed = speed;
    rider.distanceKm = distanceKm;
    rider.battery = battery;
    rider.status = status;
    rider.lastUpdate = lastUpdate || new Date().toLocaleTimeString();
  }

  if (!rider.trail) rider.trail = [];
  rider.trail.push({ lat, lng, timestamp: Date.now() });
  if (rider.trail.length > 1000) rider.trail.shift();

  saveDB();

  // Broadcast to all public spectators in real-time
  broadcastToPublic('LOCATION_UPDATE', rider);

  res.json({ success: true });
});

// Emergency SOS Alert
app.post('/api/sos', (req, res) => {
  const data = req.body;
  broadcastToPublic('SOS_ALERT', data);
  res.json({ success: true });
});

/* ==========================================================================
   ADMIN RACE CONTROL ENDPOINTS
   ========================================================================== */

// Admin Creates New Rider Account (BIB, Name, Category, PIN)
app.post('/api/admin/riders', (req, res) => {
  const { bib, name, category, pin } = req.body;

  if (!bib || !name || !pin) {
    return res.status(400).json({ error: 'BIB, Nama, dan PIN Wajib diisi!' });
  }

  const cleanBib = String(bib).trim();
  const cleanPin = String(pin).trim();

  db.credentials[cleanBib] = cleanPin;
  db.riders[cleanBib] = {
    id: `rider-${cleanBib}`,
    bib: cleanBib,
    name: String(name).trim(),
    category: category || 'Solo Unsupported',
    status: 'stopped',
    speed: 0,
    distanceKm: 0,
    lat: -6.1754,
    lng: 106.8272,
    battery: 100,
    lastUpdate: 'Belum Aktif',
    trail: []
  };

  saveDB();
  broadcastToPublic('RIDER_CREATED', db.riders[cleanBib]);

  res.json({ success: true, rider: db.riders[cleanBib] });
});

// Admin Deletes Rider Account
app.delete('/api/admin/riders/:bib', (req, res) => {
  const bib = String(req.params.bib).trim();
  delete db.riders[bib];
  delete db.credentials[bib];
  saveDB();

  broadcastToPublic('RIDER_DELETED', { bib });
  res.json({ success: true });
});

// Admin Uploads GPX Route & Checkpoints
app.post('/api/admin/gpx', (req, res) => {
  const { routePoints, checkpoints } = req.body;
  if (!routePoints) return res.status(400).json({ error: 'No route data' });

  db.gpxRoute = routePoints;
  if (checkpoints) db.checkpoints = checkpoints;

  saveDB();
  broadcastToPublic('ROUTE_UPDATED', { route: db.gpxRoute, checkpoints: db.checkpoints });

  res.json({ success: true });
});

// Admin Toggles Race Mode ("fixed" vs "free")
app.post('/api/admin/mode', (req, res) => {
  const { mode } = req.body;
  db.mode = mode || 'fixed';
  saveDB();

  broadcastToPublic('MODE_UPDATED', { mode: db.mode });
  res.json({ success: true, mode: db.mode });
});

// Admin Clear All Event Data
app.post('/api/admin/clear', (req, res) => {
  db.riders = {};
  db.credentials = {};
  db.gpxRoute = null;
  db.checkpoints = [];
  saveDB();

  broadcastToPublic('CLEAR_EVENT', {});
  res.json({ success: true });
});

/* ==========================================================================
   PAGE ROUTING (Separate Clean Pages)
   ========================================================================== */

app.get('/tracker', (req, res) => {
  res.sendFile(path.join(__dirname, 'tracker.html'));
});

app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'admin.html'));
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`🚀 Racemap Production Server running on port ${PORT}`);
});
