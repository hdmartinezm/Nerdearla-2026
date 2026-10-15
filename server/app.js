require('dotenv').config();

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const cookieParser = require('cookie-parser');

const { registerSocketHandlers } = require('./socket');
const {
  requireAuth,
  requireAuthSocket,
  handleCallback,
  handleLogout,
  handleMe,
} = require('./auth');

const app = express();
const server = http.createServer(app);

// Socket.IO — transports config is AWS ALB friendly (sticky sessions required for ws)
const io = new Server(server, {
  cors: { origin: '*' },
  transports: ['websocket', 'polling'],
});

// ── Middleware ────────────────────────────────────────────
app.use(cookieParser());
app.use(express.json());

// ── Rutas públicas (sin auth) ─────────────────────────────

// Health check (AWS ALB target group)
app.get('/health', (req, res) => res.json({ status: 'ok' }));

// Callback de Cognito después del login
app.get('/callback', handleCallback);

// Logout — borra cookie y redirige a Cognito logout
app.get('/logout', handleLogout);

// Datos del usuario autenticado (para el frontend)
app.get('/me', handleMe);

// Página de jugadores — sin autenticación
app.get('/play', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/player.html'));
});

// ── Rutas protegidas (requieren login de Cognito) ─────────

// Panel del organizador — requiere auth
app.get('/', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, '../public/organizer.html'));
});

// ── Archivos estáticos (CSS, JS del cliente) ──────────────
// Va después de las rutas nombradas para no interceptarlas
app.use(express.static(path.join(__dirname, '../public')));

// ── Socket.IO — solo organizadores necesitan auth ─────────
// El middleware requireAuthSocket se aplica globalmente pero
// solo se valida en el evento create_room (ver socket.js).
// Los jugadores se conectan sin token.
registerSocketHandlers(io, requireAuthSocket);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🚀 Quiz server running at http://localhost:${PORT}`);
  console.log(`   Organizer: http://localhost:${PORT}/`);
  console.log(`   Players:   http://localhost:${PORT}/play`);
});
