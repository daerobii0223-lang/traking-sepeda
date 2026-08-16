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

let sseClients = [];

function broadcastToPublic(event, data) {
  sseClients.forEach(client => {
    client.res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  });
}

/* ==========================================================================
   PUBLIC SPECTATOR ENDPOINTS
   ========================================================================== */

app.get('/api/riders', (req, res) => {
  res.json(Object.values(db.riders));
});

app.get('/api/route', (req, res) => {
  res.json({
    route: db.gpxRoute,
    checkpoints: db.checkpoints || [],
    mode: db.mode || 'fixed'
  });
});

app.get('/api/events', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const clientId = Date.now();
  const newClient = { id: clientId, res };
  sseClients.push(newClient);

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
   AUTHENTICATION ENDPOINTS
   ========================================================================== */

app.post('/api/auth/admin-login', (req, res) => {
  const { username, password } = req.body;
  if (username === 'admin' && password === 'admin') {
    return res.json({ success: true, token: 'admin-authenticated-session-888' });
  } else {
    return res.status(401).json({ error: 'Username atau Password Admin Salah!' });
  }
});

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

/* ==========================================================================
   RIDER GPS TRACKING ENDPOINTS (STRICT BINDING PER BIB)
   ========================================================================== */

app.post('/api/location', (req, res) => {
  const data = req.body;
  const { bib, pin, lat, lng, speed, distanceKm, battery, status, lastUpdate } = data;

  if (!bib || String(bib).trim() === '' || String(bib) === 'undefined') {
    return res.status(400).json({ error: 'Missing or Invalid BIB Number' });
  }

  const cleanBib = String(bib).trim();

  // Verify PIN if credential exists for security
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
    rider.lat = Number(lat);
    rider.lng = Number(lng);
    rider.speed = Number(speed || 0);
    rider.distanceKm = Number(distanceKm || 0);
    rider.battery = Number(battery || 100);
    rider.status = status || 'moving';
    rider.lastUpdate = lastUpdate || new Date().toLocaleTimeString();
  }

  if (!rider.trail) rider.trail = [];
  
  // Deduplicate consecutive identical coordinates
  const lastTrail = rider.trail[rider.trail.length - 1];
  if (!lastTrail || Math.abs(lastTrail.lat - lat) > 0.0001 || Math.abs(lastTrail.lng - lng) > 0.0001) {
    rider.trail.push({ lat: Number(lat), lng: Number(lng), timestamp: Date.now() });
    if (rider.trail.length > 1000) rider.trail.shift();
  }

  saveDB();

  // Broadcast location update of THIS specific rider to all connected public spectators
  broadcastToPublic('LOCATION_UPDATE', rider);

  res.json({ success: true });
});

app.post('/api/sos', (req, res) => {
  const data = req.body;
  broadcastToPublic('SOS_ALERT', data);
  res.json({ success: true });
});

/* ==========================================================================
   ADMIN ENDPOINTS
   ========================================================================== */

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

app.delete('/api/admin/riders/:bib', (req, res) => {
  const bib = String(req.params.bib).trim();
  delete db.riders[bib];
  delete db.credentials[bib];
  saveDB();

  broadcastToPublic('RIDER_DELETED', { bib });
  res.json({ success: true });
});

app.post('/api/admin/gpx', (req, res) => {
  const { routePoints, checkpoints } = req.body;
  if (!routePoints) return res.status(400).json({ error: 'No route data' });

  db.gpxRoute = routePoints;
  if (checkpoints) db.checkpoints = checkpoints;

  saveDB();
  broadcastToPublic('ROUTE_UPDATED', { route: db.gpxRoute, checkpoints: db.checkpoints });

  res.json({ success: true });
});

app.post('/api/admin/mode', (req, res) => {
  const { mode } = req.body;
  db.mode = mode || 'fixed';
  saveDB();

  broadcastToPublic('MODE_UPDATED', { mode: db.mode });
  res.json({ success: true, mode: db.mode });
});

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
   PAGE ROUTING
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
