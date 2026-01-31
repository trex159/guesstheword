const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
let questions = {};
let getRandomCategory = () => null;
let getRandomQuestion = () => null;
try {
  const qmod = require('./shared/questions');
  questions = qmod.questions || {};
  getRandomCategory = qmod.getRandomCategory || getRandomCategory;
  getRandomQuestion = qmod.getRandomQuestion || getRandomQuestion;
} catch (err) {
  // optional module not present
}
const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Public Ordner für Frontend
app.use(express.static(path.join(__dirname, 'public')));

const games = new Map(); // Map<code, GameSession>

const fs = require('fs');
// Load main wordlist and optional difficulty-specific lists into memory
const wordlistPath = path.join(__dirname, 'shared', 'wordlist.txt');
const wordlistEasyPath = path.join(__dirname, 'shared', 'wordlist-easy.txt');
const wordlistDifficultPath = path.join(__dirname, 'shared', 'wordlist-difficult.txt');
let wordlist = [];
let wordlistEasy = [];
let wordlistDifficult = [];
try {
  const wl = fs.readFileSync(wordlistPath, 'utf8');
  wordlist = wl.split(/\r?\n/).map(w => w.trim()).filter(Boolean);
  console.log(`Loaded ${wordlist.length} words from wordlist.`);
} catch (err) {
  console.warn('Could not load wordlist:', err.message);
}
try {
  const wl = fs.readFileSync(wordlistEasyPath, 'utf8');
  wordlistEasy = wl.split(/\r?\n/).map(w => w.trim()).filter(Boolean);
  console.log(`Loaded ${wordlistEasy.length} words from wordlist-easy.`);
} catch (err) {
  // optional
}
try {
  const wl = fs.readFileSync(wordlistDifficultPath, 'utf8');
  wordlistDifficult = wl.split(/\r?\n/).map(w => w.trim()).filter(Boolean);
  console.log(`Loaded ${wordlistDifficult.length} words from wordlist-difficult.`);
} catch (err) {
  // optional
}

function generateCode() {
  return Math.random().toString(36).substring(2, 6).toUpperCase();
}

function computeBlanks(word, revealedIndices = []) {
  const blanks = [];
  for (let i = 0; i < word.length; i++) {
    // if already revealed, show original char
    if (revealedIndices.includes(i)) {
      blanks.push(word[i]);
      continue;
    }
    const ch = word[i];
    // show non-letter characters (spaces, hyphens, punctuation) as-is
    if (!/[A-Za-z]/.test(ch)) {
      blanks.push(ch);
    } else {
      // letter and not revealed => underscore
      blanks.push('_');
    }
  }
  return blanks.join(' ');
}

function getPlayerById(game, id) {
  if (!game) return null;
  return game.players.find(p => p.id === id) || null;
}

function isValidGameCode(code) {
  return /^[A-Z0-9]+$/i.test(code);
}

// Sende regelmäßig die Spielerlisten an alle Räume
setInterval(() => {
  for (const game of games.values()) {
    sendPlayerList(game);
  }
}, 3000); // alle 3 Sekunden

io.on('connection', (socket) => {
  console.log(`🟢 New connection: ${socket.id}`);

  // Create game
  socket.on('createGame', ({ name, customCode }, callback) => {
    try {
      if (!name) return callback({ error: 'Name required' });
      let code;
      if (customCode) {
        code = customCode.toUpperCase();
        if (!isValidGameCode(code)) {
          return callback({ error: 'Room code may only contain letters and numbers.' });
        }
        if (games.has(code)) {
          return callback({ error: 'This room code is already taken!' });
        }
      } else {
        do {
          code = generateCode();
        } while (games.has(code));
      }
      games.set(code, {
        code,
        players: [],
        state: 'lobby',
        hostId: socket.id
      });
      console.log(`🟠 Room created: ${code} by ${name} (${socket.id})`);
      const game = games.get(code);
      game.players.push({ id: socket.id, name, ingame: false });
      socket.join(code);
      callback({ success: true, code });
      sendPlayerList(game);
    } catch (err) {
      callback({ error: 'Server error while creating the game.' });
    }
  });

  // Join game
  socket.on('joinGame', ({ code, name }, callback) => {
    try {
      if (!code || !name) return callback({ error: 'Invalid code or name' });

      const normalizedCode = code.toUpperCase();
      if (!isValidGameCode(normalizedCode)) {
        return callback({ error: 'Room code may only contain letters and numbers.' });
      }

      if (!games.has(normalizedCode)) {
        callback({ error: 'No game found with that code!' });
        socket.emit('noGameFound');
        return;
      }

      const game = games.get(normalizedCode);

      if (game.players.find(p => p.id === socket.id)) {
        return callback({ error: 'You are already in this game.' });
      }

      // Name darf nicht doppelt sein
      if (game.players.find(p => p.name === name)) {
        return callback({ error: 'Name already taken.' });
      }

      // Max 2 Spieler pro Raum
      if (game.players.length >= 2) {
        return callback({ error: 'This room is already full (max 2 players).'});
      }

      game.players.push({ id: socket.id, name, ingame: false });
      socket.join(normalizedCode);
      callback({ success: true, code: normalizedCode });
      sendPlayerList(game);
    } catch (err) {
      callback({ error: 'Serverfehler beim Beitreten.' });
    }
  });

  // Host starts the game (2 players: Guesser & Explainer)
  socket.on('startGame', ({ code }) => {
    try {
      const game = games.get(code);
      if (!game) return;
      if (game.hostId !== socket.id) return; // Nur Host darf starten
      if (game.players.length !== 2) return; // genau 2 Spieler benötigt
      // Ensure roles assigned
      if (!game.guesserId || !game.explainerId) return io.to(socket.id).emit('errorMessage', { message: 'Please assign Guesser and Explainer first.' });
      game.players.forEach(p => p.ingame = true);
      // Ask explainer to choose method (random or custom)
      game.state = 'awaitingWord';
      // Send a preparing event so clients switch from lobby to game-prep UI
      const gu = game.players.find(p => p.id === game.guesserId);
      const ex = game.players.find(p => p.id === game.explainerId);
      console.log(`🔷 Emitting roundPreparing: gu=${gu ? gu.id : 'none'} ex=${ex ? ex.id : 'none'}`);
      if (gu) io.to(gu.id).emit('roundPreparing', { role: 'guesser' });
      if (ex) io.to(ex.id).emit('roundPreparing', { role: 'explainer' });

      console.log(`🔷 Asking explainer (${game.explainerId}) to choose word`);
      io.to(game.explainerId).emit('chooseWordMethod');
      io.to(game.guesserId).emit('waitingForWord');
      sendPlayerList(game);
    } catch (err) {
      // ignore
    }
  });

  // Player leaves the room voluntarily
  socket.on('leaveRoom', ({ code }) => {
    try {
      const game = games.get(code);
      if (!game) return;
      const idx = game.players.findIndex(p => p.id === socket.id);
      if (idx !== -1) {
        const wasHost = game.hostId === socket.id;
        game.players[idx].ingame = false;
        game.players.splice(idx, 1);
        socket.leave(code);
        // Host-Wechsel falls nötig
        if (wasHost && game.players.length > 0) {
          // Bevorzuge einen Spieler, der nicht im Spiel ist (Lobby)
          const lobbyPlayer = game.players.find(p => !p.ingame);
          if (lobbyPlayer) {
            game.hostId = lobbyPlayer.id;
          } else {
            // Falls alle im Spiel sind, nimm einfach den ersten
            game.hostId = game.players[0].id;
          }
        }
        sendPlayerList(game);
        // Lobby löschen wenn leer
        if (game.players.length === 0) {
          games.delete(game.code);
        }
      }
    } catch (err) {
      // ignore
    }
  });

  socket.on('disconnect', () => {
    try {
      for (const game of games.values()) {
        const idx = game.players.findIndex(p => p.id === socket.id);
        if (idx !== -1) {
          const wasHost = game.hostId === socket.id;
          game.players[idx].ingame = false;
          game.players.splice(idx, 1);
          // Host-Wechsel falls nötig
          if (wasHost && game.players.length > 0) {
            const lobbyPlayer = game.players.find(p => !p.ingame);
            if (lobbyPlayer) {
              game.hostId = lobbyPlayer.id;
            } else {
              game.hostId = game.players[0].id;
            }
          }
          sendPlayerList(game);
          // Wenn Spiel im Gange und zu wenige Spieler, abbrechen (2-player game)
          if (game.state !== 'lobby' && game.players.length < 2) {
            if (game.timer) clearInterval(game.timer);
            io.to(game.code).emit('gameAborted', { reason: 'Not enough players. Game aborted.', word: game.word || null, difficulty: game.difficulty || null });
            games.delete(game.code);
            break;
          }
          // Lobby löschen wenn leer
          if (game.players.length === 0) {
            games.delete(game.code);
          }
        }
      }
    } catch (err) {
      // ignore
    }
  });

  // submitAnswer (legacy) removed for Yes-No-Maybe game.

  // Abstimmungs-Timer
//  function startVoteTimer(game) {
//    if (game.voteTimer) return; // Timer läuft schon
//    game.voteTimer = setTimeout(() => {
 //     // Abstimmung beenden, auch wenn nicht alle abgestimmt haben
  //    io.to(game.code).emit('voteReveal', game.votes);
    //  setTimeout(() => {
      //  countVotesAndReveal(game);
     // }, 2000);
     // game.voteTimer = null;
   // }, 10000);
   // io.to(game.code).emit('voteTimerStarted', { seconds: 10 });
  //}

  // castVote (legacy) removed for Yes-No-Maybe game.

  // --- New game events for 2-player guesser/explainer game ---

  // Chat messages (allowed in lobby and in-game)
  socket.on('sendChat', ({ text }, callback) => {
    try {
      const game = findGameBySocket(socket.id);
      if (!game) return;
      const player = getPlayerById(game, socket.id);
      if (!player) return;
      const msg = { from: player.name, text };
      game.chat = game.chat || [];
      game.chat.push(msg);
      io.to(game.code).emit('chatMessage', msg);

      // If guesser guessed the word (only when word set and round in progress)
      if (socket.id === game.guesserId && typeof game.word === 'string' && game.state === 'in-game') {
        if (text.trim().toLowerCase() === game.word.trim().toLowerCase()) {
          // Guesser wins
          if (game.timer) clearInterval(game.timer);
          io.to(game.code).emit('gameWon', { winner: player.name, word: game.word, difficulty: game.difficulty || null });
          game.state = 'ended';
          // optionally remove game after a short time
          setTimeout(() => {
            games.delete(game.code);
          }, 2000);
        }
      }
      if (callback) callback({ success: true });
    } catch (err) {
      if (callback) callback({ error: 'Server error' });
    }
  });

  // Explainer selects a custom word
  socket.on('chooseCustomWord', ({ word }, callback) => {
    try {
      const game = findGameBySocket(socket.id);
      if (!game) return;
      if (socket.id !== game.explainerId) return; // only explainer
      if (!word || typeof word !== 'string') return;
      word = word.trim();
      if (word.length === 0) return;
      // simple validation: letters and spaces only
      if (!/^[A-Za-zÄÖÜäöüß\s-]+$/.test(word)) return callback({ error: 'Invalid word.' });
      game.word = word;
      game.difficulty = 'custom';
      game.revealedIndices = [];
      game.hintUsed = false;
      io.to(game.code).emit('wordChosen', { by: getPlayerById(game, socket.id).name, blanks: computeBlanks(game.word, game.revealedIndices), difficulty: game.difficulty });
      // Start the round now
      startRound(game);
      if (callback) callback({ success: true, difficulty: game.difficulty });
    } catch (err) {
      if (callback) callback({ error: 'Server error' });
    }
  });

  // Explainer chooses a random word from list with probabilities:
  // main wordlist = 90%, easy = 5%, difficult = 5%
  socket.on('chooseRandomWord', (payload, callback) => {
    try {
      const game = findGameBySocket(socket.id);
      if (!game) return;
      if (socket.id !== game.explainerId) return;
      // ensure we have at least one word somewhere
      if (wordlist.length === 0 && wordlistEasy.length === 0 && wordlistDifficult.length === 0) return callback({ error: 'No words available.' });
      // pick source based on probability
      const r = Math.random();
      let source = 'main';
      let candidateList = wordlist;
      if (r >= 0.9 && wordlistEasy.length > 0) {
        source = 'easy';
        candidateList = wordlistEasy;
      } else if (r >= 0.95 && wordlistDifficult.length > 0) {
        source = 'difficult';
        candidateList = wordlistDifficult;
      } else if (r >= 0.9 && wordlistEasy.length === 0 && wordlistDifficult.length > 0) {
        // fallback if only difficult exists
        source = 'difficult';
        candidateList = wordlistDifficult;
      }
      // choose a random word from candidate list
      const chosen = candidateList[Math.floor(Math.random() * candidateList.length)];
      game.word = chosen;
      game.difficulty = source; // 'main', 'easy', 'difficult'
      game.revealedIndices = [];
      game.hintUsed = false;
      io.to(game.code).emit('wordChosen', { by: getPlayerById(game, socket.id).name, blanks: computeBlanks(game.word, game.revealedIndices), difficulty: game.difficulty });
      startRound(game);
      if (callback) callback({ success: true, difficulty: game.difficulty });
    } catch (err) {
      if (callback) callback({ error: 'Server error' });
    }
  });

  // Explainer answers using one of the buttons
  socket.on('explainerAnswer', ({ answer }, callback) => {
    try {
      const game = findGameBySocket(socket.id);
      if (!game) return;
      if (socket.id !== game.explainerId) return;
      const player = getPlayerById(game, socket.id);
      const allowed = ['yes', 'no', 'maybe', 'idk'];
      if (!allowed.includes(answer)) return;
      const msg = { from: player.name, text: answer };
      game.chat = game.chat || [];
      game.chat.push(msg);
      io.to(game.code).emit('chatMessage', msg);
      if (callback) callback({ success: true });
    } catch (err) {
      if (callback) callback({ error: 'Server error' });
    }
  });

  // Explainer gives a single hint (reveal one random unrevealed letter)
  socket.on('giveHint', (payload, callback) => {
    try {
      const game = findGameBySocket(socket.id);
      if (!game) return;
      if (socket.id !== game.explainerId) return;
      if (game.hintUsed) return; // only once
      if (!game.word) return;
      const unrevealed = [];
      for (let i = 0; i < game.word.length; i++) {
        if (game.word[i] === ' ') continue;
        if (!game.revealedIndices.includes(i)) unrevealed.push(i);
      }
      if (unrevealed.length === 0) return;
      const idx = unrevealed[Math.floor(Math.random() * unrevealed.length)];
      game.revealedIndices.push(idx);
      game.hintUsed = true;
      const blanks = computeBlanks(game.word, game.revealedIndices);
      io.to(game.code).emit('hintGiven', { blanks, index: idx, letter: game.word[idx] });
      if (callback) callback({ success: true });
    } catch (err) {
      if (callback) callback({ error: 'Server error' });
    }
  });

  // Extend time by +5 minutes
  socket.on('extendTime', (payload, callback) => {
    try {
      const game = findGameBySocket(socket.id);
      if (!game || !game.timerSeconds) return;
      game.timerSeconds += 300; // +5 minutes
      io.to(game.code).emit('timerUpdate', { seconds: game.timerSeconds });
      if (callback) callback({ success: true, seconds: game.timerSeconds });
    } catch (err) {
      if (callback) callback({ error: 'Server error' });
    }
  });

  // Give up / abort
  socket.on('giveUp', ({ reason }, callback) => {
    try {
      const game = findGameBySocket(socket.id);
      if (!game) return;
      if (game.timer) clearInterval(game.timer);
      io.to(game.code).emit('gameAborted', { by: getPlayerById(game, socket.id).name, reason, word: game.word, difficulty: game.difficulty || null });
      game.state = 'ended';
      setTimeout(() => {
        games.delete(game.code);
      }, 2000);
      if (callback) callback({ success: true });
    } catch (err) {
      if (callback) callback({ error: 'Server error' });
    }
  });

  socket.on('assignRole', ({ code, name, role }, callback) => {
    try {
      const game = games.get(code);
      if (!game) return;
      if (game.hostId !== socket.id) return;
      const target = game.players.find(p => p.name === name);
      if (!target) return;
      // ensure unique roles: remove previous holder of this role
      if (role === 'guesser') {
        // unset previous guesser
        if (game.guesserId && game.guesserId !== target.id) {
          // nothing else to do, role will change via sendPlayerList
        }
        game.guesserId = target.id;
        // if this player was explainer, unset explainer
        if (game.explainerId === target.id) game.explainerId = null;
      } else if (role === 'explainer') {
        if (game.explainerId && game.explainerId !== target.id) {
          // unset previous explainer
        }
        game.explainerId = target.id;
        if (game.guesserId === target.id) game.guesserId = null;
      }
      // If setting one role accidentally conflicts, try to ensure both roles assigned to two different players
      // If both players present, auto-assign remaining role if needed
      if (game.players.length === 2) {
        const other = game.players.find(p => p.id !== target.id);
        if (other) {
          if (!game.guesserId) game.guesserId = other.id;
          if (!game.explainerId) game.explainerId = other.id;
        }
      }
      sendPlayerList(game);
      if (callback) callback({ success: true });
    } catch (err) {
      if (callback) callback({ error: 'Server error' });
    }
  });

  socket.on('debug', () => {
    try {
      const game = findGameBySocket(socket.id);
      if (!game) return;
      io.to(socket.id).emit('debugInfo', {
        game,
        players: game.players.map(p => ({
          id: p.id,
          name: p.name,
          ingame: p.ingame
        }))
      });
    } catch (err) {
      // ignore
    }
  });
});

function findGameBySocket(socketId) {
  for (const game of games.values()) {
    if (game.players.find(p => p.id === socketId)) return game;
  }
  return null;
}

// Helper: only players with ingame=true
function getIngamePlayers(game) {
  return game.players.filter(p => p.ingame);
}

function sendPlayerList(game) {
  if (!game) return;
  const host = game.players.find(p => p.id === game.hostId);
  io.to(game.code).emit('playerList', {
    players: game.players.map(p => ({
      name: p.name,
      ingame: !!p.ingame,
      role: (p.id === game.guesserId) ? 'guesser' : (p.id === game.explainerId) ? 'explainer' : null
    })),
    hostName: host ? host.name : null
  });
}

function startRound(game) {
  if (!game) return;
  game.revealedIndices = game.revealedIndices || [];
  game.hintUsed = false;
  game.chat = game.chat || [];
  game.timerSeconds = 300; // 5 minutes
  game.state = 'in-game';

  // start timer
  if (game.timer) clearInterval(game.timer);
  game.timer = setInterval(() => {
    game.timerSeconds--;
    io.to(game.code).emit('timerUpdate', { seconds: game.timerSeconds });
    if (game.timerSeconds <= 0) {
      clearInterval(game.timer);
      io.to(game.code).emit('timeUp', { word: game.word, difficulty: game.difficulty || null });
      game.state = 'ended';
      games.delete(game.code);
    }
  }, 1000);

  const ingamePlayers = getIngamePlayers(game);
  console.log(`🔹 Starting round for game ${game.code}: players=${ingamePlayers.map(p=>p.id).join(',')}`);
  ingamePlayers.forEach(p => {
    const role = p.id === game.guesserId ? 'guesser' : 'explainer';
    const payload = {
      role,
      blanks: computeBlanks(game.word, game.revealedIndices),
      secondsLeft: game.timerSeconds,
      difficulty: game.difficulty || null
    };
    if (role === 'explainer') payload.word = game.word; // explainer knows the word
    console.log(`🔹 Emitting gameStarted to ${p.id} (role=${role})`);
    io.to(p.id).emit('gameStarted', payload);
  });

  io.to(game.code).emit('blanksUpdate', { blanks: computeBlanks(game.word, game.revealedIndices) });
  sendPlayerList(game);
}

// Legacy discussion/voting functions removed (not used in Yes-No-Maybe)

const PORT = 3000;
const HOST = '0.0.0.0';
server.listen(PORT, HOST, () => {
  console.log(`🚀 Server running on http://${HOST}:${PORT}`);
});
