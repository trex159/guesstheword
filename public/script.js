const socket = io();

const screenJoin = document.getElementById('screen-join');
const screenQuestion = document.getElementById('screen-question');
const screenDiscussion = document.getElementById('screen-discussion');
const screenVoting = document.getElementById('screen-voting');
const screenResult = document.getElementById('screen-result');
const screenWaiting = document.getElementById('screen-waiting');

const joinBtn = document.getElementById('joinBtn');
const createBtn = document.getElementById('createBtn');
// submitAnswerBtn removed (legacy)
const playerListContainer = document.getElementById('playerListContainer');
const playerList = document.getElementById('playerList');
const startGameBtn = document.getElementById('startGameBtn');

let playerName = '';
let currentGameCode = '';
let playersInGame = [];
let isHost = false;
let lastPlayersInGame = [];

function getByIdSafe(id) {
  const el = document.getElementById(id);
  if (!el) {
    console.warn('Element not found:', id);
  }
  return el;
}

// Helper: validate game code (letters/numbers only)
function isValidGameCode(code) {
  return /^[A-Z0-9]+$/i.test(code);
}

// Helper: map difficulty keys to readable labels (German)
function diffToLabel(d) {
  if (!d) return null;
  if (d === 'easy') return 'Easy';
  if (d === 'difficult') return 'Difficult';
  if (d === 'main') return 'Medium';
  if (d === 'custom') return 'Custom Word';
  return d;
}

// Helper: is the current player ingame?
function isCurrentPlayerIngame() {
  // Fallback: Wenn __playersInGame nicht gesetzt, lasse zu (z.B. beim ersten Start)
  if (!window.__playersInGame) return true;
  return window.__playersInGame.includes(playerName);
}

// Create game
createBtn.onclick = () => {
  playerName = document.getElementById('username').value.trim();
  let inputCode = document.getElementById('gameCode').value.trim();
  if (!playerName) {
    document.getElementById('join-error').textContent = 'Please enter a username!';
    return;
  }
  // Wenn Spielcode-Feld ausgefüllt, nutze diesen Code (Großschreibung, nur Buchstaben/Zahlen)
  let customCode = '';
  if (inputCode) {
    customCode = inputCode.toUpperCase();
    if (!isValidGameCode(customCode)) {
      document.getElementById('join-error').textContent = 'Room code may only contain letters and numbers!';
      return;
    }
  }
  socket.emit('createGame', { name: playerName, customCode }, (res) => {
    if (res.error) {
      document.getElementById('join-error').textContent = res.error;
    } else {
      currentGameCode = res.code;
      isHost = true;
      document.getElementById('gameCode').value = currentGameCode;
      showLobby();      // show lobby chat
      const lobby = document.getElementById('lobby-chat'); if (lobby) lobby.style.display = 'block';    }
  });
};

// Join game
joinBtn.onclick = () => {
  currentGameCode = document.getElementById('gameCode').value.trim().toUpperCase();
  playerName = document.getElementById('username').value.trim();
  if (!currentGameCode && !playerName) {
    document.getElementById('join-error').textContent = 'Please enter a room code and a username!';
    return;
  }
  if (!currentGameCode) {
    document.getElementById('join-error').textContent = 'Please enter a room code!';
    return;
  }
  if (!playerName) {
    document.getElementById('join-error').textContent = 'Please enter a username!';
    return;
  }

  socket.emit('joinGame', { code: currentGameCode, name: playerName }, (res) => {
    if (res.error) {
      document.getElementById('join-error').textContent = res.error;
    } else {
      isHost = false;
      showLobby();
    }
  });
};

function showLobby() {
  // hide only join/create controls while in a room (keep lobby & player list visible)
  ['gameCode','username','createBtn','joinBtn','join-error'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = 'none';
  });
  playerListContainer.style.display = 'block';
  startGameBtn.style.display = 'none';
  document.getElementById('join-error').textContent = '';
  document.getElementById('gameCode').value = currentGameCode;
  updateLobbyStatus('Waiting for more players...');
  // show lobby chat area
  const lobby = document.getElementById('lobby-chat'); if (lobby) lobby.style.display = 'block';
}

// Player list update received
socket.on('playerList', ({ players, hostName }) => {
  // Zeige Statusänderungen (Beitritt/Verlassen)
  if (lastPlayersInGame.length && players.length !== lastPlayersInGame.length) {
    if (players.length > lastPlayersInGame.length) {
      updateLobbyStatus('A player has joined.');
    } else {
      updateLobbyStatus('A player left the room.');
    }
    setTimeout(() => updateLobbyStatus('Waiting for more players...'), 2000);
  }
  lastPlayersInGame = [...players];

  playersInGame = players;
  // track which players are marked ingame for local checks
  window.__playersInGame = players.filter(p => p.ingame).map(p => p.name);

  // Hide only the join/create controls if we are in a room; show them otherwise
  const amInRoom = players.some(p => p.name === playerName);
  ['gameCode','username','createBtn','joinBtn','join-error'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = amInRoom ? 'none' : '';
  });

  playerList.innerHTML = '';
  players.forEach(obj => {
    const name = obj.name;
    const ingame = obj.ingame;
    const role = obj.role || '';
    let status = ingame ? ' (in game)' : ' (lobby)';
    const li = document.createElement('li');
    li.style.display = 'flex';
    li.style.justifyContent = 'space-between';
    li.style.alignItems = 'center';
    const left = document.createElement('div');
    left.textContent = name + (name === hostName ? ' (Host)' : '') + status;
    if (role) {
      const badge = document.createElement('span');
      badge.textContent = ' ' + role.toUpperCase();
      badge.style.fontWeight = '700';
      badge.style.marginLeft = '8px';
      left.appendChild(badge);
    }
    li.appendChild(left);

    // If current user is host, show role assignment buttons
    if (isHost && name !== playerName && !obj.role) {
      const right = document.createElement('div');
      right.style.display = 'flex';
      right.style.gap = '6px';
      const btnG = document.createElement('button');
      btnG.textContent = 'Set Guesser';
      btnG.onclick = () => {
        socket.emit('assignRole', { code: currentGameCode, name, role: 'guesser' }, (res) => { if (res && res.error) alert(res.error); });
      };
      const btnE = document.createElement('button');
      btnE.textContent = 'Set Explainer';
      btnE.onclick = () => {
        socket.emit('assignRole', { code: currentGameCode, name, role: 'explainer' }, (res) => { if (res && res.error) alert(res.error); });
      };
      right.appendChild(btnG);
      right.appendChild(btnE);
      li.appendChild(right);
    }

    playerList.appendChild(li);
  });
  // Host sees Start-Button when exactly 2 players are in the room
  if (isHost && players.length === 2) {
    startGameBtn.style.display = 'block';
    updateLobbyStatus('You can start the game!');
  } else if (isHost) {
    updateLobbyStatus('2 players required.');
  }

  // Only show the player list / lobby UI if current player is NOT marked ingame
  if (!window.__playersInGame.includes(playerName)) {
    playerListContainer.style.display = 'block';
    // Show lobby chat when in a room
    const lobbyChat = document.getElementById('lobby-chat');
    if (lobbyChat) lobbyChat.style.display = 'block';
  } else {
    // hide lobby UI while participating in a round
    playerListContainer.style.display = 'none';
    const lobby = document.getElementById('lobby-chat'); if (lobby) lobby.style.display = 'none';
  }
});

// Zeige Status in der Lobby
function updateLobbyStatus(msg) {
  let statusDiv = document.getElementById('lobbyStatus');
  if (!statusDiv) {
    statusDiv = document.createElement('div');
    statusDiv.id = 'lobbyStatus';
    statusDiv.style.margin = '0.5em 0 0.5em 0';
    statusDiv.style.fontWeight = 'bold';
    playerListContainer.insertBefore(statusDiv, playerListContainer.firstChild);
  }
  statusDiv.textContent = msg;
}

// Error display for invalid room code
socket.on('noGameFound', () => {
  document.getElementById('join-error').textContent = 'No game found with that code!';
  playerListContainer.style.display = 'none';
  const lobby = document.getElementById('lobby-chat'); if (lobby) lobby.style.display = 'none';
});

// Host starts the game
startGameBtn.onclick = () => {
  socket.emit('startGame', { code: currentGameCode });
};

// (legacy gameStarted handler removed — updated handler implemented below for Yes-No-Maybe)

// Legacy question/answer flow removed (Impostor game). The new Yes-No-Maybe flow uses chat messages and explainer answer buttons.
if (playerListContainer) playerListContainer.style.display = 'none';

// Legacy discussion flow removed; the chat shows explainer answers and system messages for Yes-No-Maybe.

// Legacy voting flow removed.

// Voting buttons removed for Yes-No-Maybe (legacy)

// Ensure result/lobby buttons only created once
function ensureResultButtons() {
  let backToLobbyBtn = document.getElementById('backToLobbyBtn');
  if (!backToLobbyBtn) {
    backToLobbyBtn = document.createElement('button');
    backToLobbyBtn.id = 'backToLobbyBtn';
    backToLobbyBtn.textContent = 'Back to Lobby';
    backToLobbyBtn.style.display = 'none';
    backToLobbyBtn.onclick = () => {
      screenResult.style.display = 'none';
      screenJoin.style.display = 'block';
      playerListContainer.style.display = 'block';
      startGameBtn.style.display = 'none';
      document.getElementById('resultText').textContent = '';
      // Entferne die Vote-Details falls vorhanden
      // legacy voteDetails cleanup (none needed for Yes-No-Maybe)
    };
    document.getElementById('screen-result').appendChild(backToLobbyBtn);
  }
}
ensureResultButtons();

// Player can leave the room
if (playerListContainer) {
  let leaveBtn = document.getElementById('leaveRoomBtn');
  if (!leaveBtn) {
    leaveBtn = document.createElement('button');
    leaveBtn.id = 'leaveRoomBtn';
    leaveBtn.textContent = 'Leave Room';
    leaveBtn.onclick = () => {
      socket.emit('leaveRoom', { code: currentGameCode });
      playerListContainer.style.display = 'none';
      // restore join/create inputs and buttons
      ['gameCode','username','createBtn','joinBtn','join-error'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.style.display = '';
      });
      startGameBtn.style.display = 'none';
      currentGameCode = '';
      isHost = false;
      playerName = '';
      document.getElementById('username').value = '';
      document.getElementById('gameCode').value = '';
      // clear chats and hide lobby chat
      const cb = document.getElementById('chat-box'); if (cb) cb.innerHTML = '';
      const lobbyBox = document.getElementById('lobby-chat-box'); if (lobbyBox) lobbyBox.innerHTML = '';
      const lobby = document.getElementById('lobby-chat'); if (lobby) lobby.style.display = 'none';
      // reset timer and word display
      timeLeft = 0; updateTimerDisplay();
      currentWord = '';
      const wd = document.getElementById('word-display'); if (wd) wd.innerText = '';
      const explEl = document.getElementById('explainer-word'); if (explEl) { explEl.style.display = 'none'; explEl.textContent = ''; }
      const hintBtn = document.querySelector('#explainer-controls #give-hint'); if (hintBtn) { hintBtn.disabled = true; hintBtn.style.display = 'none'; }
    };
    playerListContainer.appendChild(leaveBtn);
  }
}

// Remove the sample function at the end of the file:
// function safeButton(id, text, handler) {
//   let btn = getByIdSafe(id);
//   if (!btn) {
//     btn = document.createElement('button');
//     btn.id = id;
//     btn.textContent = text;
//     document.body.appendChild(btn);
//   }
//   btn.onclick = handler;
//   return btn;
// }

function setRoundState(state) {
  roundState = state;
  updateScreen();
}

function updateScreen() {
  // Lobby
  if (roundState === 0 || !isCurrentPlayerIngame()) {
    if (screenJoin) screenJoin.style.display = 'none';
    if (screenQuestion) screenQuestion.style.display = 'none';
    if (screenDiscussion) screenDiscussion.style.display = 'none';
    if (screenVoting) screenVoting.style.display = 'none';
    if (screenResult) screenResult.style.display = 'none';
    if (screenWaiting) screenWaiting.style.display = 'none';
    if (playerListContainer) playerListContainer.style.display = 'block';
    updateLobbyStatus('You are not in the round. Wait for the next round.');
    return;
  }
  // Answer
  if (roundState === 1) {
    if (screenJoin) screenJoin.style.display = 'none';
    if (screenQuestion) screenQuestion.style.display = 'block';
    if (screenDiscussion) screenDiscussion.style.display = 'none';
    if (screenVoting) screenVoting.style.display = 'none';
    if (screenResult) screenResult.style.display = 'none';
    if (screenWaiting) screenWaiting.style.display = 'none';
    if (playerListContainer) playerListContainer.style.display = 'none';
    return;
  }
  // Discussion
  if (roundState === 2) {
    if (screenJoin) screenJoin.style.display = 'none';
    if (screenQuestion) screenQuestion.style.display = 'none';
    if (screenDiscussion) screenDiscussion.style.display = 'block';
    if (screenVoting) screenVoting.style.display = 'none';
    if (screenResult) screenResult.style.display = 'none';
    if (screenWaiting) screenWaiting.style.display = 'none';
    if (playerListContainer) playerListContainer.style.display = 'none';
    return;
  }
  // Vote
  if (roundState === 3) {
    if (screenJoin) screenJoin.style.display = 'none';
    if (screenQuestion) screenQuestion.style.display = 'none';
    if (screenDiscussion) screenDiscussion.style.display = 'none';
    // Voting-Screen bleibt IMMER sichtbar während roundState === 3!
    if (screenVoting) screenVoting.style.display = 'block';
    if (screenResult) screenResult.style.display = 'none';
    if (screenWaiting) screenWaiting.style.display = 'none';
    if (playerListContainer) playerListContainer.style.display = 'none';
    return;
  }
  // Resolution
  if (roundState === 4) {
    if (screenJoin) screenJoin.style.display = 'none';
    if (screenQuestion) screenQuestion.style.display = 'none';
    if (screenDiscussion) screenDiscussion.style.display = 'none';
    if (screenVoting) screenVoting.style.display = 'none';
    if (screenResult) screenResult.style.display = 'block';
    if (screenWaiting) screenWaiting.style.display = 'none';
    if (playerListContainer) playerListContainer.style.display = 'none';
    return;
  }
}

// Voting timer removed (legacy). Duplicate updateScreen removed; using the first, canonical definition.

// Legacy reveal handler removed.

const stayInRoomBtn = document.getElementById('stayInRoomBtn');
if (stayInRoomBtn) {
  stayInRoomBtn.onclick = () => {
    // reset visual state
    timeLeft = 0; updateTimerDisplay();
    currentWord = '';
    const wd = document.getElementById('word-display'); if (wd) wd.innerText = '';
    const explEl = document.getElementById('explainer-word'); if (explEl) { explEl.style.display = 'none'; explEl.textContent = ''; }
    const hintBtn = document.querySelector('#explainer-controls #give-hint'); if (hintBtn) { hintBtn.disabled = true; hintBtn.style.display = 'none'; }

    screenResult.style.display = 'none';
    playerListContainer.style.display = 'block';
    startGameBtn.style.display = isHost && playersInGame.length >= 3 ? 'block' : 'none';
    document.getElementById('resultText').textContent = '';
    const voteDetails = document.getElementById('voteDetails');
    if (voteDetails) voteDetails.remove();
  }; 
}

const leaveRoomToLobbyBtn = document.getElementById('leaveRoomToLobbyBtn');
if (leaveRoomToLobbyBtn) {
  leaveRoomToLobbyBtn.onclick = () => {
    socket.emit('leaveRoom', { code: currentGameCode });
    // reset visual state
    timeLeft = 0; updateTimerDisplay();
    currentWord = '';
    const wd = document.getElementById('word-display'); if (wd) wd.innerText = '';
    const explEl = document.getElementById('explainer-word'); if (explEl) { explEl.style.display = 'none'; explEl.textContent = ''; }
    const hintBtn = document.querySelector('#explainer-controls #give-hint'); if (hintBtn) { hintBtn.disabled = true; hintBtn.style.display = 'none'; }

    screenResult.style.display = 'none';
    screenJoin.style.display = 'block';
    playerListContainer.style.display = 'none';
    startGameBtn.style.display = 'none';
    currentGameCode = '';
    isHost = false;
    playerName = '';
    document.getElementById('username').value = '';
    document.getElementById('gameCode').value = '';
    document.getElementById('resultText').textContent = '';
    const voteDetails = document.getElementById('voteDetails');
    if (voteDetails) voteDetails.remove();
  }; 
}

// Neues Spiel: Wortspiel-Logik (socket-basierte Implementierung)
let currentWord = '';
let wordDisplay = document.getElementById('word-display');
let chatBox = document.getElementById('chat-box');
let timeLeft = 0; // seconds
let timerInterval = null;
let isGuesser = false;
let isExplainer = false;
let hintUsed = false;

function updateTimerDisplay() {
  // Update the visible timer element from timeLeft (seconds)
  const timerEl = document.getElementById('timer');
  if (!timerEl) return;
  const m = Math.floor(timeLeft / 60);
  const s = timeLeft % 60;
  timerEl.textContent = `Time left: ${m}:${s.toString().padStart(2,'0')}`;
}

function clearAllChats() {
  const cb = document.getElementById('chat-box'); if (cb) cb.innerHTML = '';
  const lobbyBox = document.getElementById('lobby-chat-box'); if (lobbyBox) lobbyBox.innerHTML = '';
}

function appendToBox(box, msg) {
  if (!box) return;
  const p = document.createElement('p');
  p.textContent = `${msg.from}: ${msg.text}`;
  // apply classes similar to in-game chat styling
  if (msg.from === 'System') {
    p.className = 'system';
  } else if (msg.from === playerName) {
    p.className = 'me';
  } else {
    p.className = 'user';
  }
  box.appendChild(p);
  box.scrollTop = box.scrollHeight;
}

function appendChat(msg) {
  // default: append to in-game chat box
  if (!chatBox) return;
  appendToBox(chatBox, msg);
} 

socket.on('gameStarted', (data) => {
  console.log('Received gameStarted', data);
  // Show game screen and configure role
  document.getElementById('screen-join') && (document.getElementById('screen-join').style.display = 'none');
  document.getElementById('screen-game').style.display = 'block';
  isGuesser = data.role === 'guesser';
  isExplainer = data.role === 'explainer';
  hintUsed = false;

  // show difficulty (if provided)
  const diffEl = document.getElementById('word-difficulty');
  if (diffEl) {
    const label = diffToLabel(data.difficulty);
    diffEl.textContent = label ? `Difficulty: ${label}` : '';
    diffEl.style.display = label ? 'block' : 'none';
  }

  // update UI
  document.getElementById('guesser-controls').style.display = isGuesser ? 'block' : 'none';
  document.getElementById('explainer-controls').style.display = isExplainer ? 'block' : 'none';
  // clear per-game chat (start of round) and clear lobby chat
  clearAllChats();

  // Hide choose method now (ensure explainer can't change)
  const choose = document.getElementById('choose-method'); if (choose) choose.style.display = 'none';

  // Update timer immediately
  updateTimerDisplay();

  if (isExplainer && data.word) {
    currentWord = data.word;
    const explEl = document.getElementById('explainer-word');
    if (explEl) { explEl.style.display = 'block'; explEl.textContent = `Your word: ${currentWord}`; }
  } else {
    const explEl = document.getElementById('explainer-word');
    if (explEl) explEl.style.display = 'none';
  }

  // Show blanks
  if (data.blanks) {
    document.getElementById('word-display').innerText = data.blanks;
  }

  // Timer
  if (data.secondsLeft !== undefined) {
    timeLeft = data.secondsLeft;
    updateTimerDisplay();
    if (timerInterval) clearInterval(timerInterval);
    timerInterval = setInterval(() => {
      timeLeft--;
      updateTimerDisplay();
      if (timeLeft <= 0) {
        clearInterval(timerInterval);
        timerInterval = null;
      }
    }, 1000);
  }
  // Ensure hint button visibility for explainer
  const hintBtn = document.querySelector('#explainer-controls #give-hint');
  if (hintBtn) {
    hintBtn.disabled = false;
    hintBtn.style.display = isExplainer ? 'inline-block' : 'none';
  }});

socket.on('blanksUpdate', ({ blanks }) => {
  document.getElementById('word-display').innerText = blanks;
});

socket.on('chatMessage', (msg) => {
  appendChat(msg);
  // Also append to lobby chat if visible, using same styling/format
  const lobbyBox = document.getElementById('lobby-chat-box');
  const lobbyEl = document.getElementById('lobby-chat');
  if (lobbyBox && lobbyEl && lobbyEl.style.display !== 'none') {
    appendToBox(lobbyBox, msg);
  }
});

// Round preparing: switch clients from lobby to pre-game UI
socket.on('roundPreparing', ({ role }) => {
  console.log('Received roundPreparing', role);
  // Show the game screen but in waiting state
  document.getElementById('screen-join') && (document.getElementById('screen-join').style.display = 'none');
  document.getElementById('screen-game').style.display = 'block';
  // hide lobby UI and clear lobby chat
  if (playerListContainer) playerListContainer.style.display = 'none';
  const lobby = document.getElementById('lobby-chat'); if (lobby) lobby.style.display = 'none';
  clearAllChats();
  // show controls according to role
  document.getElementById('guesser-controls').style.display = role === 'guesser' ? 'block' : 'none';
  document.getElementById('explainer-controls').style.display = role === 'explainer' ? 'block' : 'none';
  if (role === 'guesser') appendChat({ from: 'System', text: 'Waiting for explainer to choose a word...' });
  if (role === 'explainer') appendChat({ from: 'System', text: 'Please choose random word or set a custom word to begin.' });
});

socket.on('chooseWordMethod', () => {
  console.log('Received chooseWordMethod');
  // make sure explainer controls are visible (they may already be)
  document.getElementById('explainer-controls').style.display = 'block';
});

socket.on('waitingForWord', () => {
  console.log('Received waitingForWord');
  // Guesser waiting for word
  document.getElementById('screen-game').style.display = 'block';
  document.getElementById('guesser-controls').style.display = 'block';
  appendChat({ from: 'System', text: 'Waiting for explainer to choose the word...' });
});

socket.on('timerUpdate', ({ seconds }) => {
  timeLeft = seconds;
  updateTimerDisplay();
});

socket.on('hintGiven', ({ blanks, index, letter }) => {
  hintUsed = true;
  document.getElementById('word-display').innerText = blanks;
  // optionally show system message
  appendChat({ from: 'System', text: `Hint given: letter '${letter}' revealed.` });
  const hintBtn = document.querySelector('#explainer-controls #give-hint');
  if (hintBtn) {
    hintBtn.disabled = true;
    hintBtn.style.display = 'none';
  }
});

socket.on('wordChosen', ({ by, blanks, difficulty }) => {
  // hide explainer choose UI and notify players
  appendChat({ from: 'System', text: `${by} has set the word.` });
  document.getElementById('word-display').innerText = blanks;
  // show difficulty indicator
  const diffEl = document.getElementById('word-difficulty');
  if (diffEl) {
    const label = diffToLabel(difficulty);
    diffEl.textContent = label ? `Difficulty: ${label}` : '';
    diffEl.style.display = label ? 'block' : 'none';
  }
  const choose = document.getElementById('choose-method');
  if (choose) choose.style.display = 'none';
  // hide give-hint if visible until round starts
  const hint = document.querySelector('#explainer-controls #give-hint');
  if (hint) hint.style.display = 'none';
});

// merged into main gameWon handler

socket.on('timeUp', ({ word, difficulty }) => {
  // clear and reset UI
  clearAllChats();
  timeLeft = 0; updateTimerDisplay();
  currentWord = '';
  const wd = document.getElementById('word-display'); if (wd) wd.innerText = '';
  const explEl = document.getElementById('explainer-word'); if (explEl) { explEl.style.display = 'none'; explEl.textContent = ''; }
  const hintBtn = document.querySelector('#explainer-controls #give-hint'); if (hintBtn) { hintBtn.disabled = true; hintBtn.style.display = 'none'; }
  appendChat({ from: 'System', text: `Time is up! The word was: ${word}` });
  if (timerInterval) { clearInterval(timerInterval); timerInterval = null; }
  // show result screen
  document.getElementById('screen-game').style.display = 'none';
  document.getElementById('screen-result').style.display = 'block';
  const resultEl = document.getElementById('resultText');
  const diffLabel = diffToLabel(difficulty);
  resultEl.textContent = `Time is up. The word was: ${word}` + (diffLabel ? ` (Difficulty: ${diffLabel})` : '');
  // reload to fully reset client state after showing result
  setTimeout(() => { location.reload(); }, 4500);
});

socket.on('gameAborted', ({ by, reason, word, difficulty }) => {
  // clear chats and reset visuals immediately
  clearAllChats();
  timeLeft = 0; updateTimerDisplay();
  currentWord = '';
  const wd = document.getElementById('word-display'); if (wd) wd.innerText = '';
  const explEl = document.getElementById('explainer-word'); if (explEl) { explEl.style.display = 'none'; explEl.textContent = ''; }
  const hintBtn = document.querySelector('#explainer-controls #give-hint'); if (hintBtn) { hintBtn.disabled = true; hintBtn.style.display = 'none'; }
  appendChat({ from: 'System', text: `Game aborted: ${reason || by}` });
  if (timerInterval) { clearInterval(timerInterval); timerInterval = null; }
  // show result screen revealing the word (if any) then reload
  setTimeout(() => {
    document.getElementById('screen-game').style.display = 'none';
    document.getElementById('screen-result').style.display = 'block';
    const resultEl = document.getElementById('resultText');
    if (typeof word !== 'undefined' && word !== null) {
      const diffLabel = diffToLabel(difficulty);
      resultEl.textContent = `Game aborted. The word was: ${word}` + (diffLabel ? ` (Difficulty: ${diffLabel})` : '');
    } else {
      resultEl.textContent = `Game aborted: ${reason || by}`;
    }
    // finally reload to fully reset state
    setTimeout(() => { location.reload(); }, 4500);
  }, 500);
});

// show server error messages (like missing role before start)
socket.on('errorMessage', ({ message }) => {
  alert(message);
});

// Explainer answer buttons
['yes','no','maybe','idk'].forEach(a => {
  const btn = document.getElementById(`btn-${a}`);
  if (btn) btn.addEventListener('click', () => {
    socket.emit('explainerAnswer', { answer: a }, (res) => {
      if (res && res.error) appendChat({ from: 'System', text: `Error: ${res.error}` });
    });
  });
});

// Explainer sets custom word
const setCustomBtn = document.getElementById('set-custom-word');
if (setCustomBtn) setCustomBtn.addEventListener('click', () => {
  const val = document.getElementById('custom-word').value.trim();
  if (!val) return;
  socket.emit('chooseCustomWord', { word: val }, (res) => {
    if (res && res.error) appendChat({ from: 'System', text: `Error: ${res.error}` });
    else appendChat({ from: 'System', text: 'Custom word set.' });
  });
});

// Explainer chooses random word
const randBtn = document.getElementById('btn-random-word');
if (randBtn) randBtn.addEventListener('click', () => {
  socket.emit('chooseRandomWord', null, (res) => {
    if (res && res.error) appendChat({ from: 'System', text: `Error: ${res.error}` });
    else appendChat({ from: 'System', text: 'Random word chosen.' });
  });
});

// Give hint
const giveHintBtn = document.querySelector('#explainer-controls #give-hint') || document.getElementById('give-hint');
if (giveHintBtn) giveHintBtn.addEventListener('click', () => {
  socket.emit('giveHint', null, (res) => {
    if (res && res.error) appendChat({ from: 'System', text: `Error: ${res.error}` });
    else {
      giveHintBtn.disabled = true;
      giveHintBtn.style.display = 'none';
    }
  });
});

// +5 minutes
const addTimeBtn = document.getElementById('add-time');
if (addTimeBtn) addTimeBtn.addEventListener('click', () => {
  socket.emit('extendTime', null, (res) => {
    if (res && res.error) appendChat({ from: 'System', text: `Error: ${res.error}` });
    else appendChat({ from: 'System', text: `Time extended. New time: ${Math.floor(res.seconds/60)}:${(res.seconds%60).toString().padStart(2,'0')}` });
  });
});

// Lobby chat send
const lobbySend = document.getElementById('lobby-send-btn');
const lobbyInput = document.getElementById('lobby-chat-input');
if (lobbySend) lobbySend.addEventListener('click', () => {
  const input = lobbyInput || document.getElementById('lobby-chat-input');
  const text = input.value.trim();
  if (!text) return;
  socket.emit('sendChat', { text }, (res) => {
    if (res && res.error) appendChat({ from: 'System', text: `Error: ${res.error}` });
  });
  input.value = '';
});
if (lobbyInput) {
  lobbyInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      lobbySend && lobbySend.click();
    }
  });
}

// Show winner screen when game won
socket.on('gameWon', ({ winner, word, difficulty }) => {
  // clear chats and reset game visuals
  clearAllChats();
  timeLeft = 0; updateTimerDisplay();
  currentWord = '';
  const wd = document.getElementById('word-display'); if (wd) wd.innerText = '';
  const explEl = document.getElementById('explainer-word'); if (explEl) { explEl.style.display = 'none'; explEl.textContent = ''; }
  const hintBtn = document.querySelector('#explainer-controls #give-hint'); if (hintBtn) { hintBtn.disabled = true; hintBtn.style.display = 'none'; }
  if (timerInterval) { clearInterval(timerInterval); timerInterval = null; }

  document.getElementById('screen-game').style.display = 'none';
  document.getElementById('screen-result').style.display = 'block';
  const resultEl = document.getElementById('resultText');
  const diffLabel = diffToLabel(difficulty);
  resultEl.textContent = `${winner} guessed correctly! Word: ${word}. Both players win!` + (diffLabel ? ` (Difficulty: ${diffLabel})` : '');
  // reload to fully reset client state after showing result
  setTimeout(() => { location.reload(); }, 4500);
});

// Guesser submits a guess via Enter
const guessInput = document.getElementById('guess-input');
const submitGuessBtn = document.getElementById('submit-guess');
if (guessInput) {
  guessInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submitGuessBtn && submitGuessBtn.click();
    }
  });
}

// Guesser submits a guess via chat
if (submitGuessBtn) submitGuessBtn.addEventListener('click', () => {
  const input = document.getElementById('guess-input');
  if (!input) return;
  const text = input.value.trim();
  if (!text) return;
  socket.emit('sendChat', { text }, (res) => {
    if (res && res.error) appendChat({ from: 'System', text: `Error: ${res.error}` });
  });
  input.value = '';
});

// Give up / abort button
const giveUpBtn = document.getElementById('give-up');
if (giveUpBtn) giveUpBtn.addEventListener('click', () => {
  socket.emit('giveUp', { reason: 'player gave up' }, (res) => {
    if (res && res.error) appendChat({ from: 'System', text: `Error: ${res.error}` });
  });
});
