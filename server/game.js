/**
 * In-memory game state manager.
 * Each "room" represents one quiz session.
 *
 * For AWS multi-instance deployments, replace this with
 * a Redis adapter (socket.io-redis) + ElastiCache.
 */

const { v4: uuidv4 } = require('uuid');

// Map of gameCode -> room object
const rooms = new Map();

// How many points a perfect (instant) answer gives
const MAX_POINTS = 1000;

/**
 * Generate a random 6-character uppercase room code.
 */
function generateCode() {
  let code;
  do {
    code = Math.random().toString(36).substring(2, 8).toUpperCase();
  } while (rooms.has(code));
  return code;
}

/**
 * Create a new game room owned by a socket.
 * @param {string} organizerSocketId
 * @param {Array}  questions  — validated question list from organizer
 * @returns {object} room
 */
function createRoom(organizerSocketId, questions) {
  const code = generateCode();
  const room = {
    code,
    organizerSocketId,
    questions,          // [{ text, options: [{text, isCorrect}], timeLimit }]
    players: new Map(), // socketId -> { name, score, answers: [] }
    state: 'lobby',     // lobby | question | scores | finished
    currentQuestion: -1,
    questionTimer: null,
    questionStartTime: null,
  };
  rooms.set(code, room);
  return room;
}

/**
 * Add a player to a room.
 * Returns null if room doesn't exist or game already started.
 */
function joinRoom(code, socketId, name) {
  const room = rooms.get(code);
  if (!room) return { error: 'Sala no encontrada. Verificá el código.' };
  if (room.state !== 'lobby') return { error: 'La partida ya comenzó. Intentá en la próxima.' };

  // Prevent duplicate names
  for (const player of room.players.values()) {
    if (player.name.toLowerCase() === name.trim().toLowerCase()) {
      return { error: 'Ese nombre ya está en uso. Elegí otro.' };
    }
  }

  const player = { name: name.trim(), score: 0, answers: [] };
  room.players.set(socketId, player);
  return { room, player };
}

/**
 * Remove a player (on disconnect).
 */
function removePlayer(socketId) {
  for (const room of rooms.values()) {
    if (room.players.has(socketId)) {
      room.players.delete(socketId);
      return room;
    }
  }
  return null;
}

/**
 * Get the room for a given organizer socket.
 */
function getRoomByOrganizer(socketId) {
  for (const room of rooms.values()) {
    if (room.organizerSocketId === socketId) return room;
  }
  return null;
}

/**
 * Get the room a player is in.
 */
function getRoomByPlayer(socketId) {
  for (const room of rooms.values()) {
    if (room.players.has(socketId)) return room;
  }
  return null;
}

/**
 * Advance to the next question. Returns the question data to broadcast.
 * Returns null if there are no more questions.
 */
function nextQuestion(room) {
  room.currentQuestion += 1;
  if (room.currentQuestion >= room.questions.length) return null;

  room.state = 'question';
  room.questionStartTime = Date.now();

  // Clear any previous "answered" flag for this round
  for (const player of room.players.values()) {
    player.answeredThisRound = false;
  }

  const q = room.questions[room.currentQuestion];
  return {
    index: room.currentQuestion,
    total: room.questions.length,
    text: q.text,
    options: q.options.map((o, i) => ({ index: i, text: o.text })), // don't send isCorrect to players
    timeLimit: q.timeLimit,
  };
}

/**
 * Process a player's answer.
 * Returns scoring info or null if invalid.
 */
function submitAnswer(room, socketId, optionIndex) {
  const player = room.players.get(socketId);
  if (!player) return null;
  if (room.state !== 'question') return null;
  if (player.answeredThisRound) return null; // already answered

  player.answeredThisRound = true;

  const q = room.questions[room.currentQuestion];
  const elapsed = Date.now() - room.questionStartTime;
  const timeLimitMs = q.timeLimit * 1000;
  const isCorrect = q.options[optionIndex]?.isCorrect === true;

  let points = 0;
  if (isCorrect) {
    // Points decrease linearly with time: full points if instant, 0 if at time limit
    const ratio = Math.max(0, 1 - elapsed / timeLimitMs);
    points = Math.round(MAX_POINTS * ratio);
    // Minimum 100 points for a correct answer regardless of speed
    points = Math.max(100, points);
  }

  player.score += points;
  player.answers.push({ questionIndex: room.currentQuestion, optionIndex, isCorrect, points });

  return { isCorrect, points, totalScore: player.score };
}

/**
 * Build the ranking list, sorted by score descending.
 */
function getRanking(room) {
  return Array.from(room.players.entries())
    .map(([, p]) => ({ name: p.name, score: p.score }))
    .sort((a, b) => b.score - a.score);
}

/**
 * Get results for the current question (called after time is up).
 */
function getQuestionResults(room) {
  const q = room.questions[room.currentQuestion];
  const correctIndex = q.options.findIndex(o => o.isCorrect);
  const answersCount = Array(q.options.length).fill(0);
  let correctCount = 0;

  for (const player of room.players.values()) {
    const ans = player.answers.find(a => a.questionIndex === room.currentQuestion);
    if (ans !== undefined) {
      answersCount[ans.optionIndex] = (answersCount[ans.optionIndex] || 0) + 1;
      if (ans.isCorrect) correctCount++;
    }
  }

  return {
    correctIndex,
    correctText: q.options[correctIndex].text,
    answersCount,
    correctCount,
    totalPlayers: room.players.size,
    ranking: getRanking(room).slice(0, 5), // top 5 for mid-game preview
  };
}

/**
 * Delete a room (game finished or organizer left).
 */
function deleteRoom(code) {
  rooms.delete(code);
}

module.exports = {
  createRoom,
  joinRoom,
  removePlayer,
  getRoomByOrganizer,
  getRoomByPlayer,
  nextQuestion,
  submitAnswer,
  getQuestionResults,
  getRanking,
  deleteRoom,
};
