const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const { registerSocketHandlers } = require('./socket');

const app = express();
const server = http.createServer(app);

// Socket.IO — transports config is AWS ALB friendly (sticky sessions required for ws)
const io = new Server(server, {
  cors: { origin: '*' },
  transports: ['websocket', 'polling'],
});

// Serve static frontend files
app.use(express.static(path.join(__dirname, '../public')));
app.use(express.json());

// Health check endpoint (used by AWS ALB target groups)
app.get('/health', (req, res) => res.json({ status: 'ok' }));

// Organizer page
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/organizer.html'));
});

// Player page
app.get('/play', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/player.html'));
});

// Register all Socket.IO event handlers
registerSocketHandlers(io);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🚀 Quiz server running at http://localhost:${PORT}`);
  console.log(`   Organizer: http://localhost:${PORT}/`);
  console.log(`   Players:   http://localhost:${PORT}/play`);
});
