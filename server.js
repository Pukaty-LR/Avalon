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
const games = {};
const players = {};

// --- HERNÍ KONSTANTY ---
const GRID_SIZE = 600;
const TICK_RATE = 100;
const PLAYER_COLORS = ['#3d9440', '#c62828', '#1565c0', '#f9a825'];
const THEFT_RATE = 0.0005;

// PLNÁ DEFINICE BUDOV Z PŮVODNÍ HRY
const STRUCTURE_DEFINITIONS = {
    mine: { name: 'Důl', income: { gold: 5 }, cost: 100, size: 2 },
    village: { name: 'Vesnice', on_capture: { units: 10 }, cost: 75, size: 3 },
    crystal_mine: { name: 'Krystalový důl', production: { crystals: 1 }, cost: 300, size: 2 },
    barracks: { name: 'Kasárny', production: { units: 1 }, upkeep: { gold: 2 }, cost: { gold: 150, crystals: 5 }, size: 3 },
    watchtower: { name: 'Strážní věž', effect: { attrition_reduction: 0.5, radius: 20 }, cost: { gold: 100, crystals: 0 }, size: 2 },
    trading_post: { name: 'Tržiště', cost: 150, size: 3 },
    ancient_library: { name: 'Prastará knihovna', on_capture: { reveal_radius: 25 }, cost: 250, size: 4 },
};

// --- HERNÍ LOGIKA ---
function generateGameCode() { return Math.random().toString(36).substring(2, 7).toUpperCase(); }

function initializeGame(game) {
    console.log(`Inicializace hry ${game.code}...`);
    game.status = 'running';
    game.gameBoard = Array.from({ length: GRID_SIZE }, (_, y) =>
        Array.from({ length: GRID_SIZE }, (_, x) => ({ x, y, ownerId: null, structureId: null }))
    );
    game.structures = new Map();
    game.expeditions = [];
    game.lastIncomeTick = Date.now();
    game.lastProductionTick = Date.now();

    const startPositions = [{ x: 50, y: 50 }, { x: GRID_SIZE - 50, y: GRID_SIZE - 50 }, { x: 50, y: GRID_SIZE - 50 }, { x: GRID_SIZE - 50, y: 50 }];

    game.players.forEach((player, index) => {
        player.color = PLAYER_COLORS[index % PLAYER_COLORS.length];
        player.gold = 500; player.crystals = 10; player.units = 20; player.territoryCount = 0;
        const pos = startPositions[index];
        createStructure(game, 'base', player.id, pos.x, pos.y, 6, { name: `Základna hráče ${player.name}` });
    });

    placeRandomStructures(game, 'mine', 15);
    placeRandomStructures(game, 'village', 15);
    placeRandomStructures(game, 'crystal_mine', 8);
    placeRandomStructures(game, 'trading_post', 5);
    placeRandomStructures(game, 'ancient_library', 3);

    io.to(game.code).emit('gameStarted', sanitizeGameState(game, true));
    console.log(`Hra ${game.code} připravena, startuji herní smyčku.`);
    game.gameInterval = setInterval(() => gameTick(game.code), TICK_RATE);
}

function gameTick(gameCode) {
    const game = games[gameCode];
    if (!game || game.status !== 'running') return;

    let boardChanges = handleExpeditions(game);
    
    if (Date.now() - game.lastIncomeTick > 1000) {
        handleResources(game, 'income');
        game.lastIncomeTick = Date.now();
    }
    if (Date.now() - game.lastProductionTick > 15000) {
        handleResources(game, 'production');
        game.lastProductionTick = Date.now();
    }

    const updatePacket = createUpdatePacket(game, boardChanges);
    if(updatePacket.boardChanges.length > 0 || game.players.some(p=>p.updated) || updatePacket.expeditions.length > 0) {
         io.to(gameCode).emit('gameStateUpdate', updatePacket);
    }
    game.players.forEach(p => p.updated = false);
}

function handleExpeditions(game) {
    let changes = new Map();
    let destroyedExpeditions = new Set();

    game.expeditions.forEach((exp, i) => {
        if(destroyedExpeditions.has(exp.id)) return;
        
        let attrition = 1.0;
        game.structures.forEach(s => {
            if(s.type.includes('watchtower') && s.ownerId === exp.ownerId) {
                const def = STRUCTURE_DEFINITIONS.watchtower;
                if(Math.hypot(exp.currentX - s.x, exp.currentY - s.y) <= def.effect.radius) {
                    attrition *= def.effect.attrition_reduction;
                }
            }
        });
        exp.unitsLeft -= 0.01 * attrition;

        exp.currentX += Math.sign(exp.targetX - exp.currentX);
        exp.currentY += Math.sign(exp.targetY - exp.currentY);
        const x = Math.floor(exp.currentX);
        const y = Math.floor(exp.currentY);

        if (x < 0 || x >= GRID_SIZE || y < 0 || y >= GRID_SIZE || exp.unitsLeft <= 0) {
            destroyedExpeditions.add(exp.id);
            return;
        }

        for(let j = i + 1; j < game.expeditions.length; j++) {
            const otherExp = game.expeditions[j];
            if(destroyedExpeditions.has(otherExp.id)) continue;
            if(Math.floor(otherExp.currentX) === x && Math.floor(otherExp.currentY) === y && otherExp.ownerId !== exp.ownerId) {
                const exp1Survived = exp.unitsLeft - otherExp.unitsLeft;
                const exp2Survived = otherExp.unitsLeft - exp.unitsLeft;
                exp.unitsLeft = Math.max(0, exp1Survived);
                otherExp.unitsLeft = Math.max(0, exp2Survived);
            }
        }
        
        const cell = game.gameBoard[y]?.[x];
        if (!cell) { destroyedExpeditions.add(exp.id); return; }

        if (cell.ownerId !== exp.ownerId) {
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
            changes.set(`${x},${y}`, {x, y, ownerId: exp.ownerId});
        }
        
        if (Math.abs(x-exp.targetX) < 2 && Math.abs(y-exp.targetY) < 2) {
             destroyedExpeditions.add(exp.id);
        }
    });

    game.expeditions = game.expeditions.filter(exp => !destroyedExpeditions.has(exp.id));
    return Array.from(changes.values());
}

function handleResources(game, type) {
    game.players.forEach(player => {
        let goldChange = 0, crystalChange = 0, unitChange = 0;
        if (type === 'income') goldChange += 5;

        game.structures.forEach(s => {
            if (s.ownerId === player.id) {
                const def = STRUCTURE_DEFINITIONS[s.type.replace('owned_', '')];
                if (!def) return;
                if (type === 'income' && def.income) {
                    goldChange += def.income.gold || 0;
                }
                if (type === 'production' && def.production) {
                    unitChange += def.production.units || 0;
                    crystalChange += def.production.crystals || 0;
                }
                if (type === 'income' && def.upkeep) {
                    goldChange -= def.upkeep.gold || 0;
                }
            }
        });
        player.gold += goldChange;
        player.crystals += crystalChange;
        player.units += unitChange;
        player.updated = true;
    });
}

function createStructure(game, type, ownerId, x, y, size, data) {
    const id = `${type}_${Date.now()}_${Math.random()}`;
    const newStructure = { id, type, ownerId, x, y, w: size, h: size, data };
    for (let i = y; i < y + size; i++) {
        for (let j = x; j < x + size; j++) {
            if (game.gameBoard[i]?.[j]) {
                game.gameBoard[i][j].structureId = id;
                if (ownerId) game.gameBoard[i][j].ownerId = ownerId;
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
            const x = Math.floor(Math.random() * (GRID_SIZE - def.size));
            const y = Math.floor(Math.random() * (GRID_SIZE - def.size));
            let areaClear = true;
            for (let dy = -5; dy < def.size + 5; dy++) {
                for (let dx = -5; dx < def.size + 5; dx++) {
                    if (game.gameBoard[y+dy]?.[x+dx]?.structureId) {
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
        players: game.players.filter(p => p.updated),
        boardChanges,
        expeditions: game.expeditions,
        structures: [], // Prozatím neposíláme změny struktur
    };
}

function sanitizeGameState(game, full = false) {
    const state = {
        code: game.code, status: game.status, players: game.players,
        structures: Array.from(game.structures.values()),
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