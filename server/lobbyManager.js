// --- START OF FILE server/lobbyManager.js ---

// Importujeme naše budoucí moduly a sdílenou konfiguraci
const { GameInstance } = require('./gameInstance.js');
const { GAME_CONFIG } = require('../shared/config.js');

// Pomocná funkce pro generování unikátních ID pro lobby
const createId = (length = 5) => Math.random().toString(36).substr(2, length).toUpperCase();

class LobbyManager {
    constructor(io) {
        this.io = io;
        this.games = {}; // Objekt, který bude držet všechny lobby a běžící hry
    }

    /**
     * Zpracuje nově připojeného hráče. Nastaví listenery pro události
     * specifické pro lobby a disconnect.
     * @param {Socket} socket - Socket.IO objekt nově připojeného hráče.
     */
    handleNewConnection(socket) {
        // Každý socket si ponese základní info o hráči
        socket.playerInfo = { id: socket.id, name: `Anonym${Math.floor(Math.random() * 1000)}` };

        // --- LISTENERY PRO AKCE V LOBBY ---

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
        socket.gameCode = gameCode; // Uložíme si kód hry přímo na socket pro snadnější přístup

        socket.emit('lobbyJoined', {
            gameCode: game.code,
            players: game.players,
            hostId: game.hostId,
        });

        // Pokud je to sólo hra, rovnou ji spustíme
        if (isSolo) {
            this.startGame(socket, gameCode);
        }
    }

    joinLobby(socket, gameCode) {
        const game = this.games[gameCode];
        if (game && game.status === 'lobby') {
            if (game.players.some(p => p.id === socket.id)) return; // Hráč už je v lobby
            if (game.players.length >= GAME_CONFIG.MAX_PLAYERS) {
                return socket.emit('gameError', { message: 'Lobby je plné.' });
            }

            socket.join(gameCode);
            socket.gameCode = gameCode;
            game.sockets.push(socket);
            game.players.push(socket.playerInfo);

            const payload = { gameCode: game.code, players: game.players, hostId: game.hostId };
            socket.emit('lobbyJoined', payload); // Pošli info nově připojenému
            socket.to(gameCode).emit('lobbyUpdate', payload); // Aktualizuj ostatní v lobby
        } else {
            socket.emit('gameError', { message: 'Lobby neexistuje nebo hra již běží.' });
        }
    }

    findPublicLobby(socket) {
        let availableLobby = Object.values(this.games).find(
            g => !g.isPrivate && g.status === 'lobby' && g.players.length < GAME_CONFIG.MAX_PLAYERS
        );

        if (availableLobby) {
            this.joinLobby(socket, availableLobby.code);
        } else {
            // Žádné veřejné lobby nebylo nalezeno, vytvoříme nové
            this.createLobby(socket, { isPrivate: false, isSolo: false });
        }
    }

    startGame(socket, gameCode) {
        const game = this.games[gameCode];
        if (game && game.hostId === socket.id && game.status === 'lobby') {
            // Změna stavu z 'lobby' na 'running' a vytvoření instance hry
            game.status = 'running';
            game.instance = new GameInstance(game.code, game.players, this.io);
            game.instance.initializeGame();
        }
    }
    
    handleDisconnect(socket) {
        console.log(`A hero has fallen: ${socket.id}`);
        const gameCode = socket.gameCode;
        if (!gameCode || !this.games[gameCode]) return;

        const game = this.games[gameCode];

        // Odstranění hráče z pole sockets a players
        game.sockets = game.sockets.filter(s => s.id !== socket.id);
        const playerIndex = game.players.findIndex(p => p.id === socket.id);
        if (playerIndex > -1) {
            game.players.splice(playerIndex, 1);
        }
        
        // Zpracování různých scénářů po odpojení
        if (game.status === 'running') {
            // Pokud hra běží, ukončíme ji
            this.io.to(game.code).emit('gameOver', { reason: `${socket.playerInfo.name} opustil bojiště.` });
            if (game.instance) {
                game.instance.stopGame();
            }
            delete this.games[gameCode];

        } else if (game.status === 'lobby') {
            if (game.players.length === 0) {
                // Poslední hráč opustil lobby, smažeme ho
                delete this.games[gameCode];
            } else {
                // Pokud odešel host, zvolíme nového
                if (socket.id === game.hostId) {
                    game.hostId = game.players[0].id;
                }
                // Informujeme zbývající hráče o změně
                this.io.to(game.code).emit('lobbyUpdate', {
                    gameCode: game.code,
                    players: game.players,
                    hostId: game.hostId
                });
            }
        }
    }
}

// Exportujeme třídu pro použití v server.js
module.exports = { LobbyManager };

// --- END OF FILE server/lobbyManager.js ---
