/**
 * Socket.IO event handlers — all real-time communication lives here.
 *
 * Event flow:
 *  Organizer creates quiz  → server creates room, sends back code
 *  Players join with name  → server adds them, broadcasts updated lobby
 *  Organizer starts game   → server broadcasts questions one by one
 *  Players answer          → server scores and updates organizer live
 *  After each question     → server shows results + mid-game ranking
 *  After last question     → server broadcasts final ranking
 */

const game = require('./game');

// Seconds to show the results screen between questions
const RESULTS_DISPLAY_SECONDS = 5;

function registerSocketHandlers(io) {
  io.on('connection', (socket) => {
    console.log(`[+] Connected: ${socket.id}`);

    // ─────────────────────────────────────────────
    // ORGANIZER: Create a quiz room
    // ─────────────────────────────────────────────
    socket.on('create_room', (questions, callback) => {
      if (!Array.isArray(questions) || questions.length === 0) {
        return callback({ error: 'Necesitás al menos una pregunta.' });
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
      console.log(`[ROOM] Created: ${room.code} with ${questions.length} questions`);
      callback({ code: room.code });
    });

    // ─────────────────────────────────────────────
    // PLAYER: Join a room
    // ─────────────────────────────────────────────
    socket.on('join_room', ({ code, name }, callback) => {
      if (!code?.trim() || !name?.trim()) {
        return callback({ error: 'Necesitás un código y un nombre.' });
      }

      const result = game.joinRoom(code.toUpperCase(), socket.id, name);
      if (result.error) return callback({ error: result.error });

      socket.join(code.toUpperCase());
      console.log(`[PLAYER] ${name} joined room ${code}`);

      // Tell the organizer someone new joined
      const room = result.room;
      io.to(room.organizerSocketId).emit('player_joined', {
        name: result.player.name,
        playerCount: room.players.size,
        players: Array.from(room.players.values()).map(p => p.name),
      });

      callback({ ok: true, name: result.player.name });
    });

    // ─────────────────────────────────────────────
    // ORGANIZER: Start the game
    // ─────────────────────────────────────────────
    socket.on('start_game', (callback) => {
      const room = game.getRoomByOrganizer(socket.id);
      if (!room) return callback?.({ error: 'No tenés una sala activa.' });
      if (room.players.size === 0) return callback?.({ error: 'Esperá que se una alguien primero.' });
      if (room.state !== 'lobby') return callback?.({ error: 'La partida ya comenzó.' });

      console.log(`[GAME] Starting room ${room.code} with ${room.players.size} players`);
      broadcastNextQuestion(io, room);
      callback?.({ ok: true });
    });

    // ─────────────────────────────────────────────
    // PLAYER: Submit an answer
    // ─────────────────────────────────────────────
    socket.on('submit_answer', ({ optionIndex }, callback) => {
      const room = game.getRoomByPlayer(socket.id);
      if (!room) return callback?.({ error: 'No estás en ninguna sala.' });

      const result = game.submitAnswer(room, socket.id, optionIndex);
      if (!result) return callback?.({ error: 'No se pudo registrar la respuesta.' });

      callback?.({ ok: true, isCorrect: result.isCorrect, points: result.points });

      // Tell organizer how many players answered so far
      const answered = Array.from(room.players.values()).filter(p => p.answeredThisRound).length;
      io.to(room.organizerSocketId).emit('answer_update', {
        answered,
        total: room.players.size,
      });

      // If everyone answered, end the question early
      if (answered === room.players.size) {
        endQuestion(io, room);
      }
    });

    // ─────────────────────────────────────────────
    // ORGANIZER: Manual advance (skip timer)
    // ─────────────────────────────────────────────
    socket.on('force_next', () => {
      const room = game.getRoomByOrganizer(socket.id);
      if (room && room.state === 'question') {
        endQuestion(io, room);
      }
    });

    // ─────────────────────────────────────────────
    // DISCONNECT
    // ─────────────────────────────────────────────
    socket.on('disconnect', () => {
      console.log(`[-] Disconnected: ${socket.id}`);

      // If organizer disconnected, notify players and clean up
      const ownedRoom = game.getRoomByOrganizer(socket.id);
      if (ownedRoom) {
        clearTimeout(ownedRoom.questionTimer);
        io.to(ownedRoom.code).emit('game_error', 'El organizador se desconectó. La partida terminó.');
        game.deleteRoom(ownedRoom.code);
        return;
      }

      // If player disconnected
      const room = game.removePlayer(socket.id);
      if (room) {
        io.to(room.organizerSocketId).emit('player_left', {
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
 * Sets a timer to auto-end the question when time runs out.
 */
function broadcastNextQuestion(io, room) {
  const questionData = game.nextQuestion(room);

  if (!questionData) {
    // No more questions — show final ranking
    return finishGame(io, room);
  }

  console.log(`[Q] Room ${room.code}: question ${questionData.index + 1}/${questionData.total}`);

  // Broadcast question to everyone in the room (organizer + players)
  io.to(room.code).emit('new_question', questionData);

  // Auto-advance when timer expires
  room.questionTimer = setTimeout(() => {
    endQuestion(io, room);
  }, questionData.timeLimit * 1000);
}

/**
 * End the current question: stop the timer, show results, then move on.
 */
function endQuestion(io, room) {
  if (room.state !== 'question') return; // guard against double calls
  room.state = 'scores';

  clearTimeout(room.questionTimer);

  const results = game.getQuestionResults(room);
  console.log(`[END Q] Room ${room.code}: ${results.correctCount}/${results.totalPlayers} correct`);

  io.to(room.code).emit('question_results', results);

  // After showing results, move to next question (or finish)
  room.questionTimer = setTimeout(() => {
    broadcastNextQuestion(io, room);
  }, RESULTS_DISPLAY_SECONDS * 1000);
}

/**
 * Broadcast the final ranking and mark the game as finished.
 */
function finishGame(io, room) {
  room.state = 'finished';
  const ranking = game.getRanking(room);
  console.log(`[FINISH] Room ${room.code}. Winner: ${ranking[0]?.name}`);
  io.to(room.code).emit('game_finished', { ranking });
}

module.exports = { registerSocketHandlers };
