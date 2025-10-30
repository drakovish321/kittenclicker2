// server.js
const express = require('express');
const app = express();
const path = require('path');
const fs = require('fs');

// Data file for persistent storage
const DATA_FILE = path.join(__dirname, 'data.json');

// Load or initialize data
let data = {
  totalPlayers: 0,
  reviews: []
};
if (fs.existsSync(DATA_FILE)) {
  try {
    const loaded = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    data = { ...data, ...loaded };
  } catch (err) {
    console.error('Failed to read data.json, starting fresh:', err);
  }
}

// In-memory runtime state
let currentPlayers = 0; // Players currently connected
let activePlayers = new Set(); // Track active player sessions

app.use(express.json());
app.use(express.static('public')); // Serve frontend (main.html, etc.)

// Middleware to track active players
app.use((req, res, next) => {
  const clientId = req.headers['x-client-id'] || Date.now() + Math.random();

  // Add player to active set
  activePlayers.add(clientId);
  currentPlayers = activePlayers.size;

  // Remove player when connection closes
  req.on('close', () => {
    activePlayers.delete(clientId);
    currentPlayers = activePlayers.size;
  });

  next();
});

// Serve main.html at root
app.get('/', (req, res) => {
  data.totalPlayers++;
  saveData();
  res.sendFile(path.join(__dirname, 'public', 'main.html'));
});

// Endpoint: Get current + total player count
app.get('/player-count', (req, res) => {
  res.json({
    current: currentPlayers,
    total: data.totalPlayers
  });
});

// Endpoint: Real-time player count via Server-Sent Events
app.get('/player-count-stream', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'Access-Control-Allow-Origin': '*'
  });

  // Send initial count
  res.write(`data: ${JSON.stringify({ current: currentPlayers, total: data.totalPlayers })}\n\n`);

  // Send updates every 5 seconds
  const interval = setInterval(() => {
    res.write(`data: ${JSON.stringify({ current: currentPlayers, total: data.totalPlayers })}\n\n`);
  }, 5000);

  req.on('close', () => {
    clearInterval(interval);
  });
});

// Endpoint: Submit a review
app.post('/submit-review', (req, res) => {
  const { text, timestamp } = req.body;

  if (!text || !timestamp) {
    return res.json({ success: false, error: 'Missing required fields' });
  }

  data.reviews.push({
    text: text.trim(),
    timestamp
  });

  // Keep last 100 reviews
  if (data.reviews.length > 100) {
    data.reviews = data.reviews.slice(-100);
  }

  saveData();
  res.json({ success: true });
});

// Endpoint: Get latest reviews
app.get('/get-reviews', (req, res) => {
  res.json({
    reviews: data.reviews.slice(-10).reverse()
  });
});

// Save data to file
function saveData() {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
  } catch (err) {
    console.error('Failed to save data:', err);
  }
}

// Start server
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`🐾 Kitten Clicker server running on port ${PORT}`);
});
