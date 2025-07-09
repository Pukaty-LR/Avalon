// --- START OF FILE client/js/network.js (OPRAVENÁ VERZE) ---
const socket = io();

const callbacks = {
    onLobbyUpdate: null,
    onGameStart: null,
    onGameUpdate: null,
    onGameOver: null,
    onConnect: null,
    onError: null,
    onKicked: null, // NOVINKA: Callback pro vyhození z lobby
};

socket.on('connect', () => {
    if (callbacks.onConnect) callbacks.onConnect(socket.id);
});
socket.on('disconnect', () => {
    alert("Spojení se serverem Avalon bylo přerušeno.");
    location.reload();
});
socket.on('lobbyJoined', (data) => {
    if (callbacks.onLobbyUpdate) callbacks.onLobbyUpdate(data);
});
socket.on('lobbyUpdate', (data) => {
    if (callbacks.onLobbyUpdate) callbacks.onLobbyUpdate(data);
});
socket.on('gameStarted', (initialPacket) => {
    if (callbacks.onGameStart) callbacks.onGameStart(initialPacket);
});
socket.on('gameStateUpdate', (update) => {
    if (callbacks.onGameUpdate) callbacks.onGameUpdate(update);
});
socket.on('gameOver', (data) => {
    if (callbacks.onGameOver) callbacks.onGameOver(data);
});
socket.on('gameError', (error) => {
    alert(`Chyba: ${error.message}`);
    if (callbacks.onError) callbacks.onError(error);
});
// NOVINKA: Listener pro událost 'kicked'
socket.on('kicked', (data) => {
    if (callbacks.onKicked) callbacks.onKicked(data);
});

export const network = {
    on: (eventName, callback) => {
        if (callbacks.hasOwnProperty(eventName)) callbacks[eventName] = callback;
    },
    sendPlayerName: (name) => socket.emit('setPlayerName', name),
    sendCreateLobby: (options) => socket.emit('createLobby', options),
    sendFindPublicLobby: () => socket.emit('findPublicLobby'),
    sendJoinLobby: (code) => socket.emit('joinLobby', code),
    sendStartGame: (code) => socket.emit('startGame', code),
    sendKickPlayer: (playerId) => socket.emit('kickPlayer', playerId), // NOVINKA: Odeslání požadavku na kick
    sendPlayerAction: (action) => socket.emit('playerAction', action),
};
// --- END OF FILE client/js/network.js ---
