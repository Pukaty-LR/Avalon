const express = require('express');
const http = require('http');
const path = require('path');
const socketIo = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);
const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, 'public')));
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});
app.get('/styl.css', (req, res) => {
    res.sendFile(path.join(__dirname, 'styl.css'));
});


// --- HERNÍ STAV ---
const games = {};    // Klíč: gameCode, Hodnota: objekt hry
const players = {};  // Klíč: socket.id, Hodnota: objekt hráče

// --- HERNÍ KONSTANTY ---
const GAME_CONSTANTS = {
    GRID_SIZE: 600,
    TICK_RATE: 100, // ms
    INCOME_INTERVAL: 1000, // ms
    PRODUCTION_INTERVAL: 15000, // ms
    PLAYER_COLORS: ['#3d9440', '#c62828', '#1565c0', '#f9a825', '#f9a825', '#6a1b9a'],
    THEFT_RATE: 0.0005,
    UNIT_COST: 50,
    BASE_DEFENSE: 10,
    EXPEDITION_ATTRITION: 0.01,
    EXPEDITION_SPEED: 1.0, // buňky za tick
};

const STRUCTURE_DEFINITIONS = {
    base: { name: 'Základna', size: 6 },
    mine: { name: 'Důl', income: { gold: 5 }, cost: 100, size: 2, defense: 5 },
    village: { name: 'Vesnice', on_capture: { units: 10 }, cost: 75, size: 3, defense: 8 },
    crystal_mine: { name: 'Krystalový důl', production: { crystals: 1 }, cost: 300, size: 2, defense: 10 },
    barracks: { name: 'Kasárny', production: { units: 1 }, upkeep: { gold: 2 }, cost: { gold: 150, crystals: 5 }, size: 3, defense: 12 },
    watchtower: { name: 'Strážní věž', effect: { attrition_reduction: 0.5, radius: 20 }, cost: { gold: 100, crystals: 0 }, size: 2, defense: 5 },
    trading_post: { name: 'Tržiště', cost: 150, size: 3, defense: 3 },
    ancient_library: { name: 'Prastará knihovna', on_capture: { reveal_radius: 25 }, cost: 250, size: 4, defense: 15 },
};

// --- HERNÍ LOGIKA ---
function generateGameCode() { return Math.random().toString(36).substring(2, 7).toUpperCase(); }

function initializeGame(game) {
    console.log(`[GAME: ${game.code}] Inicializace...`);
    game.status = 'running';
    game.gameBoard = Array.from({ length: GAME_CONSTANTS.GRID_SIZE }, (_, y) =>
        Array.from({ length: GAME_CONSTANTS.GRID_SIZE }, (_, x) => ({ x, y, ownerId: null, structureId: null }))
    );
    game.structures = new Map();
    game.expeditions = [];
    game.lastTickTime = Date.now();

    const startPositions = [
        { x: 50, y: 50 }, { x: GAME_CONSTANTS.GRID_SIZE - 50, y: GAME_CONSTANTS.GRID_SIZE - 50 },
        { x: 50, y: GAME_CONSTANTS.GRID_SIZE - 50 }, { x: GAME_CONSTANTS.GRID_SIZE - 50, y: 50 }
    ];

    game.players.forEach((player, index) => {
        player.color = GAME_CONSTANTS.PLAYER_COLORS[index % GAME_CONSTANTS.PLAYER_COLORS.length];
        player.gold = 500; player.crystals = 10; player.units = 20; player.territoryCount = 0;
        player.lastIncomeTime = Date.now(); player.lastProductionTime = Date.now();
        const pos = startPositions[index];
        const base = createStructure(game, 'base', player.id, pos.x, pos.y, STRUCTURE_DEFINITIONS.base.size, { name: `Základna hráče ${player.name}` });
        // Přidání startovního území kolem základny
        for (let y = base.y; y < base.y + base.h; y++) {
            for (let x = base.x; x < base.x + base.w; x++) {
                if (game.gameBoard[y]?.[x]) {
                    game.gameBoard[y][x].ownerId = player.id;
                    player.territoryCount++;
                }
            }
        }
    });

    placeRandomStructures(game, 'mine', 15);
    placeRandomStructures(game, 'village', 15);
    placeRandomStructures(game, 'crystal_mine', 8);
    placeRandomStructures(game, 'trading_post', 5);
    placeRandomStructures(game, 'ancient_library', 3);

    const fullGameState = sanitizeGameState(game, true);
    io.to(game.code).emit('gameStarted', fullGameState);
    console.log(`[GAME: ${game.code}] Hra spuštěna, startuji herní smyčku.`);
    game.gameInterval = setInterval(() => gameTick(game.code), GAME_CONSTANTS.TICK_RATE);
}

function gameTick(gameCode) {
    const game = games[gameCode];
    if (!game || game.status !== 'running') return;

    const now = Date.now();
    const deltaTime = (now - game.lastTickTime) / 1000; // Delta v sekundách
    game.lastTickTime = now;

    let boardChanges = handleExpeditions(game, deltaTime);
    handleResources(game);

    const updatePacket = createUpdatePacket(game, boardChanges);
    if (updatePacket.boardChanges.length > 0 || game.players.some(p => p.updated) || game.expeditions.length > 0) {
        io.to(gameCode).emit('gameStateUpdate', updatePacket);
    }
    game.players.forEach(p => p.updated = false);
}

function handleExpeditions(game, deltaTime) {
    let changes = new Map();
    let destroyedExpeditions = new Set();

    game.expeditions.forEach((exp) => {
        if (destroyedExpeditions.has(exp.id)) return;

        // Attrition
        exp.unitsLeft -= GAME_CONSTANTS.EXPEDITION_ATTRITION * deltaTime;

        // Movement
        const dx = exp.targetX - exp.currentX;
        const dy = exp.targetY - exp.currentY;
        const dist = Math.hypot(dx, dy);

        if (dist < GAME_CONSTANTS.EXPEDITION_SPEED) {
            exp.currentX = exp.targetX;
            exp.currentY = exp.targetY;
            destroyedExpeditions.add(exp.id); // Cíl dosažen
        } else {
            exp.currentX += (dx / dist) * GAME_CONSTANTS.EXPEDITION_SPEED;
            exp.currentY += (dy / dist) * GAME_CONSTANTS.EXPEDITION_SPEED;
        }

        const x = Math.floor(exp.currentX);
        const y = Math.floor(exp.currentY);

        if (x < 0 || x >= GAME_CONSTANTS.GRID_SIZE || y < 0 || y >= GAME_CONSTANTS.GRID_SIZE || exp.unitsLeft <= 0) {
            destroyedExpeditions.add(exp.id);
            return;
        }

        const cell = game.gameBoard[y]?.[x];
        if (!cell) { destroyedExpeditions.add(exp.id); return; }

        if (cell.ownerId !== exp.ownerId) {
            const newOwner = game.players.find(p => p.id === exp.ownerId);
            const previousOwner = game.players.find(p => p.id === cell.ownerId);
            if (previousOwner) {
                previousOwner.territoryCount--;
                previousOwner.updated = true;
            }
            if (newOwner) {
                newOwner.territoryCount++;
                newOwner.updated = true;
            }
            cell.ownerId = exp.ownerId;
            changes.set(`${x},${y}`, { x, y, ownerId: exp.ownerId });
        }
    });

    game.expeditions = game.expeditions.filter(exp => !destroyedExpeditions.has(exp.id));
    return Array.from(changes.values());
}

function handleResources(game) {
    const now = Date.now();
    game.players.forEach(player => {
        if (now - player.lastIncomeTime > GAME_CONSTANTS.INCOME_INTERVAL) {
            let goldChange = 5; // Základní příjem
            game.structures.forEach(s => {
                if (s.ownerId === player.id) {
                    const def = STRUCTURE_DEFINITIONS[s.type.replace('owned_', '')];
                    if (def && def.income) goldChange += def.income.gold || 0;
                    if (def && def.upkeep) goldChange -= def.upkeep.gold || 0;
                }
            });
            player.gold += goldChange;
            player.updated = true;
            player.lastIncomeTime = now;
        }

        if (now - player.lastProductionTime > GAME_CONSTANTS.PRODUCTION_INTERVAL) {
             let unitChange = 0, crystalChange = 0;
             game.structures.forEach(s => {
                if (s.ownerId === player.id) {
                    const def = STRUCTURE_DEFINITIONS[s.type.replace('owned_', '')];
                    if (def && def.production) {
                        unitChange += def.production.units || 0;
                        crystalChange += def.production.crystals || 0;
                    }
                }
            });
            player.units += unitChange;
            player.crystals += crystalChange;
            player.updated = true;
            player.lastProductionTime = now;
        }
    });
}

function createStructure(game, type, ownerId, x, y, size, data) {
    const id = `${type}_${Date.now()}_${Math.random()}`;
    const newStructure = { id, type, ownerId, x, y, w: size, h: size, ...(data || {}) };
    for (let i = y; i < y + size; i++) {
        for (let j = x; j < x + size; j++) {
            if (game.gameBoard[i]?.[j]) {
                game.gameBoard[i][j].structureId = id;
            }
        }
    }
    game.structures.set(id, newStructure);
    return newStructure;
}

function placeRandomStructures(game, type, count) {
    const def = STRUCTURE_DEFINITIONS[type];
    for (let i = 0; i < count; i++) {
        let placed = false;
        while (!placed) {
            const x = Math.floor(Math.random() * (GAME_CONSTANTS.GRID_SIZE - def.size));
            const y = Math.floor(Math.random() * (GAME_CONSTANTS.GRID_SIZE - def.size));
            let areaClear = true;
            for (let dy = -5; dy < def.size + 5; dy++) {
                for (let dx = -5; dx < def.size + 5; dx++) {
                    if (game.gameBoard[y + dy]?.[x + dx]?.structureId) {
                        areaClear = false;
                        break;
                    }
                }
                if (!areaClear) break;
            }
            if (areaClear) {
                createStructure(game, type, null, x, y, def.size, def);
                placed = true;
            }
        }
    }
}

function createUpdatePacket(game, boardChanges) {
    return {
        players: game.players.filter(p => p.updated).map(p => ({
            id: p.id, gold: p.gold, crystals: p.crystals, units: p.units, territoryCount: p.territoryCount
        })),
        boardChanges,
        expeditions: game.expeditions,
    };
}

function sanitizeGameState(game, full = false) {
    const state = {
        code: game.code, status: game.status,
        players: game.players.map(p => ({ id: p.id, name: p.name, color: p.color })),
        structures: Array.from(game.structures.values()),
        expeditions: game.expeditions,
        gridSize: GAME_CONSTANTS.GRID_SIZE,
    };
    if (full) {
        state.gameBoard = game.gameBoard.map(row => row.map(cell => ({ ownerId: cell.ownerId })));
    }
    return state;
}

io.on('connection', (socket) => {
    console.log(`[CONNECTION] Nový klient připojen: ${socket.id}`);
    players[socket.id] = { id: socket.id, name: "Anonym" };

    socket.on('playerEnteredLobby', (name, callback) => {
        if (name && name.length > 2) {
            players[socket.id].name = name;
            callback({ success: true });
        } else {
            callback({ success: false, message: 'Jméno je příliš krátké.' });
        }
    });

    socket.on('createGame', (callback) => {
        const player = players[socket.id];
        const gameCode = generateGameCode();
        games[gameCode] = {
            code: gameCode, players: [player], hostId: socket.id,
            status: 'waiting', gameInterval: null
        };
        player.gameCode = gameCode;
        socket.join(gameCode);
        callback({ success: true, gameCode });
        io.to(gameCode).emit('updatePlayerList', games[gameCode].players);
    });

    socket.on('findGame', (callback) => {
        const player = players[socket.id];
        let availableGame = Object.values(games).find(g => g.status === 'waiting' && g.players.length < 4);
        if (availableGame) {
            player.gameCode = availableGame.code;
            availableGame.players.push(player);
            socket.join(availableGame.code);
            callback({ success: true, gameCode: availableGame.code });
            io.to(availableGame.code).emit('updatePlayerList', availableGame.players);
        } else {
            // No game found, create a new one
            const gameCode = generateGameCode();
            games[gameCode] = { code: gameCode, players: [player], hostId: socket.id, status: 'waiting', gameInterval: null };
            player.gameCode = gameCode;
            socket.join(gameCode);
            callback({ success: true, gameCode });
            io.to(gameCode).emit('updatePlayerList', games[gameCode].players);
        }
    });

    socket.on('joinGame', (gameCode, callback) => {
        const player = players[socket.id];
        const game = games[gameCode];
        if (!game) { return callback({ success: false, message: 'Hra s tímto kódem neexistuje.' }); }
        if (game.status !== 'waiting') { return callback({ success: false, message: 'Hra již běží nebo skončila.' }); }
        if (game.players.length >= 4) { return callback({ success: false, message: 'Hra je plná.' }); }

        player.gameCode = gameCode;
        game.players.push(player);
        socket.join(gameCode);
        callback({ success: true, gameCode });
        io.to(gameCode).emit('updatePlayerList', game.players);
    });

    socket.on('startGame', () => {
        const player = players[socket.id];
        if (!player || !player.gameCode) return;
        const game = games[player.gameCode];
        if (game && game.hostId === socket.id && game.status === 'waiting') {
            initializeGame(game);
        }
    });

    socket.on('launchExpedition', ({ target, units }) => {
        const player = players[socket.id];
        if (!player || !player.gameCode) return;
        const game = games[player.gameCode];
        const myBase = Array.from(game?.structures.values()).find(s => s.type === 'base' && s.ownerId === socket.id);
        if (!game || !player || !myBase || player.units < units || units <= 0) return;

        player.units -= units;
        player.updated = true;
        game.expeditions.push({
            id: `exp_${Date.now()}`, ownerId: socket.id, unitsLeft: units,
            currentX: myBase.x + myBase.w / 2, currentY: myBase.y + myBase.h / 2,
            targetX: target.x, targetY: target.y
        });
    });

    socket.on('buyUnit', () => {
        const player = players[socket.id];
        if (!player || !player.gameCode) return;
        const game = games[player.gameCode];
        if (!game || !player || player.gold < GAME_CONSTANTS.UNIT_COST) return;
        player.gold -= GAME_CONSTANTS.UNIT_COST;
        player.units++;
        player.updated = true;
    });

    socket.on('disconnect', () => {
        console.log(`[CONNECTION] Klient odpojen: ${socket.id}`);
        const player = players[socket.id];
        if (player && player.gameCode && games[player.gameCode]) {
            const game = games[player.gameCode];
            game.players = game.players.filter(p => p.id !== socket.id);

            if (game.players.length === 0) {
                console.log(`[GAME: ${game.code}] Poslední hráč se odpojil. Ukončuji hru.`);
                if (game.gameInterval) clearInterval(game.gameInterval);
                delete games[player.gameCode];
            } else {
                if (socket.id === game.hostId) {
                    game.hostId = game.players[0].id;
                    console.log(`[GAME: ${game.code}] Host se odpojil. Nový host: ${game.hostId}`);
                }
                io.to(player.gameCode).emit('updatePlayerList', game.players);
            }
        }
        delete players[socket.id];
    });
});

server.listen(PORT, () => console.log(`Server běží na portu ${PORT}!`));