// server.js
const express = require('express');
const bodyParser = require('body-parser');
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcrypt');
const WebSocket = require('ws');

const app = express();
const PORT = process.env.PORT || 8080;
const usersFile = path.join(__dirname, 'users.json');

// Ensure users.json exists
if (!fs.existsSync(usersFile)) fs.writeFileSync(usersFile, '[]');

app.use(bodyParser.json());
app.use(express.static(__dirname)); // serve html/css/js

// --- SIGNUP ---
app.post('/signup', async (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).send('Missing username or password');

    let users = JSON.parse(fs.readFileSync(usersFile, 'utf8'));
    if (users.some(u => u.username === username)) return res.status(400).send('Username taken');

    try {
        const passwordHash = await bcrypt.hash(password, 10);
        const newUser = {
            id: 'u_' + Date.now(),
            username,
            passwordHash,
            displayName: username,
            role: 'agent',
            createdAt: new Date().toISOString()
        };
        users.push(newUser);
        fs.writeFileSync(usersFile, JSON.stringify(users, null, 2));
        res.send('ok');
    } catch (err) {
        res.status(500).send('Server error');
    }
});

// --- LOGIN ---
app.post('/login', async (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).send('Missing username or password');

    const users = JSON.parse(fs.readFileSync(usersFile, 'utf8'));
    const user = users.find(u => u.username === username);
    if (!user) return res.status(400).send('Invalid username or password');

    const match = await bcrypt.compare(password, user.passwordHash);
    if (!match) return res.status(400).send('Invalid username or password');

    res.send({ status: 'ok', username: user.username });
});

// --- Serve HTML pages ---
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'signup.html')));
app.get('/index.html', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

// --- Start HTTP server ---
const server = app.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
});

// --- WebSocket server for real-time chat ---
const wss = new WebSocket.Server({ server });

wss.on('connection', (ws) => {
    ws.on('message', (message) => {
        wss.clients.forEach(client => {
            if (client.readyState === WebSocket.OPEN) client.send(message);
        });
    });
});
