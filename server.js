const express = require('express');
const http = require('http');
const path = require('path');
const socketIo = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);
const PORT = 3000;

app.use(express.static(path.join(__dirname, 'public')));

// --- HERNÍ STAV ---
const games = {}; // Drží všechny aktivní hry
const players = {}; // Drží info o hráčích, než vstoupí do hry

// --- HERNÍ KONSTANTY ---
const GRID_SIZE = 600;
const TICK_RATE = 100; // 10x za sekundu
const PLAYER_COLORS = ['#3d9440', '#c62828', '#1565c0', '#f9a825']; // Zelená, Červená, Modrá, Žlutá
const THEFT_RATE = 0.0005; // 0.05% surovin za zabrané políčko

// Definice budov z původní hry
const STRUCTURE_DEFINITIONS = {
    mine: { name: 'Důl', income: { gold: 5 }, cost: 100, size: 2 },
    village: { name: 'Vesnice', unit_bonus: 5, cost: 75, size: 3 },
    crystal_mine: { name: 'Krystalový důl', income: { crystals: 1 }, cost: 300, size: 2 },
    barracks: { name: 'Kasárny', production: { units: 1 }, upkeep: { gold: 2 }, cost: { gold: 150, crystals: 5 }, size: 3 },
    watchtower: { name: 'Strážní věž', effect: { attrition_reduction: 0.5, radius: 10 }, cost: { gold: 100, crystals: 0 }, size: 2 }
};


// --- HERNÍ LOGIKA ---
function generateGameCode() { return Math.random().toString(36).substring(2, 7).toUpperCase(); }

function initializeGame(game) {
    console.log(`Inicializace hry ${game.code}...`);
    game.status = 'running';
    game.gameBoard = Array.from({ length: GRID_SIZE }, (_, y) =>
        Array.from({ length: GRID_SIZE }, (_, x) => ({ x, y, ownerId: null, structureId: null, terrain: 'none' }))
    );
    game.structures = new Map();
    game.expeditions = [];
    game.lastIncomeTick = Date.now();
    game.lastProductionTick = Date.now();

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
        const base = { id: baseId, type: 'base', ownerId: player.id, x: pos.x, y: pos.y, w: 6, h: 6, data: { name: `Základna hráče ${player.name}` } };
        game.structures.set(baseId, base);

        for (let y = pos.y; y < pos.y + base.h; y++) {
            for (let x = pos.x; x < pos.x + base.w; x++) {
                if (game.gameBoard[y]?.[x]) {
                    game.gameBoard[y][x].ownerId = player.id;
                    game.gameBoard[y][x].structureId = baseId;
                    player.territoryCount++;
                }
            }
        }
    });

    // TODO: Přidat logiku pro rozmístění neutrálních struktur

    console.log(`Hra ${game.code} připravena, startuji herní smyčku.`);
    game.gameInterval = setInterval(() => gameTick(game.code), TICK_RATE);
}

function gameTick(gameCode) {
    const game = games[gameCode];
    if (!game || game.status !== 'running') return;

    handleExpeditions(game);

    if (Date.now() - game.lastIncomeTick > 1000) { // Každou sekundu
        handleResources(game, 'income');
        game.lastIncomeTick = Date.now();
    }
    if (Date.now() - game.lastProductionTick > 15000) { // Každých 15 sekund
        handleResources(game, 'production');
        game.lastProductionTick = Date.now();
    }
    
    io.to(gameCode).emit('gameStateUpdate', sanitizeGameState(game));
}

function handleExpeditions(game) {
    game.expeditions = game.expeditions.filter(exp => {
        const dirX = Math.sign(exp.targetX - exp.currentX);
        const dirY = Math.sign(exp.targetY - exp.currentY);
        exp.currentX += dirX;
        exp.currentY += dirY;

        const x = Math.floor(exp.currentX);
        const y = Math.floor(exp.currentY);

        if (x < 0 || x >= GRID_SIZE || y < 0 || y >= GRID_SIZE || exp.unitsLeft <= 0) return false;

        const cell = game.gameBoard[y]?.[x];
        if (!cell) return false;

        if (cell.ownerId !== exp.ownerId) {
            const newOwner = game.players.find(p => p.id === exp.ownerId);
            const previousOwner = game.players.find(p => p.id === cell.ownerId);
            
            if (previousOwner) {
                previousOwner.territoryCount--;
                const goldStolen = Math.floor(previousOwner.gold * THEFT_RATE);
                const crystalsStolen = Math.floor(previousOwner.crystals * THEFT_RATE);
                previousOwner.gold -= goldStolen;
                previousOwner.crystals -= crystalsStolen;
                if (newOwner) {
                    newOwner.gold += goldStolen;
                    newOwner.crystals += crystalsStolen;
                }
            }
            if (newOwner) newOwner.territoryCount++;
            cell.ownerId = exp.ownerId;
            exp.unitsLeft--;
        }
        
        return !(x === exp.targetX && y === exp.targetY);
    });
}

function handleResources(game, type) {
    game.players.forEach(player => {
        let goldChange = 0;
        let crystalChange = 0;
        let unitChange = 0;

        if (type === 'income') {
            goldChange += player.income; // Základní příjem
        }

        game.structures.forEach(s => {
            if (s.ownerId === player.id) {
                const def = STRUCTURE_DEFINITIONS[s.type.replace('owned_', '')];
                if (!def) return;

                if (type === 'income' && def.income) {
                    goldChange += def.income.gold || 0;
                    crystalChange += def.income.crystals || 0;
                }
                if (type === 'production' && def.production) {
                    unitChange += def.production.units || 0;
                }
                if (def.upkeep) {
                    goldChange -= def.upkeep.gold || 0;
                }
            }
        });
        player.gold += goldChange;
        player.crystals += crystalChange;
        player.units += unitChange;
    });
}

function sanitizeGameState(game) {
    return {
        code: game.code,
        status: game.status,
        players: game.players,
        gameBoard: game.gameBoard,
        structures: Object.fromEntries(game.structures),
        expeditions: game.expeditions,
        gridSize: GRID_SIZE,
    };
}

io.on('connection', (socket) => {
    console.log(`Hráč připojen: ${socket.id}`);
    let currentPlayer = { id: socket.id };
    players[socket.id] = currentPlayer;

    // --- LOBBY HANDLERY ---
    socket.on('playerEnteredLobby', (name) => { currentPlayer.name = name; });
    socket.on('createGame', () => {
        const gameCode = generateGameCode();
        games[gameCode] = { code: gameCode, players: [currentPlayer], hostId: socket.id, status: 'waiting' };
        currentPlayer.gameCode = gameCode;
        socket.join(gameCode);
        socket.emit('gameCreated', gameCode);
        io.to(gameCode).emit('updatePlayerList', games[gameCode].players);
    });
    socket.on('joinGame', (gameCode) => {
        const game = games[gameCode];
        if (!game) { socket.emit('error', 'Hra neexistuje.'); return; }
        if (game.status !== 'waiting') { socket.emit('error', 'Hra už běží.'); return; }
        currentPlayer.gameCode = gameCode;
        game.players.push(currentPlayer);
        socket.join(gameCode);
        socket.emit('joinSuccess', gameCode);
        io.to(gameCode).emit('updatePlayerList', game.players);
    });
    socket.on('startGame', () => {
        const gameCode = currentPlayer.gameCode;
        if (games[gameCode] && games[gameCode].hostId === socket.id) initializeGame(games[gameCode]);
    });

    // --- HERNÍ HANDLERY ---
    socket.on('launchExpedition', ({ gameCode, target, units }) => {
        const game = games[gameCode];
        const player = game?.players.find(p => p.id === socket.id);
        const myBase = Array.from(game?.structures.values()).find(s => s.type === 'base' && s.ownerId === socket.id);
        if (!player || !myBase || player.units < units || units <= 0) return;

        player.units -= units;
        game.expeditions.push({
            id: `exp_${Date.now()}`,
            ownerId: socket.id,
            unitsLeft: units,
            currentX: myBase.x + myBase.w / 2,
            currentY: myBase.y + myBase.h / 2,
            targetX: target.x,
            targetY: target.y,
        });
    });

    socket.on('buyUnit', ({gameCode}) => {
        const game = games[gameCode];
        const player = game?.players.find(p => p.id === socket.id);
        if(!player || player.gold < 50) return;
        player.gold -= 50;
        player.units++;
    });

    socket.on('disconnect', () => {
        console.log(`Hráč odpojen: ${socket.id}`);
        if (currentPlayer.gameCode && games[currentPlayer.gameCode]) {
            const game = games[currentPlayer.gameCode];
            game.players = game.players.filter(p => p.id !== socket.id);
            if (game.players.length === 0) {
                clearInterval(game.gameInterval);
                delete games[currentPlayer.gameCode];
            } else {
                 io.to(currentPlayer.gameCode).emit('updatePlayerList', game.players);
            }
        }
        delete players[socket.id];
    });
});

server.listen(PORT, () => console.log(`Server běží na portu ${PORT}!`));