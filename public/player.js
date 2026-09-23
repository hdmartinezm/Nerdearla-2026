/* ============================================================
   NERDEARLA QUIZ — Player logic
   ============================================================ */

const socket = io();

// ── State ──────────────────────────────────────────────────
let myName = '';
let myScore = 0;
let hasAnswered = false;
let timerInterval = null;
let resultsInterval = null;

// ── Screen helpers ─────────────────────────────────────────
const screens = {
  join:     document.getElementById('screen-join'),
  waiting:  document.getElementById('screen-waiting'),
  question: document.getElementById('screen-question'),
  results:  document.getElementById('screen-results'),
  final:    document.getElementById('screen-final'),
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

// ── Random avatars ─────────────────────────────────────────
const AVATARS = ['😎','🦄','🐲','🤖','🦊','🐙','👾','🧠','🚀','🎩','🦁','🐧','🍕','🔥','⚡','🎮'];
function randomAvatar() {
  return AVATARS[Math.floor(Math.random() * AVATARS.length)];
}

const OPTION_ICONS = ['🔴', '🔵', '🟡', '🟢'];

// ── Join ───────────────────────────────────────────────────
const joinBtn  = document.getElementById('join-btn');
const codeInput = document.getElementById('code-input');
const nameInput = document.getElementById('name-input');

// Auto-uppercase the code field
codeInput.addEventListener('input', () => {
  codeInput.value = codeInput.value.toUpperCase();
});

// Allow Enter to submit
nameInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') joinBtn.click();
});

joinBtn.addEventListener('click', () => {
  const code = codeInput.value.trim();
  const name = nameInput.value.trim();

  if (!code) return showToast('Ingresá el código de sala.');
  if (!name) return showToast('Ingresá tu nombre.');

  joinBtn.disabled = true;
  joinBtn.textContent = 'Uniéndose...';

  socket.emit('join_room', { code, name }, (res) => {
    joinBtn.disabled = false;
    joinBtn.innerHTML = '🚀 Entrar';

    if (res.error) return showToast(res.error);

    myName = res.name;
    document.getElementById('waiting-name').textContent = myName;
    document.getElementById('player-avatar').textContent = randomAvatar();
    showScreen('waiting');
  });
});

// ── New question received ──────────────────────────────────
socket.on('new_question', (data) => {
  stopTimers();
  hasAnswered = false;

  // Reset answered overlay
  const overlay = document.getElementById('answered-overlay');
  overlay.style.display = 'none';

  // Header
  document.getElementById('p-q-badge').textContent = `Pregunta ${data.index + 1} / ${data.total}`;
  document.getElementById('p-question-text').textContent = data.text;

  // Render option buttons
  const grid = document.getElementById('options-grid');
  grid.innerHTML = '';
  grid.style.display = 'grid';

  data.options.forEach((opt) => {
    const btn = document.createElement('button');
    btn.className = `option-btn opt-${opt.index}`;
    btn.innerHTML = `<span class="opt-icon">${OPTION_ICONS[opt.index]}</span>${escapeHtml(opt.text)}`;
    btn.dataset.index = opt.index;
    btn.addEventListener('click', () => submitAnswer(opt.index, btn));
    grid.appendChild(btn);
  });

  showScreen('question');
  startPlayerTimer(data.timeLimit);
});

// ── Timer ──────────────────────────────────────────────────
function startPlayerTimer(seconds) {
  const timerText = document.getElementById('p-timer');
  const timerBar  = document.getElementById('p-timer-bar');
  let remaining = seconds;

  timerText.textContent = remaining;
  timerBar.style.width = '100%';

  timerInterval = setInterval(() => {
    remaining--;
    timerText.textContent = remaining;
    const pct = (remaining / seconds) * 100;
    timerBar.style.width = `${Math.max(0, pct)}%`;

    if (remaining <= 0) {
      clearInterval(timerInterval);
      if (!hasAnswered) disableAllOptions();
    }
  }, 1000);
}

// ── Submit answer ──────────────────────────────────────────
function submitAnswer(optionIndex, clickedBtn) {
  if (hasAnswered) return;
  hasAnswered = true;
  clearInterval(timerInterval);

  // Visual feedback on buttons
  disableAllOptions();
  clickedBtn.style.transform = 'scale(1.05)';
  clickedBtn.style.boxShadow = '0 0 0 4px rgba(255,255,255,0.4)';

  socket.emit('submit_answer', { optionIndex }, (res) => {
    if (!res || res.error) return;

    myScore += res.points;

    // Show answered overlay
    const grid = document.getElementById('options-grid');
    grid.style.display = 'none';

    const overlay = document.getElementById('answered-overlay');
    overlay.style.display = 'flex';
    overlay.style.flexDirection = 'column';
    overlay.style.alignItems = 'center';

    if (res.isCorrect) {
      document.getElementById('answered-icon').textContent = '✅';
      document.getElementById('answered-label').textContent = '¡Correcto!';
      document.getElementById('answered-label').style.color = 'var(--green)';
    } else {
      document.getElementById('answered-icon').textContent = '❌';
      document.getElementById('answered-label').textContent = 'Incorrecto';
      document.getElementById('answered-label').style.color = 'var(--red)';
    }

    document.getElementById('answered-points').textContent = `+${res.points}`;
    document.getElementById('score-total').textContent = `Total: ${myScore.toLocaleString()} pts`;

    // Brief feedback overlay flash
    showFeedbackOverlay(res.isCorrect, res.points);
  });
}

// ── Feedback overlay ───────────────────────────────────────
function showFeedbackOverlay(isCorrect, points) {
  const overlay = document.getElementById('feedback-overlay');
  document.getElementById('feedback-icon').textContent = isCorrect ? '✅' : '❌';
  document.getElementById('feedback-pts').textContent = isCorrect ? `+${points}` : 'Sin puntos';
  overlay.classList.add('show');
  setTimeout(() => overlay.classList.remove('show'), 1200);
}

// ── Disable all answer buttons ─────────────────────────────
function disableAllOptions() {
  document.querySelectorAll('#options-grid .option-btn').forEach(b => b.disabled = true);
}

// ── Question results ───────────────────────────────────────
socket.on('question_results', (data) => {
  stopTimers();

  document.getElementById('p-correct-answer').textContent = data.correctText;
  document.getElementById('p-correct-count').textContent = data.correctCount;
  document.getElementById('p-total-players').textContent = data.totalPlayers;

  renderRankingList(data.ranking, 'p-mid-ranking');
  showScreen('results');

  // Countdown
  let cd = 5;
  document.getElementById('p-results-countdown').textContent = cd;
  resultsInterval = setInterval(() => {
    cd--;
    document.getElementById('p-results-countdown').textContent = cd;
    if (cd <= 0) clearInterval(resultsInterval);
  }, 1000);
});

// ── Final ranking ──────────────────────────────────────────
socket.on('game_finished', ({ ranking }) => {
  stopTimers();

  // Find my position
  const myPos = ranking.findIndex(r => r.name === myName);
  const MEDALS = ['🥇', '🥈', '🥉'];

  if (myPos >= 0) {
    document.getElementById('my-rank').textContent = MEDALS[myPos] || `#${myPos + 1}`;
    document.getElementById('my-score').textContent =
      `${ranking[myPos].score.toLocaleString()} pts`;
  } else {
    document.getElementById('my-rank').textContent = '—';
    document.getElementById('my-score').textContent = '0 pts';
  }

  renderRankingList(ranking, 'p-final-ranking');
  showScreen('final');
});

// ── Error / disconnect ─────────────────────────────────────
socket.on('game_error', (msg) => {
  showToast(msg, 'error');
});

socket.on('disconnect', () => {
  showToast('Perdiste la conexión. Recargá la página.', 'error');
});

// ── Play again ─────────────────────────────────────────────
document.getElementById('play-again-btn').addEventListener('click', () => {
  window.location.reload();
});

// ── Helpers ────────────────────────────────────────────────
function stopTimers() {
  clearInterval(timerInterval);
  clearInterval(resultsInterval);
}

const MEDALS = ['🥇', '🥈', '🥉'];

function renderRankingList(ranking, containerId) {
  const el = document.getElementById(containerId);
  el.innerHTML = '';
  ranking.forEach((entry, i) => {
    const li = document.createElement('li');
    li.className = 'ranking-item';
    // Highlight the current player
    if (entry.name === myName) {
      li.style.borderColor = 'var(--purple)';
      li.style.background = 'rgba(108,59,255,0.15)';
    }
    li.innerHTML = `
      <span class="rank-medal">${MEDALS[i] || `${i + 1}`}</span>
      <span class="rank-name">${escapeHtml(entry.name)}${entry.name === myName ? ' <span style="color:var(--purple2);font-size:0.75rem;">(vos)</span>' : ''}</span>
      <span class="rank-score">${entry.score.toLocaleString()} pts</span>
    `;
    el.appendChild(li);
  });
}

function escapeHtml(str) {
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
