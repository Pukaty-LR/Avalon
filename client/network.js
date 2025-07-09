// --- START OF FILE client/js/network.js ---

// Tento modul se stará výhradně o komunikaci se serverem.
// Neobsahuje žádnou herní ani renderovací logiku.

// Inicializace spojení se serverem.
const socket = io();

// 'Callbacks' jsou funkce, které tento modul zavolá, když přijde zpráva ze serveru.
// Tímto způsobem dáváme vědět ostatním částem aplikace, že se něco stalo.
const callbacks = {
    onLobbyUpdate: null,
    onGameStart: null,
    onGameUpdate: null,
    onGameOver: null,
    onConnect: null,
    onError: null,
};

// --- LISTENERY - Co dělat, když server pošle zprávu ---

socket.on('connect', () => {
    console.log('Successfully connected to Avalon server.');
    if (callbacks.onConnect) {
        callbacks.onConnect(socket.id);
    }
});

socket.on('disconnect', () => {
    alert("Spojení se serverem Avalon bylo přerušeno.");
    location.reload();
});

socket.on('lobbyJoined', (data) => {
    if (callbacks.onLobbyUpdate) {
        callbacks.onLobbyUpdate(data);
    }
});

socket.on('lobbyUpdate', (data) => {
    if (callbacks.onLobbyUpdate) {
        callbacks.onLobbyUpdate(data);
    }
});

socket.on('gameStarted', (initialPacket) => {
    if (callbacks.onGameStart) {
        callbacks.onGameStart(initialPacket);
    }
});

socket.on('gameStateUpdate', (update) => {
    if (callbacks.onGameUpdate) {
        callbacks.onGameUpdate(update);
    }
});

socket.on('gameOver', (data) => {
    if (callbacks.onGameOver) {
        callbacks.onGameOver(data);
    }
});

socket.on('gameError', (error) => {
    alert(`Chyba: ${error.message}`);
    if (callbacks.onError) {
        callbacks.onError(error);
    }
});


// --- EXPORTOVANÉ FUNKCE - Jak klient komunikuje se serverem ---

export const network = {
    /**
     * Umožňuje ostatním modulům (main.js, game.js) zaregistrovat funkce,
     * které se mají spustit při přijetí dat ze serveru.
     * @param {string} eventName - Název události (např. 'onLobbyUpdate').
     * @param {function} callback - Funkce, která se má spustit.
     */
    on: (eventName, callback) => {
        if (callbacks.hasOwnProperty(eventName)) {
            callbacks[eventName] = callback;
        } else {
            console.error(`Unknown network event: ${eventName}`);
        }
    },

    // Akce v menu a lobby
    sendPlayerName: (name) => socket.emit('setPlayerName', name),
    sendCreateLobby: (options) => socket.emit('createLobby', options),
    sendFindPublicLobby: () => socket.emit('findPublicLobby'),
    sendJoinLobby: (code) => socket.emit('joinLobby', code),
    sendStartGame: (code) => socket.emit('startGame', code),

    // Akce ve hře
    sendPlayerAction: (action) => socket.emit('playerAction', action),
};

// --- END OF FILE client/js/network.js ---
