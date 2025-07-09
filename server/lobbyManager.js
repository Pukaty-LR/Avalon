// --- START OF FILE server/lobbyManager.js (OPRAVENÁ VERZE) ---

const { GameInstance } = require('./gameInstance.js');
const { GAME_CONFIG } = require('../shared/config.js');

const createId = (length = 5) => Math.random().toString(36).substr(2, length).toUpperCase();

class LobbyManager {
    constructor(io) {
        this.io = io;
        this.games = {};
    }

    handleNewConnection(socket) {
        socket.playerInfo = { id: socket.id, name: `Anonym${Math.floor(Math.random() * 1000)}` };

        // Tyto listenery jsou pouze pro dobu, kdy je hráč v menu/lobby
        socket.on('setPlayerName', (name) => {
            const trimmedName = name.trim();
            if (trimmedName) {
                socket.playerInfo.name = trimmedName;
            }
        });
        socket.on('createLobby', ({ isPrivate, isSolo }) => this.createLobby(socket, { isPrivate, isSolo }));
        socket.on('joinLobby', (gameCode) => this.joinLobby(socket, gameCode));
        socket.on('findPublicLobby', () => this.findPublicLobby(socket));
        socket.on('startGame', (gameCode) => this.startGame(socket, gameCode));
        socket.on('disconnect', () => this.handleDisconnect(socket));
    }

    createLobby(socket, { isPrivate, isSolo }) {
        // ... (tato metoda zůstává beze změny)
        const gameCode = createId();
        const game = {
            code: gameCode,
            status: 'lobby',
            isPrivate: isPrivate,
            sockets: [socket],
            players: [socket.playerInfo],
            hostId: socket.id,
        };
        this.games[gameCode] = game;
        socket.join(gameCode);
        socket.gameCode = gameCode;
        socket.emit('lobbyJoined', {
            gameCode: game.code,
            players: game.players,
            hostId: game.hostId,
        });
        if (isSolo) {
            this.startGame(socket, gameCode);
        }
    }

    joinLobby(socket, gameCode) {
        // ... (tato metoda zůstává beze změny)
        const game = this.games[gameCode];
        if (game && game.status === 'lobby') {
            if (game.players.some(p => p.id === socket.id)) return;
            if (game.players.length >= GAME_CONFIG.MAX_PLAYERS) {
                return socket.emit('gameError', { message: 'Lobby je plné.' });
            }
            socket.join(gameCode);
            socket.gameCode = gameCode;
            game.sockets.push(socket);
            game.players.push(socket.playerInfo);
            const payload = { gameCode: game.code, players: game.players, hostId: game.hostId };
            socket.emit('lobbyJoined', payload);
            socket.to(gameCode).emit('lobbyUpdate', payload);
        } else {
            socket.emit('gameError', { message: 'Lobby neexistuje nebo hra již běží.' });
        }
    }

    findPublicLobby(socket) {
        // ... (tato metoda zůstává beze změny)
        let availableLobby = Object.values(this.games).find(
            g => !g.isPrivate && g.status === 'lobby' && g.players.length < GAME_CONFIG.MAX_PLAYERS
        );
        if (availableLobby) {
            this.joinLobby(socket, availableLobby.code);
        } else {
            this.createLobby(socket, { isPrivate: false, isSolo: false });
        }
    }

    startGame(socket, gameCode) {
        const game = this.games[gameCode];
        if (game && game.hostId === socket.id && game.status === 'lobby') {
            game.status = 'running';
            
            // OPRAVA: Předáme celé pole socketů do herní instance.
            game.instance = new GameInstance(game.code, game.players, game.sockets, this.io);
            game.instance.initializeGame();

            // OPRAVA: Po startu hry odstraníme z hráčských socketů listenery pro lobby,
            // abychom předešli nechtěnému chování.
            game.sockets.forEach(s => {
                s.removeAllListeners('createLobby');
                s.removeAllListeners('joinLobby');
                s.removeAllListeners('findPublicLobby');
                s.removeAllListeners('startGame');
            });
        }
    }
    
    handleDisconnect(socket) {
        // ... (tato metoda zůstává beze změny)
        console.log(`A hero has fallen: ${socket.id}`);
        const gameCode = socket.gameCode;
        if (!gameCode || !this.games[gameCode]) return;
        const game = this.games[gameCode];
        game.sockets = game.sockets.filter(s => s.id !== socket.id);
        const playerIndex = game.players.findIndex(p => p.id === socket.id);
        if (playerIndex > -1) game.players.splice(playerIndex, 1);
        if (game.status === 'running') {
            this.io.to(game.code).emit('gameOver', { reason: `${socket.playerInfo.name} opustil bojiště.` });
            if (game.instance) game.instance.stopGame();
            delete this.games[gameCode];
        } else if (game.status === 'lobby') {
            if (game.players.length === 0) {
                delete this.games[gameCode];
            } else {
                if (socket.id === game.hostId) game.hostId = game.players[0].id;
                this.io.to(game.code).emit('lobbyUpdate', {
                    gameCode: game.code, players: game.players, hostId: game.hostId
                });
            }
        }
    }
}

module.exports = { LobbyManager };
// --- END OF FILE server/lobbyManager.js ---
