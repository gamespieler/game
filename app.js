// State Management
let games = JSON.parse(localStorage.getItem('jeopardy_games_v2')) || [];
if (games.length === 0) {
    const defaultGame = {
        id: 'game_' + Date.now(),
        title: 'Mein Erstes Jeopardy',
        categories: Array(6).fill(null).map((_, i) => ({
            name: `Kategorie ${i + 1}`,
            type: 'standard',
            questions: Array(5).fill(null).map((_, j) => ({
                points: (j + 1) * 100,
                question: '', 
                answer: '' 
            }))
        })),
        categoriesRound2: Array(6).fill(null).map((_, i) => ({
            name: `Kategorie ${i + 1} (R2)`,
            type: 'standard',
            questions: Array(5).fill(null).map((_, j) => ({
                points: (j + 1) * 200,
                question: '',
                answer: ''
            }))
        }))
    };
    games.push(defaultGame);
    saveGames();
}

// Globals
let activeGameId = localStorage.getItem('jeopardy_active_game_v2') || games[0].id;
let activeGame = games.find(g => g.id === activeGameId) || games[0];

// Migration: Ensure all games have categoriesRound2
let needsSave = false;
games.forEach(g => {
    if (syncGameStructure(g)) {
        needsSave = true;
    }
});
if (needsSave) {
    saveGames();
}

const changelog = [
    { version: "V5.1", date: "April 2026", text: "KI Fact-Check als intelligenter Schiedsrichter (ersetzt Wikipedia) und Einführung dieses Update-Verlaufs." },
    { version: "V5.0", date: "April 2026", text: "Bild-Fragen mit Progressive Reveal (Schrittweises Aufdecken), aufgeräumtes Einstellungs-Menü, Live-Aktions-Log für den Host, detaillierte Spieler-Statistiken und Mobile-Optimierung für Handys." },
    { version: "V4.0", date: "April 2026", text: "Automatisches Punktesystem: Der Host kann Richtig/Falsch per Knopfdruck bewerten. Einführung der 'Nachziehen'-Regel (halber Punktabzug beim 2. Versuch)." },
    { version: "V3.0", date: "April 2026", text: "Google Gemini KI-Integration: Automatisches Generieren von ganzen Kategorien direkt im Editor mit auswählbarem Schwierigkeitsgrad." },
    { version: "V2.0", date: "April 2026", text: "Online-Multiplayer System via WebRTC (PeerJS). Spielen über das Internet mit 4-stelligem Raumcode (ohne eigenen Server)." },
    { version: "V1.0", date: "April 2026", text: "Erste Grundversion der Jeopardy App: Lokales Board, Kategorien-Editor und Host-System." }
];

function saveGames() {
    localStorage.setItem('jeopardy_games_v2', JSON.stringify(games));
}

function buildEmptyQuestion(points) {
    return {
        points,
        question: '',
        answer: ''
    };
}

function syncCategoryQuestions(cat, count, pointsPerQuestion) {
    let changed = false;

    if (!Array.isArray(cat.questions)) {
        cat.questions = [];
        changed = true;
    }

    if (cat.questions.length < count) {
        for (let i = cat.questions.length; i < count; i++) {
            cat.questions.push(buildEmptyQuestion((i + 1) * pointsPerQuestion));
        }
        changed = true;
    } else if (cat.questions.length > count) {
        cat.questions.length = count;
        changed = true;
    }

    cat.questions.forEach((q, qIdx) => {
        if (!q || typeof q !== 'object') {
            cat.questions[qIdx] = buildEmptyQuestion((qIdx + 1) * pointsPerQuestion);
            q = cat.questions[qIdx];
            changed = true;
        }

        const nextPoints = (qIdx + 1) * pointsPerQuestion;
        if (q.points !== nextPoints) {
            q.points = nextPoints;
            changed = true;
        }

        if (q.question === undefined) {
            q.question = '';
            changed = true;
        }

        if (q.answer === undefined) {
            q.answer = '';
            changed = true;
        }
    });

    return changed;
}

function syncGameStructure(game) {
    if (!game.categories || !Array.isArray(game.categories)) return false;

    let changed = false;
    const questionCount = game.questionsPerCategory || game.categories[0]?.questions?.length || 5;
    const pointMultiplier = game.pointMultiplier || 100;

    if (!game.questionsPerCategory) {
        game.questionsPerCategory = questionCount;
        changed = true;
    }

    game.categories.forEach(cat => {
        if (syncCategoryQuestions(cat, questionCount, pointMultiplier)) {
            changed = true;
        }
    });

    if (!Array.isArray(game.categoriesRound2)) {
        game.categoriesRound2 = [];
        changed = true;
    }

    game.categories.forEach((baseCat, cIdx) => {
        if (!game.categoriesRound2[cIdx] || typeof game.categoriesRound2[cIdx] !== 'object') {
            game.categoriesRound2[cIdx] = {
                name: `${baseCat.name} (R2)`,
                type: 'standard',
                questions: []
            };
            changed = true;
        }

        const round2Cat = game.categoriesRound2[cIdx];
        if (syncCategoryQuestions(round2Cat, questionCount, pointMultiplier * 2)) {
            changed = true;
        }
    });

    return changed;
}

// Live State (sent over WebRTC)
let liveState = {
    playedQuestions: [],
    activeQuestion: null,
    players: [], 
    log: [],
    stats: {}, 
    gameData: activeGame,
    currentRound: 1
};

function logAction(msg) {
    if(!isHost) return;
    const time = new Date().toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    liveState.log.push({ time, msg });
    if(liveState.log.length > 50) liveState.log.shift();
}

// PeerJS Networking
let peer = null;
let connections = []; // For Host: all connected players
let hostConnection = null; // For Player: connection to host
let myPeerId = null;
let roomCode = '';
let isHost = false;
let myPlayerName = '';

function generateRoomCode() {
    return Math.random().toString(36).substring(2, 6).toUpperCase();
}

function initHostPeer() {
    isHost = true;
    roomCode = generateRoomCode();
    myPeerId = 'jeop-' + roomCode;
    liveState.players = []; // Reset players on new host session
    
    peer = new Peer(myPeerId);
    
    peer.on('open', (id) => {
        console.log('Host ready. Room Code:', roomCode);
        render();
    });

    peer.on('connection', (conn) => {
        connections.push(conn);
        conn.on('open', () => {
            // Wait for JOIN message to get player name
        });
        
        conn.on('data', (data) => {
            if (data.type === 'JOIN') {
                if (!liveState.players.find(p => p.id === conn.peer)) {
                    liveState.players.push({ id: conn.peer, name: data.name, score: 0 });
                    liveState.stats[conn.peer] = { correct: 0, wrong: 0, buzzes: 0 };
                    logAction(`${data.name} ist beigetreten.`);
                }
                broadcastState();
                render();
            }
            if (data.type === 'HL_GUESS') {
                handleHlGuess(conn.peer, data.guess);
            }
        });

        conn.on('close', () => {
            connections = connections.filter(c => c !== conn);
            render();
        });
    });
}

function handleHlGuess(playerId, guess) {
    if (!liveState.activeQuestion) return;
    const actQ = liveState.activeQuestion;
    const round = actQ.round || 1;
    const catList = round === 1 ? activeGame.categories : (activeGame.categoriesRound2 || []);
    const cat = catList[actQ.catIndex];
    const q = cat.questions[actQ.qIndex];
    const streakIdx = actQ.streakIdx || 0;
    
    let currentSt = { solution: q.hlSolution };
    if (q.hlStreak && q.hlStreak[streakIdx]) {
        currentSt = q.hlStreak[streakIdx];
    }
    
    const isCorrect = (guess === currentSt.solution);
    const player = liveState.players.find(p => p.id === playerId);
    const conn = connections.find(c => c.peer === playerId);

    if (isCorrect) {
        if (player) {
            player.score += Math.floor(actQ.points / (cat.hlStreakLength || 1));
            liveState.stats[playerId].correct++;
        }
        if (conn) conn.send({ type: 'HL_FEEDBACK', correct: true });
        
        // Auto-advance streak
        if (streakIdx + 1 < (cat.hlStreakLength || 1)) {
            setTimeout(() => {
                actQ.streakIdx++;
                broadcastState();
                render();
            }, 1000);
        } else {
            // End of streak
            actQ.showAnswer = true;
            broadcastState();
            render();
        }
    } else {
        if (player) {
            player.score -= Math.floor(actQ.points / (cat.hlStreakLength || 1) / 2);
            liveState.stats[playerId].wrong++;
        }
        if (conn) conn.send({ type: 'HL_FEEDBACK', correct: false });
        
        // Block player from guessing again for 1.5 seconds on wrong answer
        if (!liveState.hlBlockedPlayers) liveState.hlBlockedPlayers = [];
        liveState.hlBlockedPlayers.push(playerId);
        setTimeout(() => {
            liveState.hlBlockedPlayers = liveState.hlBlockedPlayers.filter(id => id !== playerId);
            broadcastState();
        }, 1500);
    }
    
    broadcastState();
    render();
}

function initPlayerPeer(code, name) {
    isHost = false;
    roomCode = code.toUpperCase();
    myPlayerName = name;
    peer = new Peer(); 
    
    peer.on('open', (id) => {
        hostConnection = peer.connect('jeop-' + roomCode);
        
        hostConnection.on('open', () => {
            console.log('Connected to Host');
            hostConnection.send({ type: 'JOIN', name: myPlayerName });
            render();
        });
        
        hostConnection.on('data', (data) => {
            if (data.type === 'STATE_UPDATE') {
                liveState = data.payload;
                activeGame = liveState.gameData; 
                render();
            }
            if (data.type === 'HL_FEEDBACK') {
                showHlFeedback(data.correct);
            }
        });

        hostConnection.on('close', () => {
            alert('Verbindung zum Host abgebrochen.');
            window.location.hash = '';
        });
    });

    peer.on('error', (err) => {
        console.error(err);
        alert('Verbindung fehlgeschlagen. Ist der Code richtig?');
        window.location.hash = '';
    });
}

window.playerGuessHl = function(guess, btn) {
    if (!hostConnection || !hostConnection.open) return;
    
    // Prevent double clicking / spamming
    if (window.hlLastGuessTime && Date.now() - window.hlLastGuessTime < 500) return;
    window.hlLastGuessTime = Date.now();

    hostConnection.send({ type: 'HL_GUESS', guess: guess });
    
    // Visual feedback for clicking
    if (btn) {
        btn.style.transform = 'scale(0.95)';
        setTimeout(() => btn.style.transform = '', 100);
    }
}

function showHlFeedback(isCorrect) {
    const feedbackOverlay = document.createElement('div');
    feedbackOverlay.style.cssText = `
        position: fixed; top: 0; left: 0; right: 0; bottom: 0;
        background: ${isCorrect ? 'rgba(16, 185, 129, 0.4)' : 'rgba(239, 68, 68, 0.4)'};
        z-index: 2000; display: flex; align-items: center; justify-content: center;
        font-size: 8rem; animation: fadeOut 1s forwards; pointer-events: none;
    `;
    feedbackOverlay.innerHTML = isCorrect ? '✅' : '❌';
    document.body.appendChild(feedbackOverlay);
    setTimeout(() => feedbackOverlay.remove(), 1000);
}

window.updateGlobalQuestions = function(count) {
    activeGame.questionsPerCategory = count;
    syncGameStructure(activeGame);
    saveGames();
    render();
}

window.updateGlobalMultiplier = function(mult) {
    activeGame.pointMultiplier = mult;
    syncGameStructure(activeGame);
    saveGames();
    render();
}

function broadcastState() {
    if (!isHost) return;
    const payload = { type: 'STATE_UPDATE', payload: liveState };
    connections.forEach(conn => {
        if (conn.open) {
            conn.send(payload);
        }
    });
}

// Router & Render
const appDiv = document.getElementById('app');

function render() {
    const hash = window.location.hash;
    appDiv.innerHTML = ''; 

    if (hash === '#player') {
        renderPlayerView();
    } else if (hash === '#host') {
        renderHostView();
    } else if (hash === '#editor') {
        renderEditor();
    } else {
        renderLauncher(hash);
    }
    
    if (window.lucide) { window.lucide.createIcons(); }
}

window.addEventListener('hashchange', render);

// VIEWS
function renderLauncher(hash = '') {
    let prefilledCode = '';
    if (hash.startsWith('#join-')) {
        prefilledCode = hash.replace('#join-', '').toUpperCase();
    }

    appDiv.innerHTML = `
        <div class="launcher">
            <h1 class="title" style="font-size: 4rem;">JEOPARDY ONLINE</h1>
            
            <div class="launcher-card">
                <h2>Spiel Starten (Host)</h2>
                <select id="game-select" class="mt-4" style="width: 100%; padding: 0.75rem; border-radius: 8px; background: var(--bg-color); color: white; border: 1px solid var(--panel-border);">
                    ${games.map(g => `<option value="${g.id}" ${g.id === activeGame.id ? 'selected' : ''}>${g.title}</option>`).join('')}
                </select>

                <div class="flex-center gap-4 mt-4">
                    <button class="btn btn-outline" onclick="window.location.hash = '#editor'">
                        <i data-lucide="edit-3"></i> Editor
                    </button>
                    <button class="btn btn-gold" onclick="startHost()">
                        <i data-lucide="play"></i> Host starten
                    </button>
                </div>

                <div class="join-section">
                    <h2>Spiel Beitreten</h2>
                    <p class="text-muted mt-1 mb-4">Trage deinen Namen ${prefilledCode ? '' : 'und den Code '}ein.</p>
                    <input type="text" id="join-name" class="input-field" placeholder="Dein Name" maxlength="15">
                    <input type="text" id="join-code" class="code-input" placeholder="Z.B. A7B9" maxlength="4" value="${prefilledCode}" ${prefilledCode ? 'readonly style="opacity: 0.7;"' : ''}>
                    <button class="btn w-100" onclick="joinGame()">Dem Spiel beitreten</button>
                </div>

                <div class="mt-4 text-center">
                    <button class="btn btn-outline" style="border: none; font-size: 0.8rem; color: var(--text-muted); background: transparent;" onclick="document.getElementById('changelog-modal').style.display='flex'">
                        <i data-lucide="history" style="width: 14px;"></i> Update-Verlauf (Changelog)
                    </button>
                </div>
            </div>
        </div>

        <!-- Changelog Modal -->
        <div id="changelog-modal" class="modal-overlay" style="display: none;">
            <div class="modal-content" style="max-width: 600px;">
                <h2 class="flex-center gap-2 mb-4"><i data-lucide="rocket"></i> Update-Verlauf</h2>
                <div style="max-height: 50vh; overflow-y: auto; text-align: left; padding-right: 1rem;">
                    ${changelog.map(log => `
                        <div class="mb-4 pb-4" style="border-bottom: 1px solid var(--panel-border);">
                            <div class="flex-between mb-2">
                                <strong style="color: var(--primary); font-size: 1.2rem;">${log.version}</strong>
                                <span class="text-muted" style="font-size: 0.85rem;">${log.date}</span>
                            </div>
                            <p style="font-size: 0.95rem; line-height: 1.5; color: var(--text-main); margin: 0;">${log.text}</p>
                        </div>
                    `).join('')}
                </div>
                <button class="btn w-100 mt-4" onclick="document.getElementById('changelog-modal').style.display='none'">Schließen</button>
            </div>
        </div>
    `;

    document.getElementById('game-select').addEventListener('change', (e) => {
        activeGameId = e.target.value;
        activeGame = games.find(g => g.id === activeGameId);
        localStorage.setItem('jeopardy_active_game_v2', activeGameId);
    });
}

window.startHost = function() {
    liveState = { 
        playedQuestions: [], 
        activeQuestion: null, 
        players: [], 
        log: [], 
        stats: {}, 
        gameData: activeGame,
        currentRound: 1 
    };
    logAction('Spielraum erstellt.');
    window.location.hash = '#host';
    initHostPeer();
}

window.setRound = function(r) {
    if(!isHost) return;
    liveState.currentRound = r;
    logAction(`Runde ${r} gestartet.`);
    broadcastState();
    render();
}

window.joinGame = function() {
    const name = document.getElementById('join-name').value.trim();
    const code = document.getElementById('join-code').value.trim();
    
    if (!name) return alert("Bitte gib einen Namen ein.");
    if (code.length !== 4) return alert("Bitte einen 4-stelligen Code eingeben.");
    
    window.location.hash = '#player';
    initPlayerPeer(code, name);
}

function renderHostView() {
    if (!peer || !peer.open) {
        appDiv.innerHTML = `<div class="flex-center" style="height: 100vh;"><h3>Erstelle Raum...</h3></div>`;
        return;
    }

    const actQ = liveState.activeQuestion;
    let questionDetailHtml = `<div class="text-center text-muted" style="margin-top: 4rem;">Wähle eine Frage auf dem Board aus.</div>`;
    
    if (actQ) {
        const round = actQ.round || 1;
        const catList = round === 1 ? activeGame.categories : (activeGame.categoriesRound2 || []);
        const cat = catList[actQ.catIndex];
        const q = cat.questions[actQ.qIndex];
        
        if (cat.type === 'minigame' && (!cat.minigameType || cat.minigameType === 'higher_lower')) {
            const streakIdx = actQ.streakIdx || 0;
            const streakLen = cat.hlStreakLength || 1;
            
            let currentBase = q.question;
            if (streakIdx > 0 && q.hlStreak && q.hlStreak[streakIdx - 1]) {
                currentBase = q.hlStreak[streakIdx - 1].object;
            }

            let currentSt = { object: q.answer, solution: q.hlSolution, fact: q.hlFact };
            if (q.hlStreak && q.hlStreak[streakIdx]) {
                currentSt = q.hlStreak[streakIdx];
            }

            let nextStreakBtn = (streakIdx + 1 < streakLen) ? 
                '<button class="btn btn-primary w-100 mb-2" style="padding: 1rem;" onclick="nextStreak()">Nächste Runde (Streak fortsetzen)</button>' : '';

            let playersHtml = liveState.players.length === 0 ? '<p class="text-muted text-center">Warte auf Spieler...</p>' : '';
            let scoringHtml = '<div style="display: flex; flex-direction: column; gap: 0.5rem;">' + 
                liveState.players.map((p, pIdx) => {
                    const hasAttempted = actQ.attemptedBy.includes(p.id);
                    return '<div class="scoring-player-row">' +
                                '<span class="font-bold">' + p.name + '</span>' +
                                '<div class="flex-center gap-2">' +
                                    '<button class="btn-wrong" ' + (hasAttempted ? 'disabled' : '') + ' onclick="markAttempt(' + pIdx + ', false)">' +
                                        '<i data-lucide="x" style="width:16px;"></i> Falsch' +
                                    '</button>' +
                                    '<button class="btn-correct" ' + (hasAttempted ? 'disabled' : '') + ' onclick="markAttempt(' + pIdx + ', true)">' +
                                        '<i data-lucide="check" style="width:16px;"></i> Richtig' +
                                    '</button>' +
                                '</div>' +
                            '</div>';
                }).join('') + '</div>';

            let answerHtml = actQ.showAnswer ? (
                '<div class="mt-4 p-4" style="background: rgba(16, 185, 129, 0.1); border: 1px solid var(--success); border-radius: 8px;">' +
                    '<h3 class="text-success">Lösung: ' + (currentSt.solution === 'Höher' ? '⬆️ Höher' : '⬇️ Tiefer') + '</h3>' +
                    '<p style="font-size: 1.1rem; margin-top: 0.5rem;">' + (currentSt.fact || '') + '</p>' +
                '</div>' +
                '<div class="mt-4">' +
                    nextStreakBtn +
                    '<button class="btn btn-gold w-100" style="padding: 1rem;" onclick="closeQuestion()">Zurück zum Board</button>' +
                '</div>'
            ) : (
                '<div class="mt-4">' +
                    '<h4 class="mb-2">Wer hat getippt?</h4>' +
                    playersHtml + scoringHtml +
                '</div>' +
                '<div class="mt-4 pt-4" style="border-top: 1px dashed var(--panel-border);">' +
                    '<button class="btn btn-outline w-100" style="padding: 1rem;" onclick="showAnswer()">Auflösung zeigen</button>' +
                '</div>'
            );

            questionDetailHtml = `
                <div>
                    <div class="flex-between">
                        <span class="text-gold font-bold">${cat.name} für ${actQ.points} (Höher/Tiefer) - Runde ${streakIdx + 1}/${streakLen}</span>
                        <button class="btn btn-danger" onclick="closeQuestion()">Zurück</button>
                    </div>
                    <div class="mt-4 p-4" style="background: rgba(255,255,255,0.05); border-radius: 8px;">
                        <h4 class="text-muted mb-2">Basis-Aussage:</h4>
                        <p style="font-size: 1.2rem;">${currentBase || '-'}</p>
                    </div>
                    <div class="mt-4 p-4" style="background: rgba(255,255,255,0.05); border-radius: 8px;">
                        <h4 class="text-muted mb-2">Vergleichs-Objekt:</h4>
                        <p style="font-size: 1.5rem; font-weight: bold; color: var(--primary);">${currentSt.object || '-'}</p>
                    </div>
                    ${answerHtml}
                </div>
            `;
        } else {
            const isEmoji = cat.type === 'minigame' && cat.minigameType === 'emoji';
            questionDetailHtml = `
                <div>
                    <div class="flex-between">
                        <span class="text-gold font-bold">${cat.name} für ${actQ.points}</span>
                        <button class="btn btn-danger" onclick="closeQuestion()">Zurück zum Board</button>
                    </div>
                    <h2 class="mt-4" style="font-size: ${isEmoji ? '4rem' : '1.5rem'}; text-align: ${isEmoji ? 'center' : 'left'}; letter-spacing: ${isEmoji ? '0.5rem' : 'normal'};">${q.question || '<span class="text-muted">[Keine Frage hinterlegt]</span>'}</h2>
                    
                    ${q.image ? `
                        <div class="text-center">
                            <img src="${q.image}" class="question-image" style="filter: blur(${actQ.blur}px);">
                            ${actQ.blur > 0 ? `
                                <div class="mt-2">
                                    <button class="btn btn-outline" style="padding: 0.5rem;" onclick="reduceBlur()">
                                        <i data-lucide="eye" style="width:16px;"></i> Bild etwas klarer machen
                                    </button>
                                </div>
                            ` : ''}
                        </div>
                    ` : ''}

                    ${actQ.showAnswer ? `
                        <div class="mt-4 p-4" style="background: rgba(16, 185, 129, 0.1); border: 1px solid var(--success); border-radius: 8px;">
                            <h3 class="text-success">Antwort:</h3>
                            <p style="font-size: 1.5rem; font-weight: bold;">${q.answer || '-'}</p>
                        </div>
                        <div class="mt-4"><button class="btn btn-gold w-100" style="padding: 1rem;" onclick="closeQuestion()">Zurück zum Board</button></div>
                    ` : `
                        <div class="mt-4">
                            <h4 class="mb-2">Wer hat geantwortet?</h4>
                            ${liveState.players.length === 0 ? '<p class="text-muted text-center">Warte auf Spieler für Punktevergabe...</p>' : ''}
                            <div style="display: flex; flex-direction: column; gap: 0.5rem;">
                                ${liveState.players.map((p, pIdx) => {
                                    const hasAttempted = actQ.attemptedBy.includes(p.id);
                                    return `
                                        <div class="scoring-player-row">
                                            <span class="font-bold">${p.name}</span>
                                            <div class="flex-center gap-2">
                                                <button class="btn-wrong" ${hasAttempted ? 'disabled' : ''} onclick="markAttempt(${pIdx}, false)">
                                                    <i data-lucide="x" style="width:16px;"></i> Falsch
                                                </button>
                                                <button class="btn-correct" ${hasAttempted ? 'disabled' : ''} onclick="markAttempt(${pIdx}, true)">
                                                    <i data-lucide="check" style="width:16px;"></i> Richtig
                                                </button>
                                            </div>
                                        </div>
                                    `;
                                }).join('')}
                            </div>
                        </div>
                        <div class="mt-4 pt-4" style="border-top: 1px dashed var(--panel-border);">
                            <button class="btn btn-outline w-100" style="padding: 1rem;" onclick="showAnswer()">Niemand wusste es (Antwort aufdecken)</button>
                        </div>
                    `}

                    <div class="fact-check-box">
                        <h4 class="flex-between" style="color: var(--magic);">
                            <span class="flex-center gap-2"><i data-lucide="sparkles"></i> KI Fact-Check</span>
                            <button class="btn btn-outline" style="padding: 0.25rem 0.75rem; font-size: 0.8rem; border-color: var(--magic); color: var(--magic);" onclick="factCheckAI(${actQ.catIndex}, ${actQ.qIndex})">KI fragen</button>
                        </h4>
                        <div id="fact-check-result" class="mt-2 text-muted" style="font-size: 0.9rem;">
                            Tippe auf KI fragen, um die Antwort überprüfen zu lassen.
                        </div>
                    </div>
                </div>
            `;
        }
    }

    appDiv.innerHTML = `
        <div class="status-banner">
            <div class="status-indicator ${connections.length > 0 ? 'green' : 'yellow'}"></div>
            <span>Raum-Code: <span class="text-gold" style="letter-spacing: 2px;">${roomCode}</span></span>
            <button class="btn btn-outline" style="padding: 0.25rem 0.75rem; font-size: 0.8rem; margin-left: 1rem;" onclick="copyInviteLink()">
                <i data-lucide="link"></i> Link kopieren
            </button>
            <span class="text-muted ml-2" style="margin-left: 1rem; font-weight: normal;">(${liveState.players.length} Spieler verbunden)</span>
        </div>

        <div class="host-layout">
            <div style="display: flex; flex-direction: column; gap: 1.5rem;">
                <div class="host-board-mini">
                    <div class="flex-between mb-2">
                        <h3 style="margin: 0;">Dein Board</h3>
                        <div class="flex-center gap-2" style="background: rgba(255,255,255,0.05); padding: 0.25rem; border-radius: 8px;">
                            <button class="btn btn-outline ${liveState.currentRound === 1 ? 'active-round' : ''}" style="padding: 0.4rem 1rem; font-size: 0.8rem; border: none;" onclick="setRound(1)">Runde 1</button>
                            <button class="btn btn-outline ${liveState.currentRound === 2 ? 'active-round' : ''}" style="padding: 0.4rem 1rem; font-size: 0.8rem; border: none;" onclick="setRound(2)">Runde 2</button>
                        </div>
                    </div>
                    <div class="host-board-grid mt-2">
                        ${(liveState.currentRound === 1 ? activeGame.categories : (activeGame.categoriesRound2 || [])).map((cat, cIdx) => `
                            <div class="host-col">
                                <div class="text-center font-bold text-muted" style="font-size: 0.75rem; height: 30px; overflow: hidden;">${cat.name}</div>
                                ${Array(activeGame.questionsPerCategory || 5).fill(0).map((_, qIdx) => {
                                    const round = liveState.currentRound || 1;
                                    const catList = round === 1 ? activeGame.categories : (activeGame.categoriesRound2 || []);
                                    const cat = catList[cIdx];
                                    const q = cat.questions[qIdx] || { points: (qIdx+1)*200 };
                                    
                                    const roundMultiplier = round === 2 ? 2 : 1;
                                    const displayPoints = (qIdx + 1) * (activeGame.pointMultiplier || 100) * roundMultiplier;
                                    const qKey = `${round}-${cIdx}-${qIdx}`;
                                    const isPlayed = liveState.playedQuestions.includes(qKey);
                                    const isActive = actQ && actQ.catIndex === cIdx && actQ.qIndex === qIdx && actQ.round === round;
                                    return `
                                        <div class="host-card ${isPlayed ? 'played' : ''}" 
                                             style="${isActive ? 'background: var(--primary); color: white;' : ''}"
                                             onclick="!${isPlayed} && openQuestion(${cIdx}, ${qIdx})">
                                            ${displayPoints}
                                        </div>
                                    `;
                                }).join('')}
                            </div>
                        `).join('')}
                    </div>
                </div>

                <div class="host-panel">
                    <div class="flex-between">
                        <h3>Spieler & Punkte</h3>
                        <button class="btn btn-outline" style="padding: 0.25rem 0.5rem; font-size: 0.8rem;" onclick="showStatsModal()"><i data-lucide="bar-chart-2" style="width:14px;"></i> Statistiken</button>
                    </div>
                    ${liveState.players.length === 0 ? '<p class="text-muted mt-2">Warte auf Spieler...</p>' : ''}
                    <div class="player-scores mt-2">
                        ${liveState.players.map((p, pIdx) => `
                            <div class="player-score-card">
                                <span class="font-bold">${p.name}</span>
                                <div class="flex-center gap-2">
                                    <button class="sub" onclick="updateScore(${pIdx}, -100)"><i data-lucide="minus"></i></button>
                                    <span style="font-family: 'Outfit'; font-size: 1.25rem; min-width: 60px; text-align: center;">${p.score}</span>
                                    <button class="add" onclick="updateScore(${pIdx}, 100)"><i data-lucide="plus"></i></button>
                                </div>
                            </div>
                        `).join('')}
                    </div>
                </div>
                
                <div class="host-panel" style="flex: 1; min-height: 200px;">
                    <h3>Aktions-Log</h3>
                    <div class="action-log mt-2" id="action-log-container">
                        ${liveState.log.map(l => `<div class="log-entry"><span class="log-time">${l.time}</span>${l.msg}</div>`).join('')}
                    </div>
                </div>
            </div>

            <div class="host-panel">
                <h3>Aktuelle Frage</h3>
                ${questionDetailHtml}
            </div>
        </div>
        
        <!-- Stats Modal -->
        <div id="stats-modal" class="modal-overlay" style="display: none;">
            <div class="modal-content">
                <h2 class="flex-center gap-2 mb-4"><i data-lucide="bar-chart-2"></i> Spiel-Statistiken</h2>
                <div style="max-height: 60vh; overflow-y: auto;">
                    ${liveState.players.map(p => {
                        const s = liveState.stats[p.id] || { correct: 0, wrong: 0, buzzes: 0 };
                        return `
                            <div class="mb-4 p-4" style="background: var(--bg-color); border: 1px solid var(--panel-border); border-radius: 8px;">
                                <h3 class="text-gold mb-2">${p.name}</h3>
                                <div class="flex-between"><span><i data-lucide="check" class="text-success" style="width:14px;"></i> Richtig:</span> <b>${s.correct}</b></div>
                                <div class="flex-between"><span><i data-lucide="x" class="text-danger" style="width:14px;"></i> Falsch:</span> <b>${s.wrong}</b></div>
                                <div class="flex-between"><span><i data-lucide="bell" class="text-primary" style="width:14px;"></i> Buzzers:</span> <b>${s.buzzes}</b></div>
                            </div>
                        `;
                    }).join('')}
                    ${liveState.players.length === 0 ? '<p class="text-muted text-center">Noch keine Spielerdaten vorhanden.</p>' : ''}
                </div>
                <button class="btn w-100 mt-4" onclick="document.getElementById('stats-modal').style.display='none'">Schließen</button>
            </div>
        </div>
    `;

    // auto scroll log
    setTimeout(() => {
        const logBox = document.getElementById('action-log-container');
        if(logBox) logBox.scrollTop = logBox.scrollHeight;
    }, 50);
}

window.showStatsModal = function() {
    document.getElementById('stats-modal').style.display = 'flex';
    if(window.lucide) window.lucide.createIcons();
}

window.openQuestion = function(catIndex, qIndex) {
    const round = liveState.currentRound || 1;
    const catList = round === 1 ? activeGame.categories : (activeGame.categoriesRound2 || []);
    const cat = catList[catIndex];
    let q = cat.questions[qIndex];
    
    if (!q) {
        const roundMultiplier = round === 2 ? 2 : 1;
        q = buildEmptyQuestion((qIndex + 1) * (activeGame.pointMultiplier || 100) * roundMultiplier);
        cat.questions[qIndex] = q;
        saveGames();
    }

    let initialBlur = (q.image && q.progressive) ? 40 : 0;
    const roundMultiplier = round === 2 ? 2 : 1;
    const currentPoints = (qIndex + 1) * (activeGame.pointMultiplier || 100) * roundMultiplier;
    
    liveState.activeQuestion = { 
        catIndex, 
        qIndex, 
        round,
        points: currentPoints,
        showAnswer: false, 
        attempts: 0, 
        attemptedBy: [], 
        blur: initialBlur, 
        streakIdx: 0 
    };
    
    const qKey = `${round}-${catIndex}-${qIndex}`;
    if (!liveState.playedQuestions.includes(qKey)) {
        liveState.playedQuestions.push(qKey);
    }
    logAction(`Frage geöffnet: ${cat.name} für ${currentPoints}.`);
    broadcastState();
    render();
}

window.markAttempt = function(pIdx, isCorrect) {
    const actQ = liveState.activeQuestion;
    const player = liveState.players[pIdx];
    const points = actQ.points;

    liveState.stats[player.id].buzzes++;

    if (isCorrect) {
        player.score += points;
        liveState.stats[player.id].correct++;
        actQ.showAnswer = true;
        actQ.blur = 0;
        logAction(`${player.name} antwortet RICHTIG (+${points}).`);
    } else {
        const penalty = actQ.attempts === 0 ? points : Math.floor(points / 2);
        player.score -= penalty;
        liveState.stats[player.id].wrong++;
        actQ.attempts += 1;
        actQ.attemptedBy.push(player.id);
        logAction(`${player.name} antwortet FALSCH (-${penalty}).`);
    }
    broadcastState();
    render();
}

window.reduceBlur = function() {
    if (liveState.activeQuestion && liveState.activeQuestion.blur > 0) {
        liveState.activeQuestion.blur = Math.max(0, liveState.activeQuestion.blur - 10);
        broadcastState();
        render();
    }
}

window.showAnswer = function() {
    if (liveState.activeQuestion) {
        liveState.activeQuestion.showAnswer = true;
        broadcastState();
        render();
    }
}

window.nextStreak = function() {
    if (liveState.activeQuestion) {
        liveState.activeQuestion.streakIdx++;
        liveState.activeQuestion.showAnswer = false;
        liveState.activeQuestion.attempts = 0;
        liveState.activeQuestion.attemptedBy = [];
        broadcastState();
        render();
    }
}

window.closeQuestion = function() {
    liveState.activeQuestion = null;
    broadcastState();
    render();
}

window.updateScore = function(pIdx, delta) {
    liveState.players[pIdx].score += delta;
    broadcastState();
    render();
}

window.copyInviteLink = function() {
    const baseUrl = window.location.href.split('#')[0];
    const inviteUrl = `${baseUrl}#join-${roomCode}`;
    navigator.clipboard.writeText(inviteUrl).then(() => {
        alert("Einladungs-Link kopiert!\n\nSchicke ihn an deine Freunde. Sie müssen dann nur noch ihren Namen eintragen.");
    }).catch(err => {
        console.error('Konnte Link nicht kopieren: ', err);
        prompt("Kopiere diesen Link:", inviteUrl);
    });
}

window.factCheckAI = async function(cIdx, qIdx) {
    const round = liveState.activeQuestion?.round || liveState.currentRound || 1;
    const catList = round === 1 ? activeGame.categories : (activeGame.categoriesRound2 || []);
    const cat = catList[cIdx];
    const q = cat?.questions?.[qIdx];
    const apiKey = localStorage.getItem('jeopardy_gemini_key');
    const box = document.getElementById('fact-check-result');
    
    if (!cat || !q) {
        box.innerHTML = '<span class="text-danger">Frage konnte nicht geladen werden.</span>';
        return;
    }

    if (!apiKey) {
        box.innerHTML = '<span class="text-danger">Kein API-Key hinterlegt. Gehe in den Editor -> Einstellungen, um ihn einzutragen.</span>';
        return;
    }

    box.innerHTML = '<span class="text-magic">KI analysiert... <i data-lucide="loader" class="fa-spin"></i></span>';
    if (window.lucide) window.lucide.createIcons();
    
    const prompt = `Du bist der Schiedsrichter bei Jeopardy.
    Kategorie: "${cat.name}"
    Frage: "${q.question}"
    Geplante Antwort: "${q.answer}"

Bitte erkläre kurz in 2-3 Sätzen, ob die geplante Antwort korrekt ist und gib ggf. interessante Zusatzfakten.`;

    try {
        let model = localStorage.getItem('jeopardy_gemini_model') || 'gemini-2.5-flash';
        let res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
        });

        if (res.status === 404) {
            model = 'gemini-1.5-flash';
            localStorage.setItem('jeopardy_gemini_model', model);
            res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
            });
        }

        if (res.status === 503) {
            console.log("Model overloaded (503), trying fallback...");
            const fallbackModel = model.includes('2.5') ? 'gemini-1.5-flash' : 'gemini-1.5-pro';
            res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${fallbackModel}:generateContent?key=${apiKey}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
            });
        }

        if (!res.ok) {
            if (res.status === 503) {
                throw new Error("Die Google KI-Server sind im Moment leider komplett überlastet. Bitte versuche es in ein paar Minuten noch einmal.");
            }
            throw new Error(`API Error: ${res.status}`);
        }

        const data = await res.json();
        
        if (data.candidates && data.candidates[0].content.parts[0].text) {
            box.innerHTML = `
                <div style="background: rgba(168, 85, 247, 0.1); padding: 1rem; border-radius: 8px; margin-top: 1rem; border-left: 3px solid var(--magic);">
                    <h4 style="color: var(--magic); margin-bottom: 0.5rem; font-family: Inter;">KI-Urteil</h4>
                    <p style="color: var(--text-main); font-size: 0.95rem; line-height: 1.5;">${data.candidates[0].content.parts[0].text.replace(/\n/g, '<br>')}</p>
                </div>
            `;
        } else {
            throw new Error("Invalid AI response");
        }
    } catch(e) {
        console.error(e);
        box.innerHTML = '<span class="text-danger">Fehler bei der KI-Abfrage. API-Key prüfen!</span>';
    }
}

function renderPlayerView() {
    if (!hostConnection || !hostConnection.open) {
        appDiv.innerHTML = `
            <div class="flex-center" style="height: 100vh; flex-direction: column; gap: 1rem;">
                <div class="status-indicator yellow" style="width: 20px; height: 20px;"></div>
                <h3>Verbinde mit Raum ${roomCode}...</h3>
            </div>
        `;
        return;
    }

    const actQ = liveState.activeQuestion;
    const currentRound = liveState.currentRound || 1;
    const currentCategories = currentRound === 1 ? activeGame.categories : (activeGame.categoriesRound2 || []);
    let overlayHtml = '';

    if (actQ) {
        const activeRound = actQ.round || 1;
        const activeCategories = activeRound === 1 ? activeGame.categories : (activeGame.categoriesRound2 || []);
        const cat = activeCategories[actQ.catIndex];
        const q = cat?.questions?.[actQ.qIndex];
        
        if (!cat || !q) {
            overlayHtml = `
                <div class="active-question-overlay">
                    <div class="active-question-text">Diese Frage konnte nicht geladen werden.</div>
                </div>
            `;
        } else if (cat.type === 'minigame' && (!cat.minigameType || cat.minigameType === 'higher_lower')) {
            const streakIdx = actQ.streakIdx || 0;
            
            let currentBase = q.question;
            if (streakIdx > 0 && q.hlStreak && q.hlStreak[streakIdx - 1]) {
                currentBase = q.hlStreak[streakIdx - 1].object;
            }

            let currentSt = { object: q.answer, solution: q.hlSolution, fact: q.hlFact };
            if (q.hlStreak && q.hlStreak[streakIdx]) {
                currentSt = q.hlStreak[streakIdx];
            }

            overlayHtml = `
                <div class="active-question-overlay">
                    <div style="display: flex; flex-direction: column; height: 100%; justify-content: center; gap: 2rem; text-align: center;">
                        <div style="font-size: 2rem; color: var(--text-muted);">${cat.name} für ${q.points}</div>
                        <div class="active-question-text" style="font-size: 3rem; margin: 0;">${currentBase || '-'}</div>
                        
                        <div style="font-size: 4rem; color: var(--primary); font-weight: bold; background: rgba(0,0,0,0.5); padding: 2rem; border-radius: 16px; border: 4px solid var(--primary);">
                            ${currentSt.object || '-'}
                        </div>

                        ${!actQ.showAnswer ? `
                            <div style="display: flex; gap: 2rem; justify-content: center; margin-top: 2rem;">
                                <button class="btn btn-gold" style="font-size: 2.5rem; padding: 2rem 4rem; border-radius: 20px;" onclick="playerGuessHl('Höher', this)">⬆️ Höher</button>
                                <button class="btn btn-outline" style="font-size: 2.5rem; padding: 2rem 4rem; border-radius: 20px; border-width: 4px;" onclick="playerGuessHl('Tiefer', this)">⬇️ Tiefer</button>
                            </div>
                        ` : ''}
                        
                        ${actQ.showAnswer ? (
                            '<div style="font-size: 5rem; font-weight: bold; color: ' + (currentSt.solution === 'Höher' ? 'var(--success)' : 'var(--danger)') + '; animation: popIn 0.5s ease-out;">' +
                                (currentSt.solution === 'Höher' ? '⬆️ HÖHER' : '⬇️ TIEFER') +
                            '</div>'
                        ) : ''}
                    </div>
                </div>
            `;
        } else {
            const isEmoji = cat.type === 'minigame' && cat.minigameType === 'emoji';
            overlayHtml = `
                <div class="active-question-overlay">
                    <div class="active-question-text" style="${isEmoji ? 'font-size: 5rem; letter-spacing: 0.5rem; line-height: 1.2;' : ''}">
                        ${q.question || '...'}
                    </div>
                    ${q.image ? '<img src="' + q.image + '" class="question-image" style="filter: blur(' + actQ.blur + 'px);">' : ''}
                    ${actQ.showAnswer ? '<div class="active-answer-text">' + q.answer + '</div>' : ''}
                </div>
            `;
        }
    }

    appDiv.innerHTML = `
        <div class="player-view">
            <div class="flex-between" style="padding: 1rem; background: rgba(0,0,0,0.3); border-bottom: 1px solid rgba(255,255,255,0.1);">
                <h3 style="margin:0; color: var(--gold);">Runde ${currentRound}</h3>
                <div style="display: flex; gap: 1rem;">
                    ${liveState.players.map(p => `
                        <div style="text-align: right;">
                            <div style="font-size: 0.8rem; color: var(--text-muted);">${p.name}</div>
                            <div style="font-weight: bold; color: #fff;">${p.score}</div>
                        </div>
                    `).join('')}
                </div>
            </div>
            <div class="board">
                ${currentCategories.map((cat, cIdx) => `
                    <div class="board-column">
                        <div class="category-header">${cat.name}</div>
                        ${Array(activeGame.questionsPerCategory || cat.questions.length).fill(0).map((_, qIdx) => {
                            const roundMultiplier = currentRound === 2 ? 2 : 1;
                            const displayPoints = (qIdx + 1) * (activeGame.pointMultiplier || 100) * roundMultiplier;
                            const qKey = `${currentRound}-${cIdx}-${qIdx}`;
                            const isPlayed = liveState.playedQuestions.includes(qKey);
                            return `
                                <div class="board-card ${isPlayed ? 'played' : ''}">
                                    ${displayPoints}
                                </div>
                            `;
                        }).join('')}
                    </div>
                `).join('')}
            </div>
            ${overlayHtml}
        </div>
    `;
}

// ==========================================
// EDITOR & AI
// ==========================================

let isGenerating = false;

function renderEditor() {
    const hasKey = !!localStorage.getItem('jeopardy_gemini_key');
    const currentModel = localStorage.getItem('jeopardy_gemini_model') || 'gemini-2.5-flash';
    if (!window.editorRound) window.editorRound = 1;

    appDiv.innerHTML = `
        <div class="container">
            <div class="flex-between mb-4">
                <h1 class="title" style="margin: 0; font-size: 2rem;">Editor: ${activeGame.title}</h1>
                <div class="flex-center gap-2">
                    <button class="btn btn-outline" style="font-size: 0.8rem; padding: 0.5rem;" onclick="document.getElementById('settings-modal').style.display='flex'">⚙️ Einstellungen</button>
                    <button class="btn" onclick="window.location.hash = ''">Zurück zum Start</button>
                </div>
            </div>
            
            <div class="flex-between mt-2 mb-4">
                <p class="text-muted" style="margin: 0;">Bearbeite die Kategorien und Fragen. Klicke auf den <b style="color: var(--magic);">✨ KI-Zauberstab</b> zum Füllen!</p>
                <div class="flex-center gap-2" style="background: rgba(255,255,255,0.05); padding: 0.25rem; border-radius: 8px;">
                    <button class="btn ${window.editorRound === 1 ? '' : 'btn-outline'}" style="padding: 0.4rem 1.5rem; font-size: 0.9rem; border: none;" onclick="window.editorRound = 1; render();">Runde 1 (100-500)</button>
                    <button class="btn ${window.editorRound === 2 ? '' : 'btn-outline'}" style="padding: 0.4rem 1.5rem; font-size: 0.9rem; border: none;" onclick="window.editorRound = 2; render();">Runde 2 (200-1000)</button>
                </div>
            </div>

            <div class="editor-grid">
                ${(window.editorRound === 1 ? activeGame.categories : (activeGame.categoriesRound2 || [])).map((cat, cIdx) => `
                    <div class="category-card">
                        <div class="cat-header">
                            <input type="text" class="cat-title" value="${cat.name}" onchange="updateCatName(${cIdx}, this.value)" placeholder="Kategoriename">
                            
                            <div class="flex-between mt-2 mb-2" style="background: rgba(255,255,255,0.05); padding: 0.25rem; border-radius: 6px;">
                                <button class="btn ${!cat.type || cat.type === 'standard' ? '' : 'btn-outline'}" style="flex: 1; border: none; font-size: 0.8rem;" onclick="updateCatType(${cIdx}, 'standard')">Standard</button>
                                <button class="btn ${cat.type === 'minigame' ? '' : 'btn-outline'}" style="flex: 1; border: none; font-size: 0.8rem;" onclick="updateCatType(${cIdx}, 'minigame')">Minispiel</button>
                            </div>
                            
                            ${cat.type === 'minigame' ? `
                                <div class="mb-2 flex-between gap-2">
                                    <select onchange="updateCatMinigameType(${cIdx}, this.value)" class="input-field" style="flex: 2; font-size: 0.85rem; padding: 0.4rem;">
                                        <option value="higher_lower" ${(!cat.minigameType || cat.minigameType === 'higher_lower') ? 'selected' : ''}>Art: Höher / Tiefer</option>
                                        <option value="emoji" ${cat.minigameType === 'emoji' ? 'selected' : ''}>Art: Emoji-Rätsel</option>
                                    </select>
                                    ${(!cat.minigameType || cat.minigameType === 'higher_lower') ? `
                                    <select onchange="updateCatStreak(${cIdx}, parseInt(this.value))" class="input-field" style="flex: 1; font-size: 0.85rem; padding: 0.4rem;" title="Anzahl Vergleiche pro Frage (Streak)">
                                        <option value="1" ${(!cat.hlStreakLength || cat.hlStreakLength === 1) ? 'selected' : ''}>1 Runde</option>
                                        <option value="3" ${cat.hlStreakLength === 3 ? 'selected' : ''}>3 Runden</option>
                                        <option value="5" ${cat.hlStreakLength === 5 ? 'selected' : ''}>5 Runden</option>
                                    </select>
                                    ` : ''}
                                </div>
                            ` : ''}

                            <div class="flex-between gap-2 mt-2">
                                <select id="ai-diff-${cIdx}" style="flex: 1; padding: 0.5rem; background: var(--bg-color); color: var(--text-main); border: 1px solid var(--panel-border); border-radius: 6px; font-family: Inter;">
                                    <option value="Sehr Einfach (für Kinder/Familie)">Leicht</option>
                                    <option value="Normal (Standard)" selected>Normal</option>
                                    <option value="Sehr Schwer (für absolute Experten)">Schwer</option>
                                </select>
                                <button class="btn-magic" style="flex: 1;" onclick="triggerAIGeneration(${cIdx})" ${isGenerating ? 'disabled' : ''}>
                                    <i data-lucide="sparkles" style="width: 16px;"></i> KI füllen
                                </button>
                            </div>
                        </div>
                        <div id="ai-status-${cIdx}" class="text-center text-magic mb-2" style="display:none; font-size: 0.85rem;">
                            <i data-lucide="loader" class="fa-spin"></i> Generiere...
                        </div>
                        ${cat.questions.map((q, qIdx) => {
                            if (cat.type === 'minigame' && (!cat.minigameType || cat.minigameType === 'higher_lower')) {
                                let streakLen = cat.hlStreakLength || 1;
                                if (!q.hlStreak) q.hlStreak = [];
                                if (q.hlStreak.length === 0 && q.answer) {
                                    q.hlStreak.push({ object: q.answer, solution: q.hlSolution, fact: q.hlFact });
                                }
                                while (q.hlStreak.length < streakLen) {
                                    q.hlStreak.push({ object: '', solution: '', fact: '' });
                                }
                                if (q.hlStreak.length > streakLen) {
                                    q.hlStreak.length = streakLen;
                                }

                                return `
                                    <div class="question-item" style="border-left: 3px solid var(--magic);">
                                        <div class="text-gold font-bold mb-2">${q.points} Pkt (Höher/Tiefer)</div>
                                        <textarea placeholder="Start-Aussage (Basis) (z.B. Berlin hat 3,6 Mio Einwohner)" rows="2" onchange="updateQuestion(${cIdx}, ${qIdx}, 'question', this.value)">${q.question || ''}</textarea>
                                        
                                        <div class="mt-2 text-muted" style="font-size: 0.8rem; font-weight: bold;">Vergleiche (${streakLen}):</div>
                                        ${q.hlStreak.map((st, stIdx) => `
                                            <div style="background: rgba(0,0,0,0.2); padding: 0.5rem; border-radius: 4px; margin-top: 0.5rem;">
                                                <div style="font-size: 0.75rem; color: var(--primary); margin-bottom: 0.25rem;">Runde ${stIdx + 1}</div>
                                                <textarea placeholder="Vergleichs-Objekt (z.B. Wie ist es bei München?)" rows="1" onchange="updateStreak(${cIdx}, ${qIdx}, ${stIdx}, 'object', this.value)">${st.object || ''}</textarea>
                                                <div class="flex-between gap-2 mt-2">
                                                    <select onchange="updateStreak(${cIdx}, ${qIdx}, ${stIdx}, 'solution', this.value)" style="flex: 1; padding: 0.4rem; background: var(--bg-color); color: var(--text-main); border: 1px solid var(--panel-border); border-radius: 4px; font-size: 0.85rem;">
                                                        <option value="" disabled ${!st.solution ? 'selected' : ''}>Lösung?</option>
                                                        <option value="Höher" ${st.solution === 'Höher' ? 'selected' : ''}>⬆️ Höher</option>
                                                        <option value="Tiefer" ${st.solution === 'Tiefer' ? 'selected' : ''}>⬇️ Tiefer</option>
                                                    </select>
                                                </div>
                                                <input type="text" placeholder="Zusatzfakt / Auflösung (z.B. 1,5 Mio)" value="${st.fact || ''}" onchange="updateStreak(${cIdx}, ${qIdx}, ${stIdx}, 'fact', this.value)" style="margin-top:0.5rem; font-size: 0.85rem;">
                                            </div>
                                        `).join('')}
                                        
                                        <input type="text" placeholder="Bild-URL (optional)..." value="${q.image || ''}" onchange="updateQuestion(${cIdx}, ${qIdx}, 'image', this.value)" style="color: var(--primary); font-weight: normal; font-size: 0.8rem; margin-top: 0.5rem;">
                                    </div>
                                `;
                            } else {
                                const isEmoji = cat.type === 'minigame' && cat.minigameType === 'emoji';
                                return `
                                    <div class="question-item">
                                        <div class="text-gold font-bold mb-2">${q.points} Pkt ${isEmoji ? '(Emoji-Rätsel)' : ''}</div>
                                        <textarea placeholder="${isEmoji ? 'Tippe Emojis ein (z.B. 🚢🧊🥶)' : 'Tippe hier die Frage ein...'}" rows="2" onchange="updateQuestion(${cIdx}, ${qIdx}, 'question', this.value)">${q.question || ''}</textarea>
                                        <input type="text" placeholder="${isEmoji ? 'Lösung (z.B. Titanic)' : 'Tippe hier die Antwort ein...'}" value="${q.answer || ''}" onchange="updateQuestion(${cIdx}, ${qIdx}, 'answer', this.value)">
                                        <input type="text" placeholder="Bild-URL (optional)..." value="${q.image || ''}" onchange="updateQuestion(${cIdx}, ${qIdx}, 'image', this.value)" style="color: var(--primary); font-weight: normal; font-size: 0.8rem; margin-top: 0.5rem;">
                                        <label style="display: flex; align-items: center; gap: 0.5rem; font-size: 0.8rem; color: var(--text-muted); margin-top: 0.5rem; cursor: pointer;">
                                            <input type="checkbox" ${q.progressive ? 'checked' : ''} onchange="updateQuestion(${cIdx}, ${qIdx}, 'progressive', this.checked)">
                                            Bild schrittweise aufdecken (Progressive Reveal)
                                        </label>
                                    </div>
                                `;
                            }
                        }).join('')}
                    </div>
                `).join('')}
            </div>
        </div>
        
        <!-- API Key Modal -->
        <div id="api-modal" class="modal-overlay" style="display: none;">
            <div class="modal-content">
                <h2 style="color: var(--magic);" class="flex-center gap-2">
                    <i data-lucide="key"></i> Gemini API Key benötigt
                </h2>
                <p class="text-muted mt-2" style="font-size: 0.9rem; line-height: 1.5;">
                    Um Fragen automatisch zu generieren, benötigt die App Zugriff auf die kostenlose Google Gemini KI. 
                    Den Key erhältst du kostenlos unter <b>aistudio.google.com/app/apikey</b>. Er wird nur lokal in deinem Browser gespeichert!
                </p>
                <input type="password" id="api-key-input" class="input-field mt-4" placeholder="AIzaSyB...">
                <div class="flex-between mt-4">
                    <button class="btn btn-outline" onclick="closeApiModal()">Abbrechen</button>
                    <button class="btn" style="background: var(--magic);" onclick="saveApiKey()">Speichern & Generieren</button>
                </div>
            </div>
        </div>

        <!-- Settings Modal -->
        <div id="settings-modal" class="modal-overlay" style="display: none;">
            <div class="modal-content">
                <h2 class="flex-center gap-2 mb-4"><i data-lucide="settings"></i> Editor Einstellungen</h2>
                <div class="flex-center gap-4 mt-4" style="flex-direction: column;">
                    <button class="btn btn-outline w-100" onclick="exportGame()">💾 Spiel Exportieren</button>
                    <button class="btn btn-outline w-100" onclick="document.getElementById('import-file').click()">📂 Spiel Importieren</button>
                    <input type="file" id="import-file" accept=".json" style="display:none;" onchange="importGame(event)">
                    
                    <hr style="width: 100%; border-color: var(--panel-border); margin: 1rem 0;">
                    
                    <div style="width: 100%; text-align: left;">
                        <label style="color: var(--text-muted); font-size: 0.85rem; margin-bottom: 0.5rem; display: block;">Fragen pro Kategorie:</label>
                        <select onchange="updateGlobalQuestions(parseInt(this.value))" style="width: 100%; padding: 0.75rem; background: var(--bg-color); color: var(--text-main); border: 1px solid var(--panel-border); border-radius: 6px; font-family: Inter; margin-bottom: 1rem;">
                            <option value="3" ${activeGame.questionsPerCategory === 3 ? 'selected' : ''}>3 Fragen</option>
                            <option value="4" ${activeGame.questionsPerCategory === 4 ? 'selected' : ''}>4 Fragen</option>
                            <option value="5" ${(activeGame.questionsPerCategory || 5) === 5 ? 'selected' : ''}>5 Fragen (Standard)</option>
                            <option value="6" ${activeGame.questionsPerCategory === 6 ? 'selected' : ''}>6 Fragen</option>
                            <option value="7" ${activeGame.questionsPerCategory === 7 ? 'selected' : ''}>7 Fragen</option>
                            <option value="8" ${activeGame.questionsPerCategory === 8 ? 'selected' : ''}>8 Fragen</option>
                        </select>
                    </div>

                    <div style="width: 100%; text-align: left;">
                        <label style="color: var(--text-muted); font-size: 0.85rem; margin-bottom: 0.5rem; display: block;">Punkte-Modus:</label>
                        <select onchange="updateGlobalMultiplier(parseInt(this.value))" style="width: 100%; padding: 0.75rem; background: var(--bg-color); color: var(--text-main); border: 1px solid var(--panel-border); border-radius: 6px; font-family: Inter; margin-bottom: 1rem;">
                            <option value="10" ${activeGame.pointMultiplier === 10 ? 'selected' : ''}>Kids/Fun (10, 20, 30...)</option>
                            <option value="100" ${(activeGame.pointMultiplier || 100) === 100 ? 'selected' : ''}>Klassisch (100, 200, 300...)</option>
                            <option value="200" ${activeGame.pointMultiplier === 200 ? 'selected' : ''}>Double Jeopardy (200, 400...)</option>
                            <option value="500" ${activeGame.pointMultiplier === 500 ? 'selected' : ''}>High Stakes (500, 1000...)</option>
                        </select>
                    </div>
                    
                    <div style="width: 100%; text-align: left;">
                        <label style="color: var(--text-muted); font-size: 0.85rem; margin-bottom: 0.5rem; display: block;">KI-Modell (Bei Server-Überlastung wechseln):</label>
                        <select onchange="localStorage.setItem('jeopardy_gemini_model', this.value); render();" style="width: 100%; padding: 0.75rem; background: var(--bg-color); color: var(--text-main); border: 1px solid var(--panel-border); border-radius: 6px; font-family: Inter; margin-bottom: 1rem;">
                            <option value="gemini-2.5-flash" ${currentModel === 'gemini-2.5-flash' ? 'selected' : ''}>Gemini 2.5 Flash (Standard, schnell)</option>
                            <option value="gemini-2.5-pro" ${currentModel === 'gemini-2.5-pro' ? 'selected' : ''}>Gemini 2.5 Pro (Sehr intelligent)</option>
                            <option value="gemini-1.5-flash" ${currentModel === 'gemini-1.5-flash' ? 'selected' : ''}>Gemini 1.5 Flash (Geringere Auslastung)</option>
                            <option value="gemini-1.5-pro" ${currentModel === 'gemini-1.5-pro' ? 'selected' : ''}>Gemini 1.5 Pro (Alternative)</option>
                        </select>
                    </div>

                    ${hasKey ? `<button class="btn btn-outline w-100" style="border-color: var(--danger); color: var(--danger);" onclick="resetApiKey()">🔑 KI API-Key löschen</button>` : `<button class="btn btn-outline w-100" style="border-color: var(--magic); color: var(--magic);" onclick="document.getElementById('settings-modal').style.display='none'; document.getElementById('api-modal').style.display='flex'">🔑 KI API-Key hinzufügen</button>`}
                    
                    <button class="btn w-100 mt-4" onclick="document.getElementById('settings-modal').style.display='none'">Schließen</button>
                </div>
            </div>
        </div>
    `;
}

window.updateCatName = function(cIdx, val) {
    const round = window.editorRound || 1;
    if (round === 1) {
        activeGame.categories[cIdx].name = val;
    } else {
        if (!activeGame.categoriesRound2) initRound2();
        activeGame.categoriesRound2[cIdx].name = val;
    }
    saveGames();
}

window.updateCatType = function(cIdx, type) {
    const round = window.editorRound || 1;
    let cat = round === 1 ? activeGame.categories[cIdx] : activeGame.categoriesRound2[cIdx];
    if (!cat && round === 2) { initRound2(); cat = activeGame.categoriesRound2[cIdx]; }
    
    cat.type = type;
    if (type === 'minigame') cat.minigameType = 'higher_lower';
    saveGames();
    render();
}

window.updateCatMinigameType = function(cIdx, minigameType) {
    const round = window.editorRound || 1;
    let cat = round === 1 ? activeGame.categories[cIdx] : activeGame.categoriesRound2[cIdx];
    cat.minigameType = minigameType;
    saveGames();
    render();
}

window.updateCatStreak = function(cIdx, len) {
    const round = window.editorRound || 1;
    let cat = round === 1 ? activeGame.categories[cIdx] : activeGame.categoriesRound2[cIdx];
    cat.hlStreakLength = len;
    saveGames();
    render();
}

function initRound2() {
    if (syncGameStructure(activeGame)) {
        saveGames();
    }
}

window.updateQuestion = function(cIdx, qIdx, field, val) {
    const round = window.editorRound || 1;
    if (round === 1) {
        activeGame.categories[cIdx].questions[qIdx][field] = val;
    } else {
        if (!activeGame.categoriesRound2) initRound2();
        activeGame.categoriesRound2[cIdx].questions[qIdx][field] = val;
    }
    saveGames();
}

window.updateStreak = function(cIdx, qIdx, stIdx, field, val) {
    const round = window.editorRound || 1;
    const cat = round === 1 ? activeGame.categories[cIdx] : activeGame.categoriesRound2[cIdx];
    const q = cat.questions[qIdx];
    
    if (!q.hlStreak) q.hlStreak = [];
    if (!q.hlStreak[stIdx]) q.hlStreak[stIdx] = { object: '', solution: '', fact: '' };
    q.hlStreak[stIdx][field] = val;
    saveGames();
}

let pendingCatIdx = null;

window.triggerAIGeneration = function(cIdx) {
    const key = localStorage.getItem('jeopardy_gemini_key');
    if (!key) {
        pendingCatIdx = cIdx;
        document.getElementById('api-modal').style.display = 'flex';
        return;
    }
    generateCategoryWithAI(cIdx, key);
}

window.closeApiModal = function() {
    document.getElementById('api-modal').style.display = 'none';
    pendingCatIdx = null;
}

window.saveApiKey = function() {
    const key = document.getElementById('api-key-input').value.trim();
    if (key) {
        localStorage.setItem('jeopardy_gemini_key', key);
        document.getElementById('api-modal').style.display = 'none';
        if (pendingCatIdx !== null) {
            generateCategoryWithAI(pendingCatIdx, key);
            pendingCatIdx = null;
        }
        render(); // refresh to show the delete button
    }
}

window.resetApiKey = function() {
    if(confirm("Möchtest du deinen API-Schlüssel löschen?")) {
        localStorage.removeItem('jeopardy_gemini_key');
        render();
    }
}

window.exportGame = function() {
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(activeGame));
    const downloadAnchorNode = document.createElement('a');
    downloadAnchorNode.setAttribute("href", dataStr);
    downloadAnchorNode.setAttribute("download", "jeopardy_spiel_" + Date.now() + ".json");
    document.body.appendChild(downloadAnchorNode); // required for firefox
    downloadAnchorNode.click();
    downloadAnchorNode.remove();
}

window.importGame = function(event) {
    const file = event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = function(e) {
        try {
            const importedGame = JSON.parse(e.target.result);
            if (!importedGame.categories || !Array.isArray(importedGame.categories)) {
                throw new Error("Ungültiges Format");
            }
            // Ensure unique ID
            importedGame.id = 'game_' + Date.now();
            syncGameStructure(importedGame);
            games.push(importedGame);
            activeGameId = importedGame.id;
            activeGame = importedGame;
            localStorage.setItem('jeopardy_active_game_v2', activeGameId);
            saveGames();
            alert("Spiel erfolgreich importiert!");
            render();
        } catch (err) {
            alert("Fehler beim Importieren: Die Datei ist kein gültiges Jeopardy-Spiel.");
            console.error(err);
        }
    };
    reader.readAsText(file);
}

async function generateCategoryWithAI(cIdx, apiKey) {
    const round = window.editorRound || 1;
    const cat = round === 1 ? activeGame.categories[cIdx] : activeGame.categoriesRound2[cIdx];
    const catName = cat.name;
    
    if (!catName || catName.startsWith('Kategorie')) {
        alert('Bitte gib der Kategorie zuerst einen aussagekräftigen Namen (z.B. "Geografie" oder "Herr der Ringe").');
        return;
    }

    const difficulty = document.getElementById(`ai-diff-${cIdx}`).value;

    isGenerating = true;
    render();
    document.getElementById(`ai-status-${cIdx}`).style.display = 'block';

    const isMinigame = cat.type === 'minigame';
    const minigameType = cat.minigameType;
    const qCount = activeGame.questionsPerCategory || 5;
    const mult = activeGame.pointMultiplier || 100;
    const streakLen = cat.hlStreakLength || 1;

    let pointsDesc = Array.from({length: qCount}, (_, i) => (i+1)*mult).join(', ');

    let prompt = '';
    if (isMinigame && minigameType === 'higher_lower') {
        if (streakLen > 1) {
            prompt = `Erstelle ${qCount} zusammenhängende "Höher oder Tiefer"-Ketten zum Thema "${catName}". Die Schwierigkeit soll über die ${qCount} Ketten ansteigen (${pointsDesc} Punkte). 
Jede der ${qCount} Ketten startet mit einer Basis-Aussage ("question") und besteht dann aus genau ${streakLen} aufeinander aufbauenden Vergleichen.
Der 1. Vergleich bezieht sich auf den Wert in der Basis-Aussage. Der 2. Vergleich bezieht sich auf den Wert des 1. Vergleichs, usw.

WICHTIG: Die KI darf KEINE FRAGEN formulieren. Es müssen reine Fakten-Aussagen sein.
Format:
- Basis-Aussage: Ein Fakt mit einer Zahl. (z.B. "Der Mount Everest ist 8848m hoch.")
- Vergleichsobjekt: NUR der Name des nächsten Objekts. (z.B. "Mont Blanc")
- Lösung: "Höher" oder "Tiefer" (im Vergleich zum vorherigen Objekt).
- Zusatzfakt: Die genaue Zahl des Vergleichsobjekts. (z.B. "Er ist 4810m hoch.")

Schwierigkeit: "${difficulty}".
Antworte AUSSCHLIESSLICH mit einem JSON-Array im folgenden Format, ohne Markdown: 
[
  {
    "question": "Basis-Aussage mit Zahl", 
    "hlStreak": [
       {"object": "Name von Objekt 1", "solution": "Höher/Tiefer", "fact": "Zahl von Objekt 1"},
       {"object": "Name von Objekt 2", "solution": "Höher/Tiefer", "fact": "Zahl von Objekt 2"}
    ]
  }
]
Achte darauf, dass jedes 'hlStreak' Array genau ${streakLen} Elemente hat!`;
        } else {
            prompt = `Erstelle ${qCount} Fakten-Paare für das Minispiel "Höher oder Tiefer" zum Thema "${catName}". Die Schwierigkeit soll ansteigen (${pointsDesc} Punkte). Schwierigkeit: "${difficulty}". 
WICHTIG: Keine Fragen formulieren!
- question: Basis-Aussage mit Zahl (z.B. "Berlin hat 3,6 Mio Einwohner.")
- object: Vergleichs-Objekt (z.B. "München")
- solution: "Höher" oder "Tiefer"
- fact: Zusatzfakt (z.B. "München hat 1,5 Mio Einwohner.")

Antworte AUSSCHLIESSLICH mit einem JSON-Array, ohne Markdown: 
[{"question": "Basis-Aussage", "hlStreak": [{"object": "Objekt", "solution": "Höher/Tiefer", "fact": "Zahl"}]}]`;
        }
    } else if (isMinigame && minigameType === 'emoji') {
        prompt = `Erstelle genau ${qCount} Rätsel für das Emoji-Minispiel zur Kategorie "${catName}". Die Schwierigkeit soll von leicht bis schwer (${pointsDesc} Punkte) ansteigen. Schwierigkeit: "${difficulty}". 
WICHTIG: 
- "question" darf AUSSCHLIESSLICH aus Emojis bestehen (z.B. "🚢🧊👩‍❤️‍👨🥶🚪"). Verwende keine Buchstaben, Wörter oder Satzzeichen in der "question".
- "answer" ist die dazugehörige Lösung (z.B. "Titanic").
Antworte AUSSCHLIESSLICH mit einem JSON-Array, ohne Markdown: [{"question": "Emojis hier...", "answer": "Die Lösung hier..."}, ...]`;
    } else {
        prompt = `Erstelle genau ${qCount} Jeopardy Fragen für die Kategorie "${catName}". Die Fragen müssen im Schwierigkeitsgrad von leicht bis schwer (${pointsDesc} Punkte) ansteigen. Schwierigkeit: "${difficulty}". Antworte AUSSCHLIESSLICH mit einem JSON-Array, ohne Markdown: [{"question": "Die Frage hier...", "answer": "Die Antwort hier..."}, ...]`;
    }

    try {
        let modelName = localStorage.getItem('jeopardy_gemini_model') || 'gemini-2.5-flash';
        
        let response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{ parts: [{ text: prompt }] }],
                generationConfig: { temperature: 0.7 }
            })
        });

        if (response.status === 404) {
            modelName = 'gemini-1.5-flash';
            localStorage.setItem('jeopardy_gemini_model', modelName);
            response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents: [{ parts: [{ text: prompt }] }],
                    generationConfig: { temperature: 0.7 }
                })
            });
        }

        if (response.status === 503) {
            console.log("Model overloaded (503), trying fallback...");
            const fallbackModel = modelName.includes('2.5') ? 'gemini-1.5-flash' : 'gemini-1.5-pro';
            response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${fallbackModel}:generateContent?key=${apiKey}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents: [{ parts: [{ text: prompt }] }],
                    generationConfig: { temperature: 0.7 }
                })
            });
        }

        if (!response.ok) {
            if (response.status === 503) {
                throw new Error("Die Google KI-Server sind im Moment leider komplett überlastet. Alle Fallback-Modelle sind voll. Bitte versuche es in ein paar Minuten noch einmal.");
            }
            throw new Error(`API Fehler: ${response.status}`);
        }

        const data = await response.json();
        
        if (data.error) {
            throw new Error(data.error.message || 'Ungültige Anfrage');
        }

        let text = data.candidates[0].content.parts[0].text;
        text = text.replace(/```json/g, '').replace(/```/g, '').trim();
        
        const parsed = JSON.parse(text);
        const round = window.editorRound || 1;
        const targetCat = round === 1 ? activeGame.categories[cIdx] : activeGame.categoriesRound2[cIdx];
        const targetList = targetCat.questions;
        
        if (Array.isArray(parsed) && parsed.length >= qCount) {
            for (let i = 0; i < qCount; i++) {
                targetList[i].question = parsed[i].question || '';
                
                if (isMinigame && minigameType === 'higher_lower') {
                    if (parsed[i].hlStreak && Array.isArray(parsed[i].hlStreak)) {
                        targetList[i].hlStreak = parsed[i].hlStreak.map(s => {
                            let sol = s.solution || s.hlSolution || 'Höher';
                            if (!['Höher', 'Tiefer'].includes(sol)) sol = 'Höher';
                            return { object: s.object || '', solution: sol, fact: s.fact || s.hlFact || '' };
                        });
                    }
                } else {
                    targetList[i].answer = parsed[i].answer || '';
                }
            }
            saveGames();
        } else {
            throw new Error('Ungültiges Antwortformat der KI.');
        }

    } catch (e) {
        console.error(e);
        alert('Fehler bei der KI-Generierung: ' + e.message);
        if (e.message.includes('API_KEY_INVALID')) {
            localStorage.removeItem('jeopardy_gemini_key');
        }
    } finally {
        isGenerating = false;
        render();
    }
}

// Initial Render
render();
