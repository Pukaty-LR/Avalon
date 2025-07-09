// --- START OF FILE server/lobbyManager.js (FINÁLNÍ ROBUSTNÍ VERZE) ---
const { GameInstance } = require('./gameInstance.js');
const { GAME_CONFIG } = require('../shared/config.js');

const createId = (length = 5) => Math.random().toString(36).substr(2, length).toUpperCase();

class LobbyManager {
    constructor(io) {
        this.io = io;
        this.games = {};
        this.lastTickTime = Date.now();
        setInterval(() => this.tick(), GAME_CONFIG.TICK_RATE);
    }

    tick() {
        const now = Date.now();
        const deltaTime = (now - this.lastTickTime) / 1000.0;
        this.lastTickTime = now;

        for (const gameCode in this.games) {
            const game = this.games[gameCode];
            if (game.status === 'running' && game.instance) {
                const packets = game.instance.gameTick(deltaTime);
                for (const playerId in packets) {
                    const socket = this.findSocket(playerId);
                    if (socket) {
                        socket.emit('gameStateUpdate', packets[playerId]);
                    }
                }
            }
        }
    }

    findSocket(socketId) {
        return this.io.sockets.sockets.get(socketId);
    }
    
    handleNewConnection(socket) {
        socket.playerInfo = { id: socket.id, name: `Rytíř${Math.floor(Math.random() * 1000)}` };
        
        socket.on('setPlayerName', (name) => {
            if (name && name.trim()) socket.playerInfo.name = name.trim();
        });
        socket.on('createLobby', ({ isPrivate, isSolo }) => this.createLobby(socket, { isPrivate, isSolo }));
        socket.on('joinLobby', (gameCode) => this.joinLobby(socket, gameCode));
        socket.on('findPublicLobby', () => this.findPublicLobby(socket));
        socket.on('startGame', (gameCode) => this.startGame(socket, gameCode));
        socket.on('kickPlayer', (playerId) => this.kickPlayer(socket, playerId));
        socket.on('disconnect', () => this.handleDisconnect(socket));
        // Listener pro herní akce je zde centrálně
        socket.on('playerAction', (action) => {
            const game = this.games[socket.gameCode];
            if (game && game.status === 'running' && game.instance) {
                game.instance.handlePlayerAction(socket.id, action);
            }
        });
    }

    createLobby(socket, { isPrivate, isSolo }) {
        const gameCode = createId();
        const game = {
            code: gameCode,
            status: 'lobby',
            isPrivate, // Použijeme zkrácený zápis
            sockets: [socket],
            players: [socket.playerInfo],
            hostId: socket.id,
            instance: null,
        };
        this.games[gameCode] = game;
        socket.join(gameCode);
        socket.gameCode = gameCode;
        
        if (isSolo) {
            this.startGame(socket, gameCode);
            return;
        }

        socket.emit('lobbyJoined', { gameCode, players: game.players, hostId: game.hostId });
    }

    joinLobby(socket, gameCode) {
        const game = this.games[gameCode];
        if (!game || game.status !== 'lobby') return socket.emit('gameError', { message: 'Lobby neexistuje nebo hra již běží.' });
        if (game.players.some(p => p.id === socket.id)) return;
        if (game.players.length >= GAME_CONFIG.MAX_PLAYERS) return socket.emit('gameError', { message: 'Lobby je plné.' });
        
        socket.join(gameCode);
        socket.gameCode = gameCode;
        game.sockets.push(socket);
        game.players.push(socket.playerInfo);
        const payload = { gameCode: game.code, players: game.players, hostId: game.hostId };
        this.io.to(gameCode).emit('lobbyUpdate', payload);
    }

    findPublicLobby(socket) {
        const availableLobby = Object.values(this.games).find(
            g => !g.isPrivate && g.status === 'lobby' && g.players.length < GAME_CONFIG.MAX_PLAYERS
        );
        if (availableLobby) {
            this.joinLobby(socket, availableLobby.code);
        } else {
            // Vytvoříme nové VEŘEJNÉ lobby, jak je požadováno
            this.createLobby(socket, { isPrivate: false, isSolo: false });
        }
    }

    startGame(socket, gameCode) {
        const game = this.games[gameCode];
        if (game && game.hostId === socket.id && game.status === 'lobby') {
            game.status = 'running';
            game.instance = new GameInstance(game.code, game.players);
            const initialPacket = game.instance.initializeGame();
            
            this.io.to(gameCode).emit('gameStarted', initialPacket);
        }
    }
    
    kickPlayer(hostSocket, playerIdToKick) {
        const gameCode = hostSocket.gameCode;
        const game = this.games[gameCode];
        if (!game || game.hostId !== hostSocket.id) return;

        const kickedSocket = this.findSocket(playerIdToKick);
        if (kickedSocket) {
            kickedSocket.emit('kicked', { reason: 'Host tě vykopl z lobby.' });
            kickedSocket.leave(gameCode);
            delete kickedSocket.gameCode;

            game.sockets = game.sockets.filter(s => s.id !== playerIdToKick);
            game.players = game.players.filter(p => p.id !== playerIdToKick);

            this.io.to(gameCode).emit('lobbyUpdate', {
                gameCode: game.code, players: game.players, hostId: game.hostId
            });
        }
    }

    handleDisconnect(socket) {
        const gameCode = socket.gameCode;
        if (!gameCode || !this.games[gameCode]) return;
        
        const game = this.games[gameCode];
        const wasHost = socket.id === game.hostId;
        game.sockets = game.sockets.filter(s => s.id !== socket.id);
        game.players = game.players.filter(p => p.id !== socket.id);
        
        if (game.players.length === 0) {
            delete this.games[gameCode];
            return;
        }

        if (game.status === 'running') {
            this.io.to(game.code).emit('gameOver', { reason: `${socket.playerInfo.name} opustil bojiště.` });
            delete this.games[gameCode];
        } else if (game.status === 'lobby') {
            if (wasHost) game.hostId = game.players[0].id;
            this.io.to(game.code).emit('lobbyUpdate', {
                gameCode: game.code, players: game.players, hostId: game.hostId
            });
        }
    }
}

module.exports = { LobbyManager };
// --- END OF FILE server/lobbyManager.js ---
