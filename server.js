const express = require('express');
const path = require('path');
const fs = require('fs');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;
const DB_FILE = path.join(__dirname, 'database.json');

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname)));

// Load initial database state
let db = {
  riders: {},
  gpxRoute: null
};

if (fs.existsSync(DB_FILE)) {
  try {
    const raw = fs.readFileSync(DB_FILE, 'utf8');
    db = JSON.parse(raw);
  } catch (e) {
    console.log('Database init error, creating fresh DB...');
  }
}

function saveDB() {
  try {
    fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2), 'utf8');
  } catch (e) {
    console.error('Failed to save DB:', e);
  }
}

// SSE Clients List for Public Real-time Streaming
let sseClients = [];

function broadcastToClients(event, data) {
  sseClients.forEach(client => {
    client.res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  });
}

// 1. GET /api/riders - Public API to get all riders & breadcrumbs
app.get('/api/riders', (req, res) => {
  res.json(Object.values(db.riders));
});

// 2. POST /api/location - Rider HP sends GPS coordinates
app.post('/api/location', (req, res) => {
  const data = req.body;
  if (!data || !data.bib) {
    return res.status(400).json({ error: 'Missing BIB number' });
  }

  const { bib, name, category, lat, lng, speed, distanceKm, battery, status, lastUpdate } = data;

  let rider = db.riders[bib];
  if (!rider) {
    rider = {
      id: `rider-${bib}`,
      bib,
      name: name || `Rider #${bib}`,
      category: category || 'Solo Unsupported',
      status: status || 'moving',
      speed: speed || 0,
      distanceKm: distanceKm || 0,
      lat,
      lng,
      battery: battery || 100,
      lastUpdate: lastUpdate || new Date().toLocaleTimeString(),
      trail: []
    };
    db.riders[bib] = rider;
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
  if (rider.trail.length > 1000) rider.trail.shift(); // Keep last 1000 trackpoints

  saveDB();

  // Broadcast to all connected public spectators via SSE
  broadcastToClients('LOCATION_UPDATE', rider);

  res.json({ success: true, rider });
});

// 3. POST /api/sos - Emergency Alert
app.post('/api/sos', (req, res) => {
  const data = req.body;
  broadcastToClients('SOS_ALERT', data);
  res.json({ success: true });
});

// 4. GET /api/events - Server-Sent Events (SSE) Stream for Public Live Map
app.get('/api/events', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const clientId = Date.now();
  const newClient = { id: clientId, res };
  sseClients.push(newClient);

  // Send initial riders state
  res.write(`event: INITIAL_RIDERS\ndata: ${JSON.stringify(Object.values(db.riders))}\n\n`);

  req.on('close', () => {
    sseClients = sseClients.filter(c => c.id !== clientId);
  });
});

// 5. POST /api/clear - Clear Database
app.post('/api/clear', (req, res) => {
  db.riders = {};
  saveDB();
  broadcastToClients('CLEAR_RIDERS', {});
  res.json({ success: true });
});

// Catch-all route to serve SPA index.html
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`🚀 Racemap Server running on port ${PORT}`);
});
