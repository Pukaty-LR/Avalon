const express = require('express');
const http = require('http');
const path = require('path');
const socketIo = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);
const PORT = 3000;

app.use(express.static(path.join(__dirname, 'public')));

const games = {};
const players = {};

const GRID_SIZE = 600;
const TICK_RATE = 100;
const PLAYER_COLORS = ['#3d9440', '#c62828', '#1565c0', '#f9a825'];
const THEFT_RATE = 0.0005;

function generateGameCode() { return Math.random().toString(36).substring(2, 7).toUpperCase(); }

function initializeGame(game) {
    console.log(`Inicializace hry ${game.code}...`);
    game.status = 'running';
    game.gameBoard = Array.from({ length: GRID_SIZE }, (_, y) =>
        Array.from({ length: GRID_SIZE }, (_, x) => ({ x, y, ownerId: null }))
    );
    game.boardChanges = [];

    game.structures = new Map();
    game.expeditions = [];
    game.lastIncomeTick = Date.now();
    
    const startPositions = [{ x: 50, y: 50 }, { x: GRID_SIZE - 50, y: GRID_SIZE - 50 }, { x: 50, y: GRID_SIZE - 50 }, { x: GRID_SIZE - 50, y: 50 }];
    
    game.players.forEach((player, index) => {
        player.color = PLAYER_COLORS[index % PLAYER_COLORS.length];
        player.gold = 500;
        player.crystals = 10;
        player.units = 20;
        player.income = 5;
        player.territoryCount = 0;

        const pos = startPositions[index];
        const baseId = `base_${player.id}`;
        const base = { id: baseId, type: 'base', ownerId: player.id, x: pos.x, y: pos.y, w: 6, h: 6 };
        game.structures.set(baseId, base);

        for (let y = pos.y; y < pos.y + base.h; y++) {
            for (let x = pos.x; x < pos.x + base.w; x++) {
                if (game.gameBoard[y]?.[x]) {
                    const cell = game.gameBoard[y][x];
                    cell.ownerId = player.id;
                    player.territoryCount++;
                }
            }
        }
    });

    io.to(game.code).emit('gameStarted', sanitizeGameState(game, true));
    
    console.log(`Hra ${game.code} připravena, startuji herní smyčku.`);
    game.gameInterval = setInterval(() => gameTick(game.code), TICK_RATE);
}

function gameTick(gameCode) {
    const game = games[gameCode];
    if (!game || game.status !== 'running') return;

    handleExpeditions(game);

    if (Date.now() - game.lastIncomeTick > 1000) {
        handleIncome(game);
        game.lastIncomeTick = Date.now();
    }
    
    const updatePacket = createUpdatePacket(game);
    if(updatePacket.boardChanges.length > 0 || game.players.some(p => p.updated)) {
         io.to(gameCode).emit('gameStateUpdate', updatePacket);
    }
    game.boardChanges = [];
    game.players.forEach(p => p.updated = false);
}

function handleExpeditions(game) {
    game.expeditions = game.expeditions.filter(exp => {
        exp.currentX += Math.sign(exp.targetX - exp.currentX);
        exp.currentY += Math.sign(exp.targetY - exp.currentY);

        const x = Math.floor(exp.currentX);
        const y = Math.floor(exp.currentY);

        if (x < 0 || x >= GRID_SIZE || y < 0 || y >= GRID_SIZE || exp.unitsLeft <= 0) return false;

        const cell = game.gameBoard[y]?.[x];
        if (!cell || cell.ownerId === exp.ownerId) return true;

        const newOwner = game.players.find(p => p.id === exp.ownerId);
        const previousOwner = game.players.find(p => p.id === cell.ownerId);
        
        if (previousOwner) {
            previousOwner.territoryCount--;
            const goldStolen = Math.floor(previousOwner.gold * THEFT_RATE);
            previousOwner.gold -= goldStolen;
            if (newOwner) newOwner.gold += goldStolen;
            previousOwner.updated = true;
        }
        if (newOwner) {
            newOwner.territoryCount++;
            newOwner.updated = true;
        }
        
        cell.ownerId = exp.ownerId;
        game.boardChanges.push({x, y, ownerId: exp.ownerId});
        exp.unitsLeft--;
        
        return !(x === exp.targetX && y === exp.targetY);
    });
}

function handleIncome(game) { 
    game.players.forEach(p => { 
        p.gold += p.income;
        p.updated = true;
    });
}

function createUpdatePacket(game) {
    return {
        players: game.players,
        boardChanges: game.boardChanges,
        expeditions: game.expeditions,
    };
}

function sanitizeGameState(game, full = false) {
    const state = {
        code: game.code, status: game.status, players: game.players,
        structures: Object.fromEntries(game.structures),
        expeditions: game.expeditions, gridSize: GRID_SIZE,
    };
    if (full) state.gameBoard = game.gameBoard;
    return state;
}

io.on('connection', (socket) => {
    players[socket.id] = { id: socket.id };

    socket.on('playerEnteredLobby', (name) => { players[socket.id].name = name; });
    socket.on('createGame', () => {
        const currentPlayer = players[socket.id];
        const gameCode = generateGameCode();
        games[gameCode] = { code: gameCode, players: [currentPlayer], hostId: socket.id, status: 'waiting' };
        currentPlayer.gameCode = gameCode;
        socket.join(gameCode);
        socket.emit('gameCreated', gameCode);
        io.to(gameCode).emit('updatePlayerList', games[gameCode].players);
    });
    socket.on('findGame', () => {
        const currentPlayer = players[socket.id];
        let availableGame = Object.values(games).find(g => g.status === 'waiting' && g.players.length < 4);
        if(availableGame) {
            currentPlayer.gameCode = availableGame.code;
            availableGame.players.push(currentPlayer);
            socket.join(availableGame.code);
            socket.emit('joinSuccess', availableGame.code);
            io.to(availableGame.code).emit('updatePlayerList', availableGame.players);
        } else {
            const gameCode = generateGameCode();
            games[gameCode] = { code: gameCode, players: [currentPlayer], hostId: socket.id, status: 'waiting' };
            currentPlayer.gameCode = gameCode;
            socket.join(gameCode);
            socket.emit('gameCreated', gameCode);
            io.to(gameCode).emit('updatePlayerList', games[gameCode].players);
        }
    });
    socket.on('joinGame', (gameCode) => {
        const currentPlayer = players[socket.id];
        const game = games[gameCode];
        if (!game || game.status !== 'waiting') { socket.emit('error', 'Hra neexistuje nebo už běží.'); return; }
        currentPlayer.gameCode = gameCode;
        game.players.push(currentPlayer);
        socket.join(gameCode);
        socket.emit('joinSuccess', gameCode);
        io.to(gameCode).emit('updatePlayerList', game.players);
    });
    socket.on('startGame', () => {
        const currentPlayer = players[socket.id];
        const gameCode = currentPlayer.gameCode;
        if (games[gameCode] && games[gameCode].hostId === socket.id) {
            initializeGame(games[gameCode]);
        }
    });
    socket.on('launchExpedition', ({ gameCode, target, units }) => {
        const game = games[gameCode];
        const player = game?.players.find(p => p.id === socket.id);
        const myBase = Array.from(game?.structures.values()).find(s => s.type === 'base' && s.ownerId === socket.id);
        if (!player || !myBase || player.units < units || units <= 0) return;
        player.units -= units;
        player.updated = true;
        game.expeditions.push({ id: `exp_${Date.now()}`, ownerId: socket.id, unitsLeft: units, currentX: myBase.x + myBase.w/2, currentY: myBase.y + myBase.h/2, targetX: target.x, targetY: target.y });
    });
    socket.on('buyUnit', ({gameCode}) => {
        const game = games[gameCode];
        const player = game?.players.find(p => p.id === socket.id);
        if(!player || player.gold < 50) return;
        player.gold -= 50;
        player.units++;
        player.updated = true;
    });
    socket.on('disconnect', () => {
        console.log(`Hráč odpojen: ${socket.id}`);
        const currentPlayer = players[socket.id];
        if (currentPlayer && currentPlayer.gameCode && games[currentPlayer.gameCode]) {
            const game = games[currentPlayer.gameCode];
            game.players = game.players.filter(p => p.id !== socket.id);
            if (game.players.length === 0) {
                if (game.gameInterval) clearInterval(game.gameInterval);
                delete games[currentPlayer.gameCode];
            } else {
                 if (socket.id === game.hostId) game.hostId = game.players[0].id;
                 io.to(currentPlayer.gameCode).emit('updatePlayerList', game.players);
            }
        }
        delete players[socket.id];
    });
});

server.listen(PORT, () => console.log(`Server běží na portu ${PORT}!`));