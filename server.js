// server.js
const express = require('express');
const app = express();
const path = require('path');
const fs = require('fs');

// --- Config ---
const PORT = process.env.PORT || 10000;
const OFFLINE_FILE = path.join(__dirname, 'offlineData.json');
const OFFLINE_SAVE_INTERVAL = 5000; // Save offline data every 5 seconds
const POINTS_PER_SECOND_OFFLINE = 1; // Points earned per second offline

// --- In-memory storage ---
let currentPlayers = 0; // Players currently connected
let totalPlayers = 0;   // Total players who have ever played
let activePlayers = new Set(); // Track active players
let reviews = [];               // Last 100 reviews
let offlineData = new Map();    // Offline player data keyed by playerId or IP

// --- Load persistent offlineData ---
if (fs.existsSync(OFFLINE_FILE)) {
  try {
    const raw = JSON.parse(fs.readFileSync(OFFLINE_FILE, 'utf8') || '{}');
    offlineData = new Map(Object.entries(raw));
    // Convert points/lastSeen to numbers
    for (const [k, v] of offlineData) {
      v.points = Number(v.points || 0);
      v.lastSeen = Number(v.lastSeen || Date.now());
      offlineData.set(k, v);
    }
  } catch (err) {
    console.error('Error loading offlineData.json:', err);
    offlineData = new Map();
  }
}

// --- Helper functions ---
app.set('trust proxy', true); // For accurate IPs behind reverse proxies

function getClientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) return forwarded.split(',')[0].trim();
  return req.ip || req.connection.remoteAddress || '';
}

function awardOfflinePoints(stored, nowMs) {
  const elapsedMs = Math.max(0, nowMs - (stored.lastSeen || nowMs));
  const points = Math.floor(elapsedMs / 1000) * POINTS_PER_SECOND_OFFLINE;
  stored.points = (stored.points || 0) + points;
  stored.lastSeen = nowMs;
  return stored;
}

// Persist offlineData to file periodically
function persistOfflineData() {
  try {
    const obj = Object.fromEntries([...offlineData.entries()]);
    fs.writeFileSync(OFFLINE_FILE, JSON.stringify(obj, null, 2));
  } catch (e) {
    console.error('Error saving offlineData:', e);
  }
}
setInterval(persistOfflineData, OFFLINE_SAVE_INTERVAL);
process.on('exit', persistOfflineData);
process.on('SIGINT', () => { persistOfflineData(); process.exit(); });

// --- Middleware: track active players & offline points ---
app.use(express.json());
app.use(express.static('public'));

app.use((req, res, next) => {
  const clientId = req.headers['x-client-id'] || getClientIp(req) || Date.now() + Math.random();
  const now = Date.now();

  // Update offline points
  let stored = offlineData.get(clientId);
  if (!stored) {
    stored = { points: 0, lastSeen: now };
  } else {
    stored = awardOfflinePoints(stored, now);
  }
  offlineData.set(clientId, stored);

  // Track active players
  activePlayers.add(clientId);
  currentPlayers = activePlayers.size;
  totalPlayers = Math.max(totalPlayers, currentPlayers);

  req.on('close', () => {
    activePlayers.delete(clientId);
    currentPlayers = activePlayers.size;
  });

  next();
});

// --- Serve main.html ---
app.get('/', (req, res) => {
  totalPlayers++;
  res.sendFile(path.join(__dirname, 'public', 'main.html'));
});

// --- Player count endpoints ---
app.get('/player-count', (req, res) => {
  res.json({ current: currentPlayers, total: totalPlayers });
});

app.get('/player-count-stream', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'Access-Control-Allow-Origin': '*'
  });
  res.write(`data: ${JSON.stringify({ current: currentPlayers, total: totalPlayers })}\n\n`);
  const interval = setInterval(() => {
    res.write(`data: ${JSON.stringify({ current: currentPlayers, total: totalPlayers })}\n\n`);
  }, 5000);
  req.on('close', () => clearInterval(interval));
});

// --- Reviews endpoints ---
app.post('/submit-review', (req, res) => {
  const { text, timestamp } = req.body;
  if (!text || !timestamp) return res.json({ success: false, error: 'Missing required fields' });
  reviews.push({ text, timestamp });
  if (reviews.length > 100) reviews = reviews.slice(-100);
  res.json({ success: true });
});

app.get('/get-reviews', (req, res) => {
  res.json({ reviews: reviews.slice(-10).reverse() });
});

// --- Offline data endpoints ---
app.post('/save-offline-data', (req, res) => {
  const { playerId, offlineData: data } = req.body;
  if (!playerId || !data) return res.json({ success: false, error: 'Missing required fields' });
  offlineData.set(playerId, data);
  res.json({ success: true });
});

app.post('/get-offline-data', (req, res) => {
  const { playerId } = req.body;
  if (!playerId) return res.json({ success: false, error: 'Missing player ID' });
  const data = offlineData.get(playerId);
  if (data) res.json({ success: true, data });
  else res.json({ success: false, error: 'No offline data found' });
});

// --- Endpoint to get live points by clientId or IP ---
app.get('/my-offline', (req, res) => {
  const clientId = req.headers['x-client-id'] || getClientIp(req);
  if (!clientId) return res.json({ success: false, error: 'No client ID or IP found' });
  const now = Date.now();
  let stored = offlineData.get(clientId);
  if (!stored) stored = { points: 0, lastSeen: now };
  else stored = awardOfflinePoints(stored, now);
  offlineData.set(clientId, stored);
  res.json({ success: true, points: stored.points, lastSeen: stored.lastSeen });
});

// --- Start server ---
app.listen(PORT, () => console.log(`Kitten Clicker server running on port ${PORT}`));
