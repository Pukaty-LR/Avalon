// --- START OF FILE client/js/main.js ---

// Importujeme naše moduly. Díky 'type="module"' v HTML to funguje.
import { network } from './network.js';
import { game } from './game.js';

// --- ELEMENTY DOM ---
// Všechny elementy, se kterými budeme manipulovat, si načteme na začátku.

// Obrazovky
const mainMenuSection = document.getElementById('main-menu-section');
const lobbySection = document.getElementById('lobby-section');
const gameSection = document.getElementById('game-section');

// Vstupy a tlačítka v menu
const playerNameInput = document.getElementById('playerNameInput');
const soloGameBtn = document.getElementById('soloGameBtn');
const findGameBtn = document.getElementById('findGameBtn');
const createGameBtn = document.getElementById('createGameBtn');
const joinCodeInput = document.getElementById('joinCodeInput');
const joinGameBtn = document.getElementById('joinGameBtn');

// Elementy v lobby
const lobbyGameCode = document.getElementById('lobby-game-code');
const playerList = document.getElementById('playerList');
const startGameBtn = document.getElementById('startGameBtn');
const waitingMessage = document.getElementById('waiting-message');

// --- GLOBÁLNÍ STAV KLIENTA ---
let myId = null;
let currentLobbyState = {};

// --- FUNKCE PRO SPRÁVU UI ---

/**
 * Zobrazí specifikovanou obrazovku a skryje ostatní.
 * @param {'main-menu' | 'lobby' | 'game'} screenName - Název obrazovky k zobrazení.
 */
const showScreen = (screenName) => {
    mainMenuSection.style.display = 'none';
    lobbySection.style.display = 'none';
    gameSection.style.display = 'none';

    document.getElementById(`${screenName}-section`).style.display = 'flex';
};

/**
 * Aktualizuje zobrazení lobby na základě dat ze serveru.
 * @param {object} data - Data o lobby (gameCode, players, hostId).
 */
const updateLobbyView = (data) => {
    currentLobbyState = data;
    lobbyGameCode.textContent = data.gameCode;
    playerList.innerHTML = data.players.map(p => 
        `<li class="${p.id === data.hostId ? 'host' : ''}">${p.name} ${p.id === data.hostId ? '(Host)' : ''}</li>`
    ).join('');

    if (myId === data.hostId) {
        startGameBtn.style.display = 'block';
        waitingMessage.textContent = `Hra je připravena pro ${data.players.length} hráče. Můžeš spustit válku.`;
    } else {
        startGameBtn.style.display = 'none';
        waitingMessage.textContent = 'Čekání na hosta, aby spustil hru...';
    }
    showScreen('lobby');
};

// --- PŘIPOJENÍ EVENT LISTENERŮ ---

const preActionNameSet = () => {
    if (playerNameInput.value.trim()) {
        network.sendPlayerName(playerNameInput.value);
    }
};

soloGameBtn.addEventListener('click', () => {
    preActionNameSet();
    network.sendCreateLobby({ isPrivate: true, isSolo: true });
});

findGameBtn.addEventListener('click', () => {
    preActionNameSet();
    network.sendFindPublicLobby();
});

createGameBtn.addEventListener('click', () => {
    preActionNameSet();
    network.sendCreateLobby({ isPrivate: true, isSolo: false });
});

joinGameBtn.addEventListener('click', () => {
    const code = joinCodeInput.value.trim().toUpperCase();
    if (code) {
        preActionNameSet();
        network.sendJoinLobby(code);
    }
});

startGameBtn.addEventListener('click', () => {
    if (currentLobbyState.gameCode) {
        network.sendStartGame(currentLobbyState.gameCode);
    }
});

// --- REGISTRACE CALLBACKŮ PRO SÍŤOVOU KOMUNIKACI ---
// Říkáme modulu 'network', co má dělat, když přijdou data.

network.on('onConnect', (id) => {
    myId = id;
    showScreen('main-menu');
});

network.on('onLobbyUpdate', (data) => {
    updateLobbyView(data);
});

network.on('onGameStart', (initialPacket) => {
    showScreen('game');
    // Předáváme řízení modulu 'game', který se postará o zbytek.
    game.initialize(initialPacket, myId);
});

network.on('onGameUpdate', (update) => {
    // Příchozí aktualizace stavu hry předáváme přímo hernímu modulu.
    game.handleStateUpdate(update);
});

network.on('onGameOver', ({ reason }) => {
    // Modul 'game' ukončí svou smyčku a my zobrazíme zprávu.
    game.shutdown();
    alert(`Konec hry! ${reason}`);
    location.reload();
});


// --- INICIALIZACE APLIKACE ---
// Zobrazíme úvodní obrazovku.
showScreen('main-menu');
console.log("Client application main.js initialized.");

// --- END OF FILE client/js/main.js ---
