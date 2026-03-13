function cardToSvg(code) {
    if (!code || code === 'None' || code === '—') return null;
    const key = String(code).trim();
    return CARD_SVGS[key] || null;
}

function makeCardImg(code, w, h) {
    const uri = cardToSvg(code);
    const img = document.createElement('img');
    if (uri) {
        img.src = uri;
        img.style.width = w + 'px';
        img.style.height = h + 'px';
        img.style.display = 'block';
        img.style.borderRadius = '5px';
        img.style.boxShadow = '1px 2px 6px rgba(0,0,0,0.5)';
    } else {
        img.alt = code;
        img.style.display = 'none';
    }
    return img;
}

const WS_URL = 'ws://' + location.hostname + ':8000';

let ws         = null;
let playerId   = null;
let playerName = null;
let roomId     = null;
let isAdmin    = false;
let pollInterval = null;
let inGame     = false;
let lastHandState = "";

// ── BG decoration ──────────────────────────────────
(function() {
    const c = document.getElementById('bgCards');
    for (let i = 0; i < 8; i++) {
        const el = document.createElement('div');
        el.className = 'bg-card';
        el.style.cssText = `
                left: ${Math.random()*100}%;
                --rot: ${(Math.random()-0.5)*40}deg;
                animation-duration: ${10+Math.random()*15}s;
                animation-delay: ${Math.random()*15}s;
            `;
        c.appendChild(el);
    }
})();

// ── Toast ───────────────────────────────────────────
let toastTimer = null;
function showToast(msg, type='error', duration=4000) {
    const el = document.getElementById('toast');
    el.textContent = msg;
    el.className = `show ${type}`;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.className = ''; }, duration);
}
const showError = msg => showToast(msg, 'error', 3500);
const showInfo  = msg => showToast(msg, 'info',  6000);

// ── Screen ──────────────────────────────────────────
function showScreen(id) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    document.getElementById('screen-' + id).classList.add('active');
}

function setStatus(msg, connected=false, error=false) {
    document.getElementById('status-msg').textContent = msg;
    document.getElementById('ws-dot').className =
        connected ? 'connected' : (error ? 'error' : '');
}

// ── Admin-left ──────────────────────────────────────
function handleAdminLeft(raw) {
    const colonIdx = raw.lastIndexOf(':');
    const adminName = colonIdx !== -1 ? raw.slice(colonIdx + 1).trim() : 'the admin';
    stopPolling();
    inGame = false;
    roomId = null; isAdmin = false;
    showScreen('lobby');
    showInfo(`👑 Admin "${adminName}" left — the room has closed.`);
}

// ── WebSocket ───────────────────────────────────────
function wsConnect(url) {
    return new Promise((resolve, reject) => {
        ws = new WebSocket(url);
        ws.onopen  = () => { setStatus('Connected', true); resolve(); };
        ws.onerror = () => { setStatus('Connection error', false, true); reject(new Error('WS error')); };
        ws.onclose = () => { setStatus('Disconnected', false); };
        ws.onmessage = (event) => {
            const raw = event.data;
            if (raw.startsWith('i,place_card,')) {
                const resp = parseResponse(raw);
                handlePlaceOfCard(resp.parts)
            }

            if (raw.startsWith('i,room_info,')) {
                const resp = parseResponse(raw);
                handleRoomInfoResponse(resp.parts)
            }

            if (raw.startsWith('a,leave_room,')){
                leaveRoom()
            }

            if (raw.startsWith('i,game_win')){
                showWinMessage(raw.split(",")[2])
            }

            if (raw.startsWith('i,uno_protection')){
                showProtectionMessage(raw.split(",")[2])
            }

            if (raw.startsWith('i,uno_punish')){
                showPunishMessage(raw.split(",")[3], raw.split(",")[2])
            }

            if (raw.startsWith('i,uno_false')){
                showError(raw.split(",")[2]);
            }
        };
    });
}

function wsSend(message) {
    return new Promise((resolve, reject) => {
        if (!ws || ws.readyState !== WebSocket.OPEN) {
            reject(new Error('Not connected'));
            return;
        }
        const handler = (event) => {
            const raw = event.data;
            if (/^i,Admin left/i.test(raw)) {
                handleAdminLeft(raw);
                ws.removeEventListener('message', handler);
                return;
            }
            ws.removeEventListener('message', handler);
            resolve(raw);
        };
        ws.addEventListener('message', handler);
        ws.send(message);
    });
}

function parseResponse(raw) {
    const parts = raw.split(',');
    return { status: parts[0], parts: parts.slice(2) };
}

// ── Actions ─────────────────────────────────────────
async function enterTable() {
    const nameVal = document.getElementById('name-input').value.trim();
    if (!nameVal) { showError('Please enter your name'); return; }
    localStorage.setItem("username", nameVal);

    setStatus('Connecting...');
    try { await wsConnect(WS_URL); }
    catch(e) { showError('Could not connect to server'); return; }

    setStatus('Creating player...');
    try {
        const raw = await wsSend(`create_player,${nameVal}`);
        const resp = parseResponse(raw);
        if (resp.status === 'a') {
            playerId   = resp.parts[0];
            playerName = nameVal;
            document.getElementById('lobby-name').textContent = playerName;
            setStatus(`Connected as ${playerName}`);
            showScreen('lobby');
        } else {
            showError(resp.parts[0] || 'Failed to create player');
            setStatus('Error', false, true);
        }
    } catch(e) { showError('No response from server' + e.toString()); }
}

async function createRoom() {
    try {
        const raw = await wsSend(`create_room,${playerId}`);
        const resp = parseResponse(raw);
        if (resp.status === 'a') {
            roomId = resp.parts[0];
            isAdmin = true;
            enterRoomScreen();
            startPolling();
        } else {
            showError(resp.parts[0] || 'Failed to create room');
        }
    } catch(e) { showError('Failed to create room'); }
}

async function joinRoom() {
    const rid = document.getElementById('join-room-input').value.trim();
    if (!rid) { showError('Enter a room ID'); return; }
    try {
        const raw = await wsSend(`join_room,${playerId},${rid}`);
        const resp = parseResponse(raw);
        if (resp.status === 'a') {
            roomId  = resp.parts[0];
            isAdmin = false;
            enterRoomScreen();
            startPolling();
        } else {
            showError(resp.parts[0] || 'Failed to join room');
        }
    } catch(e) { showError('Failed to join room'); }
}

async function leaveRoom() {
    stopPolling();
    try { await wsSend(`leave_room,${playerId}`); } catch(e) {}
    roomId = null; isAdmin = false; inGame = false;
    showScreen('lobby');
}

async function startGame() {
    try {
        const raw = await wsSend(`start_game,${playerId}`);
        const resp = parseResponse(raw);
        if (resp.status !== 'a') showError(resp.parts[0] || 'Could not start game');
    } catch(e) { showError('Could not start game'); }
}

async function takeCard() {
    try {
        const raw  = await wsSend(`take_card,${playerId}`);
        const resp = parseResponse(raw);
        if (resp.status === 'a' || resp.status === 'i') {
            handleRoomInfoResponse(resp.parts);
        } else {
            showError(resp.parts[0] || 'Could not draw card');
        }
    } catch(e) { showError('Could not draw card'); }
}

let colorResolveFunc = null;

function pickColor() {
    const modal = document.getElementById('color-picker-modal');
    modal.style.display = 'flex';

    return new Promise((resolve) => {
        colorResolveFunc = resolve;

        document.getElementById('close-picker').onclick = () => {
            modal.style.display = 'none';
            resolve(null);
        };
    });
}

function selectColor(colorId) {
    document.getElementById('color-picker-modal').style.display = 'none';
    if (colorResolveFunc) colorResolveFunc(colorId);
}

async function placeCard(card) {
    let newColor = "-1";

    if (card[0] === "2") {
        const chosenColor = await pickColor();

        if (chosenColor === null) {
            return;
        }
        newColor = chosenColor.toString();
    }

    try {
        const raw  = await wsSend(`place_card,${playerId},${card},${newColor}`);
        const resp = parseResponse(raw);
        if (resp.status === 'a' || resp.status === 'i') {
            handleRoomInfoResponse(resp.parts);
        } else {
            showError(resp.parts[0] || 'Cannot place that card');
        }
    } catch(e) {
        showError('Could not place card');
    }
}


// ── Skip Move ────────────────────────────────────────
async function skipMove() {
    try {
        const raw  = await wsSend(`skip_move,${playerId}`);
        const resp = parseResponse(raw);
        if (resp.status === 'a' || resp.status === 'i') {
            handleRoomInfoResponse(resp.parts);
        } else {
            showError(resp.parts[0] || 'Cannot skip move');
        }
    } catch(e) { showError('Could not skip move'); }
}

async function uno() {
    try {
        const raw  = await wsSend(`uno_press,${playerId}`);
        const resp = parseResponse(raw);
        if (resp.status === 'a' || resp.status === 'i') {
            handleRoomInfoResponse(resp.parts);
        } else {
            showError(resp.parts[0] || 'Cannot say UNO');
        }
    } catch(e) { showError('Could not say UNO'); }
}

// Shared handler for any room_info response
function handleRoomInfoResponse(parts) {
    const [roommates, owner, gameStarted, currentCard, playerTurn, cardsLeft, currentColor] = parts;
    const { players, myCards } = parseRoommates(roommates);

    const deckCountEl = document.getElementById('deck-count');
    if (deckCountEl && cardsLeft && cardsLeft !== 'None') {
        deckCountEl.textContent = cardsLeft;
    }

    const gameActive = gameStarted && gameStarted !== 'None' && gameStarted !== 'False';

    if (gameActive && !inGame) {
        inGame = true;
        showScreen('game');
    }

    if (gameActive) {
        renderGameScreen(players, currentCard, playerTurn, cardsLeft, currentColor);
        return;
    }

    inGame = false;

    const list = document.getElementById('roommates-list');
    if (players.length > 0) {
        list.innerHTML = players.map(p => {
            const count    = p.cards.length;
            const isFew    = count <= 2 && count > 0;
            const badgeCls = 'card-count' + (isFew ? ' few' : '');
            const isOwner  = p.name === owner;
            const crown    = isOwner ? '<span class="roommate-crown">♛</span>' : '<span style="width:18px;display:inline-block;"></span>';
            const youLabel = p.isMe ? '<span style="color:var(--muted);font-size:11px;">(you)</span>' : '';
            const cardBadge = count > 0 ? `<span class="${badgeCls}">${count} card${count !== 1 ? 's' : ''}</span>` : '';
            return `<div class="roommate-row">${crown}<span>${p.name}</span>${youLabel}${cardBadge}</div>`;
        }).join('');
    }

    const handSection = document.getElementById('hand-section');
    const handCards   = document.getElementById('hand-cards');
    if (myCards.length > 0) {
        handSection.style.display = 'block';
        handCards.innerHTML = '';
        myCards.forEach(c => {
            const uri = cardToSvg(c);
            if (uri) {
                const img = document.createElement('img');
                img.src = uri;
                img.style.width = '40px';
                img.style.height = '60px';
                img.style.borderRadius = '4px';
                img.style.boxShadow = '1px 2px 6px rgba(0,0,0,0.4)';
                handCards.appendChild(img);
            } else {
                const span = document.createElement('span');
                span.className = 'hand-card';
                span.textContent = c;
                handCards.appendChild(span);
            }
        });
    } else {
        handSection.style.display = 'none';
        handCards.innerHTML = '';
    }

    if (owner && owner !== 'None') {
        isAdmin = (owner === playerName);
        document.getElementById('start-btn-container').style.display = isAdmin ? 'block' : 'none';
    }
}

// ── Room screen ──────────────────────────────────────
function enterRoomScreen() {
    document.getElementById('room-player-name').textContent = playerName;
    document.getElementById('room-id-display').textContent  = `Room: ${roomId}`;
    document.getElementById('start-btn-container').style.display = isAdmin ? 'block' : 'none';
    showScreen('room');
}

function startPolling() { pollRoomInfo(); pollInterval = setInterval(pollRoomInfo, 2000); }
function stopPolling()  { clearInterval(pollInterval); pollInterval = null; }

// ── Parse roommates string ───────────────────────────
function parseRoommates(str) {
    const entries = (str || '').split('|').filter(Boolean);
    const players = [];
    let myCards   = [];

    for (const entry of entries) {
        const hi   = entry.indexOf('#');
        const name = hi !== -1 ? entry.slice(0, hi) : entry;
        const rest = hi !== -1 ? entry.slice(hi + 1) : '';

        if (rest.length === 0 || rest.length >= 3) {
            myCards = rest ? rest.split('.').filter(Boolean) : [];
            players.push({ name: playerName, isMe: true, cards: myCards });
        } else {
            const count = parseInt(rest) || 0;
            players.push({ name, isMe: false, cards: Array(count).fill(null) });
        }
    }
    return { players, myCards };
}

// ── Game screen renderer ─────────────────────────────
function renderGameScreen(players, currentCard, turnPlayerNumber, cardsLeft, currentColor) {
    const me        = players.find(p => p.isMe);
    const meIndex   = players.findIndex(p => p.isMe);
    let opponents = [];

    const numberColors = {
        "0": "radial-gradient(rgb(12 7 7) 0%, rgb(88 17 17) 60%, rgb(18, 7, 7) 100%)",
        "1": "radial-gradient(rgb(11 17 12) 0%, rgb(25 87 53) 60%, rgb(7, 16, 13) 100%)",
        "2": "radial-gradient(rgb(17 39 64) 0%, rgb(24 53 81) 60%, rgb(33 46 63) 100%)",
        "3": "radial-gradient(rgb(24 22 15) 0%, rgb(84 65 16) 60%, rgb(18, 15, 5) 100%)",
    }

    const element = document.getElementById("game-table");
    if (element) {
        element.style.background = numberColors[currentColor];
    }

    if (meIndex > 0 && meIndex < players.length - 1) {
        for (let i = meIndex + 1; i < players.length; i++) opponents.push(players[i]);
        for (let i = 0; i < meIndex; i++) opponents.push(players[i]);
    } else {
        opponents = players.filter(p => !p.isMe);
    }

    const turnIdx  = (parseInt(turnPlayerNumber) || 0);
    const turnName = players[turnIdx] ? players[turnIdx].name : null;
    const isMyTurn = turnName === playerName;

    const deckCountEl = document.getElementById('deck-count');
    if (deckCountEl && cardsLeft && cardsLeft !== 'None') {
        deckCountEl.textContent = cardsLeft;
    }

    // Current card + turn
    const ccEl = document.getElementById('current-card-game');
    ccEl.innerHTML = '';
    if (currentCard && currentCard !== 'None') {
        const uri = cardToSvg(currentCard);
        if (uri) {
            const img = makeCardImg(currentCard, 72, 108);
            img.style.boxShadow = '0 4px 20px rgba(0,0,0,0.6)';
            ccEl.appendChild(img);
        } else {
            ccEl.textContent = currentCard;
        }
    } else {
        ccEl.textContent = '—';
    }
    document.getElementById('turn-name').textContent = turnName || '—';

    // My name
    document.getElementById('player-name-game').textContent = playerName || '—';

    // ── Show Skip Move button & style based on turn ──
    const skipBtn  = document.getElementById('skip-move-btn');
    const skipCard = document.getElementById('skip-card');
    skipBtn.style.display = 'flex';
    if (isMyTurn) {
        skipCard.classList.add('my-turn');
    } else {
        skipCard.classList.remove('my-turn');
    }

    const unoBtn  = document.getElementById('uno-btn');
    unoBtn.style.display = 'flex';

    // Opponents
    const row = document.getElementById('opponents-row');
    row.innerHTML = '';
    for (const opp of opponents) {
        const isTurn = opp.name === turnName;
        const div    = document.createElement('div');
        div.className = 'opponent';

        const nameEl = document.createElement('div');
        nameEl.className = 'opponent-name' + (isTurn ? ' is-turn' : '');
        nameEl.textContent = opp.name + (isTurn ? ' ⬡' : '');

        div.appendChild(nameEl);
        div.appendChild(buildOppHand(opp.cards.length));
        row.appendChild(div);
    }

    const currentHandState = JSON.stringify(me ? me.cards : []);

    if (currentHandState === lastHandState) {
        return;
    }

    lastHandState = currentHandState;

    // My hand
    const handEl = document.getElementById('player-hand-game');
    handEl.innerHTML = '';
    layoutMyHand(handEl, me ? me.cards : []);
}

function showWinMessage(winnerName) {
    const modal = document.getElementById('win-modal');
    const nameDisplay = document.getElementById('winner-name-display');

    // Вставляем имя
    nameDisplay.textContent = winnerName;

    // Показываем окно
    modal.style.display = 'flex';
}

function handlePlaceOfCard(parts) {
    const { players } = parseRoommates(parts[0]);
    const meIndex = players.findIndex(p => p.isMe);
    const playerOrder = parseInt(parts[1]);
    const card = parts[2];

    // 1. Determine if this is a "Draw" action (-1) or a "Play" action
    const isDrawing = card === -1 || card === "-1";

    // 2. Identify UI elements
    const deckEl = document.getElementById('deck-card');           // From index.html
    const tableEl = document.getElementById('current-card-game'); // From index.html
    const playerHandEl = document.getElementById('player-hand-game');
    const opponents = document.querySelectorAll('#opponents-row .opponent');

    // 3. Find the Player's element (Hand if 'me', Card/Avatar if opponent)
    let playerEl = null;
    if (players[playerOrder].isMe) {
        playerEl = playerHandEl;
    } else {
        let coefficient = (meIndex !== -1 && meIndex < playerOrder) ? -1 : 0;
        const opp = opponents[playerOrder + coefficient];
        playerEl = opp ? (opp.querySelector('.opp-card') || opp) : null;
    }

    // 4. Set Source and Target based on the action
    // If drawing: Deck -> Player. If playing: Player -> Table.
    let sourceEl = isDrawing ? deckEl : playerEl;
    let targetEl = isDrawing ? playerEl : tableEl;

    if (!sourceEl || !targetEl) return;

    // 5. Build the flying card
    const flying = document.createElement('div');
    flying.style.cssText = `
        position: fixed;
        z-index: 999;
        pointer-events: none;
        width: 52px;
        height: 78px;
        border-radius: 6px;
        box-shadow: 0 8px 32px rgba(0,0,0,0.7);
        transition: transform 0.45s cubic-bezier(0.25, 0.46, 0.45, 0.94),
                    left 0.45s cubic-bezier(0.25, 0.46, 0.45, 0.94),
                    top 0.45s cubic-bezier(0.25, 0.46, 0.45, 0.94),
                    opacity 0.45s ease;
    `;

    if (isDrawing) {
        // Face-down styling: Dark green gradient and diamond symbol
        flying.style.background = 'linear-gradient(135deg, #1a2a35 0%, #152142 50%, #091242 100%)';
        flying.style.border = '1.5px solid #2a4030';

        const symbol = document.createElement('div');
        symbol.style.cssText = 'width:100%; height:100%; display:flex; align-items:center; justify-content:center; color:rgba(201,168,76,0.25); font-size:12px;';
        symbol.textContent = '◆';
        flying.appendChild(symbol);
    } else {
        const svgUri = cardToSvg(card);
        if (svgUri) {
            const img = document.createElement('img');
            img.src = svgUri;
            img.style.cssText = 'width:100%;height:100%;display:block;border-radius:6px;';
            img.draggable = false;
            flying.appendChild(img);
        } else {
            flying.style.background = '#1a1510';
            flying.style.border = '1px solid var(--gold)';
            flying.style.color = 'var(--gold)';
            flying.style.display = 'flex';
            flying.style.alignItems = 'center';
            flying.style.justifyContent = 'center';
            flying.style.fontSize = '11px';
            flying.textContent = card;
        }
    }

    // 6. Animation: Get Start Position (Source Center)
    const srcRect = sourceEl.getBoundingClientRect();
    const startX  = srcRect.left + srcRect.width  / 2 - 26;
    const startY  = srcRect.top  + srcRect.height / 2 - 39;

    flying.style.left = startX + 'px';
    flying.style.top  = startY + 'px';
    document.body.appendChild(flying);

    // 7. Animation: Get End Position (Target Center)
    const tgtRect = targetEl.getBoundingClientRect();
    const endX    = tgtRect.left + tgtRect.width  / 2 - 26;
    const endY    = tgtRect.top  + tgtRect.height / 2 - 39;

    // Force reflow
    flying.getBoundingClientRect();

    flying.style.left      = endX + 'px';
    flying.style.top       = endY + 'px';

    // Apply rotation (different directions for draw vs play for visual variety)
    const rot = isDrawing ? -12 : 8;
    flying.style.transform = `rotate(${rot}deg) scale(1.05)`;

    flying.addEventListener('transitionend', () => {
        flying.style.opacity   = '0';
        flying.style.transform = `rotate(${rot}deg) scale(0.85)`;
        setTimeout(() => flying.remove(), 200);
    }, { once: true });
}

function resetToLobby() {
    // 1. Прячем окно победы
    document.getElementById('win-modal').style.display = 'none';
    enterRoomScreen()
}

function buildOppHand(count) {
    const wrap = document.createElement('div');
    wrap.className = 'opp-hand';

    const n        = Math.max(1, count);
    const maxAngle = Math.min(40, n * 6);
    const overlap  = Math.min(22, 180 / n);

    for (let i = 0; i < n; i++) {
        const card = document.createElement('div');
        card.className = 'opp-card';
        const t = n === 1 ? 0 : (i / (n - 1) - 0.5);
        card.style.transform = `translateX(${t * overlap * (n-1) * 0.5}px) rotate(${t * maxAngle}deg)`;
        card.style.zIndex    = i;
        wrap.appendChild(card);
    }

    wrap.style.width = Math.min(n * 8 + 60, 160) + 'px';
    return wrap;
}

function layoutMyHand(container, cards) {
    const n = cards.length;
    if (n === 0) {
        container.innerHTML = '<span style="color:var(--muted);font-style:italic;font-size:13px;">No cards</span>';
        return;
    }

    const containerW = container.offsetWidth || window.innerWidth;
    const cardW      = Math.min(58, Math.max(34, (containerW * 0.7) / n));
    const cardH      = cardW * 1.5;
    const maxSpread  = containerW * 0.88;
    const step       = Math.min(cardW + 4, maxSpread / Math.max(n - 1, 1));
    const startX     = (containerW - step * (n-1)) / 2 - cardW / 2;
    const maxAng     = Math.min(20, n * 2.5);

    container.style.height = (cardH + 20) + 'px';

    for (let i = 0; i < n; i++) {
        const card = document.createElement('div');
        card.className = 'my-card';
        const svgUri = cardToSvg(cards[i]);
        if (svgUri) {
            const img = document.createElement('img');
            img.src = svgUri;
            img.style.width = '100%';
            img.style.height = '100%';
            img.style.display = 'block';
            img.style.borderRadius = '4px';
            img.draggable = false;
            card.appendChild(img);
        } else {
            card.textContent = cards[i] || '';
        }

        const t   = n === 1 ? 0 : (i / (n - 1) - 0.5);
        const ang = t * maxAng;

        card.style.width    = cardW + 'px';
        card.style.height   = cardH + 'px';
        card.style.left     = (startX + i * step) + 'px';
        card.style.bottom   = Math.abs(t) * 12 + 'px';
        card.style.transform = `rotate(${ang}deg)`;
        card.style.zIndex   = i;
        card.style.fontSize = Math.max(9, cardW * 0.22) + 'px';
        card.style.setProperty('--card-rot', ang + 'deg');

        const cardValue = cards[i];
        card.addEventListener('click', () => placeCard(cardValue));
        container.appendChild(card);
    }
}

/**
 * Shows a pop-up when a player safely calls UNO.
 * @param {string} player - The name of the player.
 */
function showProtectionMessage(player) {
    const msg = `${player} has UNO`;
    createAnnouncement(msg, 'protection');
}

function showPunishMessage(punisher, punished) {
    const msg = `${punisher} UNO's ${punished} and gives him 2 cards`;
    createAnnouncement(msg, 'punish');
}

function createAnnouncement(text, type) {
    const div = document.createElement('div');
    div.className = `game-announcement ${type}`;
    div.textContent = text;

    document.body.appendChild(div);

    // After 3 seconds, start the exit animation
    setTimeout(() => {
        div.classList.add('announcement-exit');
        // Remove from DOM after animation finishes
        setTimeout(() => div.remove(), 500);
    }, 3000);
}

// ── Poll room info ───────────────────────────────────
async function pollRoomInfo() {
    if (!playerId) return;
    try {
        const raw  = await wsSend(`room_info,${playerId}`);
        const resp = parseResponse(raw);
        if (resp.status !== 'a' && resp.status !== 'i') return;

        const [roommates, owner, gameStarted, currentCard, playerTurn, cardsLeft, currentColor] = resp.parts;
        const deckCountEl = document.getElementById('deck-count');
        if (deckCountEl && cardsLeft && cardsLeft !== 'None') deckCountEl.textContent = cardsLeft;

        const { players, myCards } = parseRoommates(roommates);
        const gameActive = gameStarted && gameStarted !== 'None' && gameStarted !== 'False';

        if (gameActive && !inGame) { inGame = true; showScreen('game'); }

        if (gameActive) { renderGameScreen(players, currentCard, playerTurn, cardsLeft, currentColor); return; }

        inGame = false;

        const list = document.getElementById('roommates-list');
        if (players.length > 0) {
            list.innerHTML = players.map(p => {
                const count    = p.cards.length;
                const badgeCls = 'card-count' + (count <= 2 && count > 0 ? ' few' : '');
                const crown    = p.name === owner ? '<span class="roommate-crown">♛</span>' : '<span style="width:18px;display:inline-block;"></span>';
                const youLabel = p.isMe ? '<span style="color:var(--muted);font-size:11px;">(you)</span>' : '';
                const badge    = count > 0 ? `<span class="${badgeCls}">${count} card${count!==1?'s':''}</span>` : '';
                return `<div class="roommate-row">${crown}<span>${p.name}</span>${youLabel}${badge}</div>`;
            }).join('');
        }

        const handSection = document.getElementById('hand-section');
        const handCards   = document.getElementById('hand-cards');
        if (myCards.length > 0) {
            handSection.style.display = 'block';
            handCards.innerHTML = '';
            myCards.forEach(c => {
                const uri = cardToSvg(c);
                if (uri) {
                    const img = document.createElement('img');
                    img.src = uri;
                    img.style.width = '40px';
                    img.style.height = '60px';
                    img.style.borderRadius = '4px';
                    img.style.boxShadow = '1px 2px 6px rgba(0,0,0,0.4)';
                    handCards.appendChild(img);
                } else {
                    const span = document.createElement('span');
                    span.className = 'hand-card';
                    span.textContent = c;
                    handCards.appendChild(span);
                }
            });
        } else {
            handSection.style.display = 'none';
            handCards.innerHTML = '';
        }

        if (owner && owner !== 'None') {
            isAdmin = (owner === playerName);
            document.getElementById('start-btn-container').style.display = isAdmin ? 'block' : 'none';
        }

    } catch(e) { /* ignore poll errors */ }
}

// ── Keyboard shortcuts ───────────────────────────────
document.getElementById('name-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') enterTable();
});
document.getElementById('join-room-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') joinRoom();
});

document.addEventListener('DOMContentLoaded', () => {
    const savedName = localStorage.getItem('username');
    if (savedName) {
        document.getElementById('name-input').value = savedName;
    }
});