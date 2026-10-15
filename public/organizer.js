/* ============================================================
   NERDEARLA QUIZ — Organizer logic
   ============================================================
   Autenticación:
   - El id_token de Cognito vive en una cookie httpOnly (el server lo maneja).
   - Para pasarlo a Socket.IO (que no puede leer cookies httpOnly),
     el servidor expone GET /me que devuelve {username, email} si la sesión
     es válida. Si no lo es, redirige a /logout.
   - La conexión Socket.IO usa el namespace /organizer que requiere auth.
     Pasamos un flag `authenticated: true` en el handshake — el servidor
     ya validó la cookie en la ruta GET /, así que confiamos en la sesión.
   ============================================================ */

// ── Estado ─────────────────────────────────────────────────
let socket = null;
let questionCount = 0;
let timerInterval = null;
let resultsInterval = null;
let currentTimerSeconds = 0;
let currentTimerLimit = 0;
let answeredCount = 0;
let totalPlayers = 0;

const liveAnswerCounts = [0, 0, 0, 0];

// ── Screen helpers ─────────────────────────────────────────
const screens = {
  build:    document.getElementById('screen-build'),
  lobby:    document.getElementById('screen-lobby'),
  question: document.getElementById('screen-question'),
  results:  document.getElementById('screen-results'),
  final:    document.getElementById('screen-final'),
  expired:  document.getElementById('screen-expired'),
};

function showScreen(name) {
  Object.values(screens).forEach(s => s.classList.remove('active'));
  screens[name].classList.add('active');
}

// ── Toast ──────────────────────────────────────────────────
const toastEl = document.getElementById('toast');
let toastTimer;
function showToast(msg, type = 'error') {
  toastEl.textContent = msg;
  toastEl.className = `toast ${type} show`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('show'), 3500);
}

// ── Init: verificar sesión y conectar Socket.IO ────────────
async function init() {
  try {
    const res = await fetch('/me');
    if (!res.ok) {
      // Sesión inválida — mostrar pantalla de expiración
      showScreen('expired');
      return;
    }

    const user = await res.json();

    // Mostrar nombre del usuario en el header
    const userDisplay = document.getElementById('user-display');
    if (userDisplay) userDisplay.textContent = user.username || user.email;

    // Conectar al namespace /organizer
    // La cookie httpOnly ya valida la sesión en el GET /,
    // pero Socket.IO no puede leerla. Usamos withCredentials para
    // enviar la cookie en el handshake HTTP (polling) y pasamos
    // el username como identificador en auth.
    socket = io('/organizer', {
      withCredentials: true,
      auth: { username: user.username },
    });

    socket.on('connect_error', (err) => {
      if (err.message === 'AUTH_REQUIRED' || err.message === 'AUTH_INVALID') {
        showScreen('expired');
      } else {
        showToast('Error de conexión. Recarga la página.');
      }
    });

    registerSocketEvents();

  } catch {
    showScreen('expired');
  }
}

// ── Question builder ───────────────────────────────────────
const OPTION_LABELS = ['A', 'B', 'C', 'D'];
const DEFAULT_TIME = 30;

function createQuestionBlock() {
  questionCount++;
  const idx = questionCount;

  const div = document.createElement('div');
  div.className = 'question-block';
  div.dataset.qid = idx;

  div.innerHTML = `
    <div class="q-number">Pregunta ${idx}</div>
    <button class="remove-q-btn" data-remove="${idx}">✕ Eliminar</button>

    <div class="field">
      <label>Pregunta</label>
      <textarea class="q-text" placeholder="¿Cuál es la respuesta al universo?" rows="2"></textarea>
    </div>

    <div class="field">
      <label>Tiempo límite (segundos)</label>
      <input type="number" class="q-time" value="${DEFAULT_TIME}" min="5" max="120" style="max-width:120px;" />
    </div>

    <div class="field">
      <label>Opciones — marca la correcta ✓</label>
      ${[0,1,2,3].map(i => `
        <div class="option-row">
          <span class="option-color-dot dot-${i}"></span>
          <span style="font-size:0.85rem; font-weight:700; color:var(--muted); width:16px;">${OPTION_LABELS[i]}</span>
          <input type="text" class="opt-text opt-${i}" placeholder="Opción ${OPTION_LABELS[i]}" />
          <input type="radio" class="correct-radio" name="correct-${idx}" value="${i}" title="Marcar como correcta" />
          <span class="correct-label">Correcta</span>
        </div>
      `).join('')}
    </div>
  `;

  div.querySelector('[data-remove]').addEventListener('click', () => {
    div.remove();
    reNumberQuestions();
  });

  return div;
}

function reNumberQuestions() {
  document.querySelectorAll('.question-block').forEach((block, i) => {
    block.querySelector('.q-number').textContent = `Pregunta ${i + 1}`;
  });
}

function addQuestion() {
  const list = document.getElementById('questions-list');
  list.appendChild(createQuestionBlock());
}

document.getElementById('add-question-btn').addEventListener('click', addQuestion);

// Start with one question
addQuestion();

// ── Collect questions from the form ───────────────────────
function collectQuestions() {
  const blocks = document.querySelectorAll('.question-block');
  const questions = [];

  for (const block of blocks) {
    const text = block.querySelector('.q-text').value.trim();
    const timeLimit = parseInt(block.querySelector('.q-time').value) || DEFAULT_TIME;
    const options = [];
    const checkedRadio = block.querySelector('.correct-radio:checked');

    for (let i = 0; i < 4; i++) {
      const optText = block.querySelector(`.opt-${i}`).value.trim();
      options.push({
        text: optText,
        isCorrect: checkedRadio && parseInt(checkedRadio.value) === i,
      });
    }

    questions.push({ text, options, timeLimit });
  }

  return questions;
}

// ── Register all Socket.IO events ─────────────────────────
function registerSocketEvents() {

  // ── Create room ──────────────────────────────────────────
  document.getElementById('create-room-btn').addEventListener('click', () => {
    const questions = collectQuestions();
    const btn = document.getElementById('create-room-btn');
    btn.disabled = true;
    btn.textContent = 'Creando sala...';

    socket.emit('create_room', questions, (res) => {
      btn.disabled = false;
      btn.innerHTML = '🚀 Crear sala y obtener código';

      if (res.error) return showToast(res.error);

      document.getElementById('room-code-display').textContent = res.code;
      const host = window.location.host;
      document.getElementById('play-url').textContent = `${host}/play`;

      showScreen('lobby');
    });
  });

  // ── Lobby: player events ─────────────────────────────────
  socket.on('player_joined', ({ playerCount, players }) => {
    totalPlayers = playerCount;
    document.getElementById('player-count').textContent = playerCount;
    renderPlayerChips(players);
    document.getElementById('start-game-btn').disabled = playerCount === 0;
  });

  socket.on('player_left', ({ playerCount, players }) => {
    totalPlayers = playerCount;
    document.getElementById('player-count').textContent = playerCount;
    renderPlayerChips(players);
    document.getElementById('start-game-btn').disabled = playerCount === 0;
  });

  // ── Start game ───────────────────────────────────────────
  document.getElementById('start-game-btn').addEventListener('click', () => {
    socket.emit('start_game', (res) => {
      if (res?.error) showToast(res.error);
    });
  });

  // ── New question ─────────────────────────────────────────
  socket.on('new_question', (data) => {
    stopTimers();
    answeredCount = 0;

    liveAnswerCounts.fill(0);
    for (let i = 0; i < 4; i++) {
      const bar = document.getElementById(`bar-${i}`);
      if (bar) { bar.style.height = '4px'; bar.textContent = '0'; }
    }

    document.getElementById('q-badge').textContent = `Pregunta ${data.index + 1} / ${data.total}`;
    document.getElementById('org-question-text').textContent = data.text;
    document.getElementById('answered-count').textContent = '0';
    document.getElementById('total-players').textContent = totalPlayers;
    document.getElementById('answer-progress-bar').style.width = '0%';

    showScreen('question');
    startOrgTimer(data.timeLimit);
  });

  // ── Live answer tracking ─────────────────────────────────
  socket.on('answer_update', ({ answered, total }) => {
    answeredCount = answered;
    totalPlayers = total;
    document.getElementById('answered-count').textContent = answered;
    document.getElementById('total-players').textContent = total;
    const pct = total > 0 ? (answered / total) * 100 : 0;
    document.getElementById('answer-progress-bar').style.width = `${pct}%`;
  });

  // ── Force next ───────────────────────────────────────────
  document.getElementById('force-next-btn').addEventListener('click', () => {
    socket.emit('force_next');
  });

  // ── Question results ─────────────────────────────────────
  socket.on('question_results', (data) => {
    stopTimers();

    document.getElementById('correct-answer-display').textContent = data.correctText;

    const maxCount = Math.max(1, ...data.answersCount);
    for (let i = 0; i < 4; i++) {
      const bar = document.getElementById(`rbar-${i}`);
      if (!bar) continue;
      const count = data.answersCount[i] || 0;
      const heightPct = (count / maxCount) * 74 + 6;
      bar.style.height = `${heightPct}px`;
      bar.textContent = count;
    }

    document.getElementById('correct-count-label').textContent =
      `${data.correctCount} de ${data.totalPlayers} respondieron correctamente`;

    renderRankingList(data.ranking, 'mid-ranking');

    showScreen('results');

    let cd = 5;
    document.getElementById('results-countdown').textContent = cd;
    resultsInterval = setInterval(() => {
      cd--;
      document.getElementById('results-countdown').textContent = cd;
      if (cd <= 0) clearInterval(resultsInterval);
    }, 1000);
  });

  // ── Final ranking ────────────────────────────────────────
  socket.on('game_finished', ({ ranking }) => {
    stopTimers();
    renderRankingList(ranking, 'final-ranking');
    showScreen('final');
  });

  // ── Error ────────────────────────────────────────────────
  socket.on('game_error', (msg) => {
    showToast(msg, 'error');
  });

  // ── New game ─────────────────────────────────────────────
  document.getElementById('new-game-btn').addEventListener('click', () => {
    window.location.reload();
  });
}

// ── Timer for organizer ────────────────────────────────────
function startOrgTimer(seconds) {
  currentTimerLimit = seconds;
  currentTimerSeconds = seconds;

  const timerText = document.getElementById('org-timer');
  const timerBar = document.getElementById('org-timer-bar');

  timerText.textContent = seconds;
  timerBar.style.width = '100%';

  timerInterval = setInterval(() => {
    currentTimerSeconds--;
    timerText.textContent = currentTimerSeconds;
    const pct = (currentTimerSeconds / currentTimerLimit) * 100;
    timerBar.style.width = `${Math.max(0, pct)}%`;
    if (currentTimerSeconds <= 0) clearInterval(timerInterval);
  }, 1000);
}

function stopTimers() {
  clearInterval(timerInterval);
  clearInterval(resultsInterval);
}

// ── Render helpers ─────────────────────────────────────────
function renderPlayerChips(players) {
  const chips = document.getElementById('player-chips');
  chips.innerHTML = '';
  players.forEach(name => {
    const chip = document.createElement('span');
    chip.className = 'player-chip';
    chip.textContent = name;
    chips.appendChild(chip);
  });
}

const MEDALS = ['🥇', '🥈', '🥉'];

function renderRankingList(ranking, containerId) {
  const el = document.getElementById(containerId);
  el.innerHTML = '';
  ranking.forEach((entry, i) => {
    const li = document.createElement('li');
    li.className = 'ranking-item';
    li.innerHTML = `
      <span class="rank-medal">${MEDALS[i] || `${i + 1}`}</span>
      <span class="rank-name">${escapeHtml(entry.name)}</span>
      <span class="rank-score">${entry.score.toLocaleString()} pts</span>
    `;
    el.appendChild(li);
  });
}

function escapeHtml(str) {
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// ── Arrancar ───────────────────────────────────────────────
init();
