// --- START OF FILE client/js/main.js (OPRAVENÁ VERZE) ---
import { network } from './network.js';
import { game } from './game.js';

const mainMenuSection = document.getElementById('main-menu-section');
const lobbySection = document.getElementById('lobby-section');
const gameSection = document.getElementById('game-section');
const playerNameInput = document.getElementById('playerNameInput');
const soloGameBtn = document.getElementById('soloGameBtn');
const findGameBtn = document.getElementById('findGameBtn');
const createGameBtn = document.getElementById('createGameBtn');
const joinCodeInput = document.getElementById('joinCodeInput');
const joinGameBtn = document.getElementById('joinGameBtn');
const lobbyGameCode = document.getElementById('lobby-game-code');
const playerList = document.getElementById('playerList');
const startGameBtn = document.getElementById('startGameBtn');
const waitingMessage = document.getElementById('waiting-message');

let myId = null;
let currentLobbyState = {};

const showScreen = (screenName) => {
    mainMenuSection.style.display = 'none';
    lobbySection.style.display = 'none';
    gameSection.style.display = 'none';
    document.getElementById(`${screenName}-section`).style.display = 'flex';
};

const updateLobbyView = (data) => {
    currentLobbyState = data;
    lobbyGameCode.textContent = data.gameCode;
    
    // NOVINKA: Vykreslení seznamu hráčů s kick tlačítky pro hosta
    playerList.innerHTML = data.players.map(p => {
        let kickButtonHtml = '';
        // Pokud jsem host a dívám se na jiného hráče, zobrazím kick button
        if (myId === data.hostId && p.id !== myId) {
            kickButtonHtml = `<button class="kick-btn" data-kick-id="${p.id}">Vyhodit</button>`;
        }
        return `<li class="${p.id === data.hostId ? 'host' : ''}">
                    <span>${p.name} ${p.id === data.hostId ? '(Host)' : ''}</span>
                    ${kickButtonHtml}
                </li>`;
    }).join('');

    if (myId === data.hostId) {
        startGameBtn.style.display = 'block';
        waitingMessage.textContent = `Hra je připravena pro ${data.players.length} hráče. Můžeš spustit válku.`;
    } else {
        startGameBtn.style.display = 'none';
        waitingMessage.textContent = 'Čekání na hosta, aby spustil hru...';
    }
    showScreen('lobby');
};

// NOVINKA: Logika pro jméno (cachování, náhodné jméno)
const preparePlayerName = () => {
    let name = playerNameInput.value.trim();
    if (!name) {
        // Pokud je jméno prázdné, vygeneruj náhodné
        name = `Rytíř${Math.floor(Math.random() * 900 + 100)}`;
        playerNameInput.value = name;
    }
    // Ulož jméno do localStorage pro příští návštěvu
    localStorage.setItem('avalonPlayerName', name);
    network.sendPlayerName(name);
};

// NOVINKA: Logika tlačítek přesně podle požadavků
soloGameBtn.addEventListener('click', () => {
    preparePlayerName();
    // Vytvoří sólo hru, která se rovnou spustí (logika na serveru)
    network.sendCreateLobby({ isPrivate: true, isSolo: true });
});

findGameBtn.addEventListener('click', () => {
    preparePlayerName();
    // Najde veřejné lobby, nebo vytvoří nové, pokud žádné není
    network.sendFindPublicLobby();
});

createGameBtn.addEventListener('click', () => {
    preparePlayerName();
    // Vytvoří nové VEŘEJNÉ lobby, aby ho "Najít hru" našlo
    network.sendCreateLobby({ isPrivate: false, isSolo: false });
});

joinGameBtn.addEventListener('click', () => {
    const code = joinCodeInput.value.trim().toUpperCase();
    if (code) {
        preparePlayerName();
        network.sendJoinLobby(code);
    }
});

startGameBtn.addEventListener('click', () => {
    if (currentLobbyState.gameCode) {
        network.sendStartGame(currentLobbyState.gameCode);
    }
});

// NOVINKA: Listener pro kliknutí na kick button
playerList.addEventListener('click', (e) => {
    if (e.target.classList.contains('kick-btn')) {
        const playerIdToKick = e.target.dataset.kickId;
        if (playerIdToKick) {
            network.sendKickPlayer(playerIdToKick);
        }
    }
});

// Registrace síťových callbacků
network.on('onConnect', (id) => {
    myId = id;
    // NOVINKA: Načtení jména z cache po připojení
    const cachedName = localStorage.getItem('avalonPlayerName');
    if (cachedName) {
        playerNameInput.value = cachedName;
    }
    showScreen('main-menu');
});
network.on('onLobbyUpdate', updateLobbyView);
network.on('onGameStart', (initialPacket) => {
    showScreen('game');
    game.initialize(initialPacket, myId);
});
network.on('onGameUpdate', game.handleStateUpdate);
network.on('onGameOver', ({ reason }) => {
    game.shutdown();
    alert(`Konec hry! ${reason}`);
    location.reload();
});
// NOVINKA: Co dělat, když mě někdo vyhodí
network.on('onKicked', ({ reason }) => {
    alert(reason);
    showScreen('main-menu');
});

showScreen('main-menu');
// --- END OF FILE client/js/main.js ---
