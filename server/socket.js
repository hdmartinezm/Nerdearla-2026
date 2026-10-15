/**
 * Socket.IO event handlers — all real-time communication lives here.
 *
 * Event flow:
 *  Organizer creates quiz  → server verifica JWT → crea room, envía código
 *  Players join with name  → server adds them, broadcasts updated lobby
 *  Organizer starts game   → server broadcasts questions one by one
 *  Players answer          → server scores and updates organizer live
 *  After each question     → server shows results + mid-game ranking
 *  After last question     → server broadcasts final ranking
 *
 * Auth:
 *  - Organizadores envían el id_token de Cognito en socket.handshake.auth.token
 *  - El middleware requireAuthSocket (en app.js) lo valida antes de conectar
 *  - Jugadores se conectan sin token (no pasan el middleware de auth)
 */

const game = require('./game');

// Seconds to show the results screen between questions
const RESULTS_DISPLAY_SECONDS = 5;

/**
 * @param {import('socket.io').Server} io
 * @param {Function} requireAuthSocket  — middleware de auth para Socket.IO
 */
function registerSocketHandlers(io, requireAuthSocket) {

  // Namespace exclusivo para organizadores — requiere JWT válido
  const orgNsp = io.of('/organizer');
  orgNsp.use(requireAuthSocket);

  // Namespace para jugadores — sin autenticación
  const playerNsp = io.of('/player');

  // ─────────────────────────────────────────────
  // ORGANIZER namespace
  // ─────────────────────────────────────────────
  orgNsp.on('connection', (socket) => {
    console.log(`[ORG +] ${socket.user.username} (${socket.id})`);

    // ── Create room ──────────────────────────────
    socket.on('create_room', (questions, callback) => {
      if (!Array.isArray(questions) || questions.length === 0) {
        return callback({ error: 'Necesitas al menos una pregunta.' });
      }

      // Validate questions
      for (const q of questions) {
        if (!q.text?.trim()) return callback({ error: 'Todas las preguntas necesitan texto.' });
        if (!Array.isArray(q.options) || q.options.length < 2) {
          return callback({ error: 'Cada pregunta necesita al menos 2 opciones.' });
        }
        if (!q.options.some(o => o.isCorrect)) {
          return callback({ error: `La pregunta "${q.text}" no tiene respuesta correcta marcada.` });
        }
        if (!q.timeLimit || q.timeLimit < 5 || q.timeLimit > 120) {
          return callback({ error: 'El tiempo límite debe estar entre 5 y 120 segundos.' });
        }
      }

      const room = game.createRoom(socket.id, questions);
      socket.join(room.code);
      console.log(`[ROOM] ${socket.user.username} creó sala ${room.code} con ${questions.length} preguntas`);
      callback({ code: room.code });
    });

    // ── Start game ───────────────────────────────
    socket.on('start_game', (callback) => {
      const room = game.getRoomByOrganizer(socket.id);
      if (!room) return callback?.({ error: 'No tienes una sala activa.' });
      if (room.players.size === 0) return callback?.({ error: 'Espera que se una alguien primero.' });
      if (room.state !== 'lobby') return callback?.({ error: 'La partida ya comenzó.' });

      console.log(`[GAME] ${socket.user.username} inicia sala ${room.code} con ${room.players.size} jugadores`);
      broadcastNextQuestion(io, orgNsp, playerNsp, room);
      callback?.({ ok: true });
    });

    // ── Force next ───────────────────────────────
    socket.on('force_next', () => {
      const room = game.getRoomByOrganizer(socket.id);
      if (room && room.state === 'question') {
        endQuestion(io, orgNsp, playerNsp, room);
      }
    });

    // ── Disconnect ───────────────────────────────
    socket.on('disconnect', () => {
      console.log(`[ORG -] ${socket.user?.username} (${socket.id})`);

      const ownedRoom = game.getRoomByOrganizer(socket.id);
      if (ownedRoom) {
        clearTimeout(ownedRoom.questionTimer);
        // Notificar a jugadores en su namespace
        playerNsp.to(ownedRoom.code).emit('game_error', 'El organizador se desconectó. La partida terminó.');
        game.deleteRoom(ownedRoom.code);
      }
    });
  });

  // ─────────────────────────────────────────────
  // PLAYER namespace
  // ─────────────────────────────────────────────
  playerNsp.on('connection', (socket) => {
    console.log(`[PLY +] ${socket.id}`);

    // ── Join room ────────────────────────────────
    socket.on('join_room', ({ code, name }, callback) => {
      if (!code?.trim() || !name?.trim()) {
        return callback({ error: 'Necesitas un código y un nombre.' });
      }

      const result = game.joinRoom(code.toUpperCase(), socket.id, name);
      if (result.error) return callback({ error: result.error });

      socket.join(code.toUpperCase());
      console.log(`[PLY] ${name} se unió a sala ${code}`);

      // Notificar al organizador (en su namespace)
      const room = result.room;
      orgNsp.to(room.organizerSocketId).emit('player_joined', {
        name: result.player.name,
        playerCount: room.players.size,
        players: Array.from(room.players.values()).map(p => p.name),
      });

      callback({ ok: true, name: result.player.name });
    });

    // ── Submit answer ────────────────────────────
    socket.on('submit_answer', ({ optionIndex }, callback) => {
      const room = game.getRoomByPlayer(socket.id);
      if (!room) return callback?.({ error: 'No estás en ninguna sala.' });

      const result = game.submitAnswer(room, socket.id, optionIndex);
      if (!result) return callback?.({ error: 'No se pudo registrar la respuesta.' });

      callback?.({ ok: true, isCorrect: result.isCorrect, points: result.points });

      // Actualizar al organizador con el progreso
      const answered = Array.from(room.players.values()).filter(p => p.answeredThisRound).length;
      orgNsp.to(room.organizerSocketId).emit('answer_update', {
        answered,
        total: room.players.size,
      });

      // Si todos respondieron, terminar la pregunta antes de tiempo
      if (answered === room.players.size) {
        endQuestion(io, orgNsp, playerNsp, room);
      }
    });

    // ── Disconnect ───────────────────────────────
    socket.on('disconnect', () => {
      console.log(`[PLY -] ${socket.id}`);

      const room = game.removePlayer(socket.id);
      if (room) {
        orgNsp.to(room.organizerSocketId).emit('player_left', {
          playerCount: room.players.size,
          players: Array.from(room.players.values()).map(p => p.name),
        });
      }
    });
  });
}

// ─────────────────────────────────────────────────────────
// Internal helpers
// ─────────────────────────────────────────────────────────

/**
 * Broadcast the next question to everyone in the room.
 */
function broadcastNextQuestion(io, orgNsp, playerNsp, room) {
  const questionData = game.nextQuestion(room);

  if (!questionData) {
    return finishGame(orgNsp, playerNsp, room);
  }

  console.log(`[Q] Sala ${room.code}: pregunta ${questionData.index + 1}/${questionData.total}`);

  orgNsp.to(room.code).emit('new_question', questionData);
  playerNsp.to(room.code).emit('new_question', questionData);

  room.questionTimer = setTimeout(() => {
    endQuestion(io, orgNsp, playerNsp, room);
  }, questionData.timeLimit * 1000);
}

/**
 * End the current question: show results, then move on.
 */
function endQuestion(io, orgNsp, playerNsp, room) {
  if (room.state !== 'question') return;
  room.state = 'scores';

  clearTimeout(room.questionTimer);

  const results = game.getQuestionResults(room);
  console.log(`[END Q] Sala ${room.code}: ${results.correctCount}/${results.totalPlayers} correctas`);

  orgNsp.to(room.code).emit('question_results', results);
  playerNsp.to(room.code).emit('question_results', results);

  room.questionTimer = setTimeout(() => {
    broadcastNextQuestion(io, orgNsp, playerNsp, room);
  }, RESULTS_DISPLAY_SECONDS * 1000);
}

/**
 * Broadcast final ranking and mark game as finished.
 */
function finishGame(orgNsp, playerNsp, room) {
  room.state = 'finished';
  const ranking = game.getRanking(room);
  console.log(`[FINISH] Sala ${room.code}. Ganador: ${ranking[0]?.name}`);
  orgNsp.to(room.code).emit('game_finished', { ranking });
  playerNsp.to(room.code).emit('game_finished', { ranking });
}

module.exports = { registerSocketHandlers };
