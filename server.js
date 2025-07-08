// --- START OF FILE server.js (Opraveno) ---

const http = require('http');
const express = require('express');
const path = require('path');
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const PORT = process.env.PORT || 3000;

// --- KONFIGURACE HRY: AVALON - FÁZE 2 & 3 ---
const GAME_CONFIG = {
    GRID_SIZE: 250, // Zmenšeno pro svižnější start
    TICK_RATE: 50, // 20 ticků/s
    PLAYER_COLORS: ['#4caf50', '#f44336', '#2196f3', '#ffc107'], // Výraznější barvy
    // Terén
    TERRAIN: {
        PLAINS: { name: 'Roviny', movement_cost: 1.0, buildable: true, color: '#a5d6a7' },
        FOREST: { name: 'Les', movement_cost: 1.5, buildable: false, color: '#388e3c', resources: { wood: 0.1 } },
        MOUNTAIN: { name: 'Hory', movement_cost: 2.5, buildable: false, color: '#795548', resources: { stone: 0.05, gold: 0.01 } }
    },
    // Zdroje a Ekonomika
    INITIAL_RESOURCES: { gold: 200, food: 150, wood: 100, stone: 50, science: 0 },
    // Jednotky
    UNITS: {
        STAVITEL: { name: "Stavitel", hp: 50, speed: 1.8, cost: { gold: 50, food: 10 }, upkeep: { food: 0.1 }, can_build: true, attack: 2, range: 1, attack_speed: 0.5 },
        PECHOTA: { name: "Pěchota", hp: 100, speed: 1.5, cost: { gold: 25, food: 10 }, upkeep: { food: 0.2 }, attack: 10, range: 1, attack_speed: 1 },
        LUCISTNIK: { name: "Lučištník", hp: 70, speed: 1.6, cost: { gold: 35, wood: 20 }, upkeep: { food: 0.25 }, attack: 12, range: 6, attack_speed: 1.2 },
        JIZDA: { name: "Jízda", hp: 130, speed: 2.5, cost: { gold: 60, food: 20 }, upkeep: { food: 0.4 }, attack: 15, range: 1.2, attack_speed: 0.9 }
    },
    // Bojový systém Rock-Paper-Scissors (útočník vs obránce => násobič poškození)
    RPS_MODIFIERS: {
        PECHOTA: { default: 1, JIZDA: 1.5, LUCISTNIK: 0.75 },
        LUCISTNIK: { default: 1, PECHOTA: 1.5, JIZDA: 0.75 },
        JIZDA: { default: 1, LUCISTNIK: 1.5, PECHOTA: 0.75 }
    },
    // Budovy
    BUILDINGS: {
        ZAKLADNA: { name: 'Hlavní město', hp: 2000, cost: {}, build_time: 0, provides_pop: 10, trains: ['STAVITEL'] },
        DUM: { name: 'Dům', hp: 250, cost: { wood: 30 }, build_time: 8, provides_pop: 5 },
        FARMA: { name: 'Farma', hp: 300, cost: { wood: 50 }, build_time: 10, production: { food: 0.8 }, placement: 'PLAINS' },
        PILA: { name: 'Pila', hp: 300, cost: { wood: 60 }, build_time: 12, production: { wood: 0.5 }, placement: 'FOREST' }, // Pila musí být u lesa
        DUL: { name: 'Důl', hp: 400, cost: { wood: 80, stone: 20 }, build_time: 15, production: { gold: 0.25, stone: 0.1 }, placement: 'MOUNTAIN' }, // Důl u hor
        KASARNY: { name: 'Kasárny', hp: 700, cost: { wood: 100, stone: 50 }, build_time: 20, trains: ['PECHOTA'] },
        STRELNICE: { name: 'Střelnice', hp: 600, cost: { wood: 120 }, build_time: 25, trains: ['LUCISTNIK'] },
        STAJE: { name: 'Stáje', hp: 800, cost: { gold: 50, wood: 150 }, build_time: 30, trains: ['JIZDA'] },
        UNIVERZITA: { name: 'Univerzita', hp: 500, cost: { gold: 100, wood: 200 }, build_time: 40, production: { science: 0.5 } }
    },
    // Technologie
    TECH_TREE: {
        vylepsene_zemedelstvi: { name: 'Vylepšené zemědělství', cost: { science: 50 }, effect: { food_prod_modifier: 0.2 } },
        kovarstvi: { name: 'Kovářství', cost: { science: 100 }, effect: { unit_attack_modifier: 0.1 } },
        opevneni: { name: 'Opevnění', cost: { science: 75 }, effect: { building_hp_modifier: 0.2 } },
    }
};

// --- HERNÍ STAV ---
const games = {};
let waitingPlayers = [];

// --- POMOCNÉ FUNKCE ---
const createId = () => `id_${Math.random().toString(36).substr(2, 9)}`;
const canAfford = (player, cost) => Object.keys(cost).every(res => player.resources[res] >= cost[res]);
const deductCost = (player, cost) => Object.keys(cost).forEach(res => player.resources[res] -= cost[res]);
const calculatePlayerPop = (player) => {
    player.pop.current = Object.keys(player.units).length;
};
const calculatePlayerPopCap = (player, game) => {
    player.pop.cap = Object.values(game.buildings)
        .filter(b => b.ownerId === player.id && b.buildProgress === 1 && GAME_CONFIG.BUILDINGS[b.type].provides_pop)
        .reduce((sum, b) => sum + GAME_CONFIG.BUILDINGS[b.type].provides_pop, 0);
};

// --- HLAVNÍ HERNÍ SMYČKA ---
function gameTick(gameCode) {
    const game = games[gameCode];
    if (!game || game.status !== 'running') return;

    const now = Date.now();
    const deltaTime = (now - game.lastTickTime) / 1000.0;
    game.lastTickTime = now;

    const dirtyData = {
        players: new Set(),
        units: new Set(),
        buildings: new Set(),
        boardChanges: [],
        events: []
    };

    updateResourceProduction(game, deltaTime, dirtyData);
    updateBuildingConstruction(game, deltaTime, dirtyData);
    updateUnitTraining(game, deltaTime, dirtyData);
    updateUnitMovement(game, deltaTime);
    updateCombat(game, deltaTime, dirtyData);
    
    // Sestavení a odeslání delta-update
    const updatePacket = createUpdatePacket(game, dirtyData);
    if (Object.values(updatePacket).some(arr => Array.isArray(arr) && arr.length > 0)) {
       io.to(gameCode).emit('gameStateUpdate', updatePacket);
    }
}

// --- MODULY HERNÍ LOGIKY ---

function updateResourceProduction(game, deltaTime, dirtyData) {
    game.players.forEach(p => {
        const production = { gold: 0, food: 0, wood: 0, stone: 0, science: 0 };
        const upkeep = { food: 0 };

        // Produkce z budov
        Object.values(game.buildings).filter(b => b.ownerId === p.id && b.buildProgress === 1).forEach(b => {
            const b_config = GAME_CONFIG.BUILDINGS[b.type];
            if (b_config.production) {
                for (const res in b_config.production) {
                    production[res] += b_config.production[res];
                }
            }
        });
        
        // Aplikace technologií
        if (p.techs.has('vylepsene_zemedelstvi')) production.food *= (1 + GAME_CONFIG.TECH_TREE.vylepsene_zemedelstvi.effect.food_prod_modifier);
        
        // Údržba jednotek
        Object.values(p.units).forEach(u => upkeep.food += GAME_CONFIG.UNITS[u.type].upkeep.food || 0);

        // Aplikace změn
        p.resources.gold += production.gold * deltaTime;
        p.resources.food += (production.food - upkeep.food) * deltaTime;
        p.resources.wood += production.wood * deltaTime;
        p.resources.stone += production.stone * deltaTime;
        p.resources.science += production.science * deltaTime;

        if (p.resources.food < 0) {
            p.resources.food = 0; // TODO: Hladovění - poškození jednotek
        }
        
        dirtyData.players.add(p.id);
    });
}

function updateBuildingConstruction(game, deltaTime, dirtyData) {
    Object.values(game.buildings).forEach(b => {
        if (b.buildProgress < 1) {
            b.buildProgress += deltaTime / b.buildTime;
            if (b.buildProgress >= 1) {
                b.buildProgress = 1;
                b.hp = GAME_CONFIG.BUILDINGS[b.type].hp; // Plné HP po dokončení
                dirtyData.events.push({ type: 'SFX', name: 'construction_complete', pos: {x: b.x, y: b.y} });
                
                const owner = game.players.find(p => p.id === b.ownerId);
                if (owner && GAME_CONFIG.BUILDINGS[b.type].provides_pop) {
                    calculatePlayerPopCap(owner, game);
                    dirtyData.players.add(owner.id);
                }
            }
            dirtyData.buildings.add(b.id);
        }
    });
}

function updateUnitTraining(game, deltaTime, dirtyData) {
    Object.values(game.buildings).forEach(b => {
        if (b.trainingQueue.length > 0) {
            const item = b.trainingQueue[0];
            item.progress += deltaTime / item.buildTime;
            if (item.progress >= 1) {
                b.trainingQueue.shift();
                const owner = game.players.find(p => p.id === b.ownerId);
                if (owner && owner.pop.current < owner.pop.cap) {
                    const rallyPoint = b.rallyPoint || { x: b.x + 2, y: b.y + 2 };
                    createUnit(game, owner, item.unitType, rallyPoint, dirtyData);
                    calculatePlayerPop(owner);
                    dirtyData.players.add(owner.id);
                    dirtyData.events.push({ type: 'SFX', name: 'unit_trained', pos: {x: b.x, y: b.y} });
                }
            }
            dirtyData.buildings.add(b.id);
        }
    });
}

function updateUnitMovement(game, deltaTime) {
    Object.values(game.units).forEach(u => {
        if (!u.moveTarget) return;

        const dx = u.moveTarget.x - u.x;
        const dy = u.moveTarget.y - u.y;
        const dist = Math.hypot(dx, dy);

        if (dist < 0.5) {
            u.moveTarget = null;
            return;
        }
        
        const gridX = Math.floor(u.x);
        const gridY = Math.floor(u.y);
        const terrainType = game.board[gridY]?.[gridX] || 'PLAINS';
        const speedModifier = 1 / (GAME_CONFIG.TERRAIN[terrainType].movement_cost || 1);
        const speed = u.speed * speedModifier;

        u.x += (dx / dist) * speed * deltaTime;
        u.y += (dy / dist) * speed * deltaTime;
    });
}

function updateCombat(game, deltaTime, dirtyData) {
    const deadUnits = new Set();
    const allUnits = Object.values(game.units);

    allUnits.forEach(u => {
        if (deadUnits.has(u.id)) return;

        if (u.attackCooldown > 0) u.attackCooldown -= deltaTime;

        let target = u.targetUnitId ? game.units[u.targetUnitId] : null;
        if (!target || deadUnits.has(target.id)) {
            u.targetUnitId = null;
            let closestEnemy = null;
            let min_dist_sq = (u.range + 5)**2; // Aggro range
            allUnits.forEach(potentialTarget => {
                if (potentialTarget.ownerId !== u.ownerId && !deadUnits.has(potentialTarget.id)) {
                    const dist_sq = (u.x - potentialTarget.x)**2 + (u.y - potentialTarget.y)**2;
                    if (dist_sq < min_dist_sq) {
                        min_dist_sq = dist_sq;
                        closestEnemy = potentialTarget;
                    }
                }
            });
            if (closestEnemy) u.targetUnitId = closestEnemy.id;
            target = closestEnemy;
        }
        
        if (target) {
            const distSq = (u.x - target.x)**2 + (u.y - target.y)**2;
            if (distSq <= u.range**2) {
                u.moveTarget = null;
                if (u.attackCooldown <= 0) {
                    const modifier = GAME_CONFIG.RPS_MODIFIERS[u.type]?.[target.type] || 1;
                    const damage = u.attack * modifier;
                    target.hp -= damage;
                    
                    dirtyData.events.push({ type: 'ATTACK_EFFECT', from: {x: u.x, y: u.y}, to: {x: target.x, y: target.y}, unitType: u.type });
                    dirtyData.units.add(target.id);
                    
                    u.attackCooldown = 1 / u.attackSpeed;

                    if (target.hp <= 0) {
                        deadUnits.add(target.id);
                    }
                }
            } else { 
                u.moveTarget = { x: target.x, y: target.y };
            }
        }
    });

    if (deadUnits.size > 0) {
        deadUnits.forEach(deadId => {
            const deadUnit = game.units[deadId];
            if (deadUnit) {
                const owner = game.players.find(p => p.id === deadUnit.ownerId);
                delete owner.units[deadId];
                delete game.units[deadId];
                calculatePlayerPop(owner);
                dirtyData.players.add(owner.id);
            }
        });
        dirtyData.events.push({ type: 'UNITS_DIED', ids: Array.from(deadUnits) });
    }
}

function createUnit(game, player, unitType, pos, dirtyData) {
    const u_config = GAME_CONFIG.UNITS[unitType];
    const newUnit = {
        id: createId(),
        ownerId: player.id,
        type: unitType,
        x: pos.x, y: pos.y,
        hp: u_config.hp, maxHp: u_config.hp,
        speed: u_config.speed, attack: u_config.attack, range: u_config.range, attackSpeed: u_config.attack_speed,
        attackCooldown: 0,
        moveTarget: null, targetUnitId: null,
        can_build: u_config.can_build || false
    };
    game.units[newUnit.id] = newUnit;
    player.units[newUnit.id] = newUnit;
    dirtyData.events.push({type: 'UNIT_CREATED', data: newUnit});
    return newUnit;
}

function createUpdatePacket(game, dirtyData) {
    const packet = {
        players: [],
        units: [],
        buildings: [],
        events: dirtyData.events || []
    };

    dirtyData.players.forEach(id => {
        const p = game.players.find(pl => pl.id === id);
        if (p) {
            packet.players.push({
                id: p.id,
                resources: p.resources,
                pop: p.pop,
                techs: Array.from(p.techs)
            });
        }
    });

    Object.values(game.units).forEach(u => {
        packet.units.push({ id: u.id, ownerId: u.ownerId, type: u.type, x: u.x, y: u.y, hp: u.hp, maxHp: u.maxHp, moveTarget: u.moveTarget });
    });
    
    dirtyData.buildings.forEach(id => {
        const b = game.buildings[id];
        if (b) {
            packet.buildings.push({ id: b.id, hp: b.hp, maxHp: b.maxHp, buildProgress: b.buildProgress, trainingQueue: b.trainingQueue.map(i => ({unitType: i.unitType, progress: i.progress})) });
        }
    });

    return packet;
}

// --- LOGIKA AKCÍ HRÁČE ---
function handlePlayerAction(socket, action) {
    const playerSocket = waitingPlayers.find(p => p.id === socket.id) || Object.values(games).flatMap(g => g.sockets).find(s => s.id === socket.id);
    if (!playerSocket || !playerSocket.gameCode) return;

    const game = games[playerSocket.gameCode];
    if (!game || game.status !== 'running') return;
    const pData = game.players.find(p => p.id === socket.id);
    if (!pData) return;

    switch (action.type) {
        case 'MOVE_UNITS': {
            const { unitIds, target } = action.payload;
            unitIds.forEach(id => {
                const unit = pData.units[id];
                if (unit) {
                    unit.moveTarget = target;
                    unit.targetUnitId = null;
                }
            });
            break;
        }
        case 'ATTACK_TARGET': {
            const { unitIds, targetId } = action.payload;
             unitIds.forEach(id => {
                 const unit = pData.units[id];
                 if(unit && game.units[targetId]) {
                    unit.targetUnitId = targetId;
                 }
            });
            break;
        }
        case 'BUILD_STRUCTURE': {
            const { builderId, structureType, position } = action.payload;
            const builder = pData.units[builderId];
            const config = GAME_CONFIG.BUILDINGS[structureType];

            if (builder && builder.can_build && config && canAfford(pData, config.cost)) {
                // Check placement rules
                const terrainType = game.board[Math.floor(position.y)][Math.floor(position.x)];
                if (config.placement && config.placement !== terrainType) {
                    socket.emit('gameError', { message: `Nelze postavit ${config.name} zde.` });
                    return;
                }
                
                deductCost(pData, config.cost);
                const newBuilding = {
                    id: createId(),
                    ownerId: pData.id,
                    type: structureType,
                    x: position.x, y: position.y,
                    hp: 1, maxHp: config.hp,
                    buildProgress: 0,
                    buildTime: config.build_time,
                    trainingQueue: [],
                    rallyPoint: {x: position.x + 3, y: position.y + 3},
                };
                game.buildings[newBuilding.id] = newBuilding;
                game.dirty.events.push({ type: 'BUILDING_CREATED', data: newBuilding });
                builder.moveTarget = position;
                io.to(game.code).emit('gameStateUpdate', { events: [{ type: 'BUILDING_CREATED', data: newBuilding }] });
            }
            break;
        }
        case 'TRAIN_UNIT': {
            const { buildingId, unitType } = action.payload;
            const building = game.buildings[buildingId];
            const unitConfig = GAME_CONFIG.UNITS[unitType];
            if (building && building.ownerId === pData.id && unitConfig && canAfford(pData, unitConfig.cost) && (pData.pop.current < pData.pop.cap)) {
                if(building.trainingQueue.length < 5) {
                    deductCost(pData, unitConfig.cost);
                    building.trainingQueue.push({ unitType, buildTime: unitConfig.cost.gold / 2, progress: 0 }); // Zjednodušený čas
                }
            }
            break;
        }
        case 'RESEARCH_TECH': {
            const { techId } = action.payload;
            const techConfig = GAME_CONFIG.TECH_TREE[techId];
            if (techConfig && !pData.techs.has(techId) && canAfford(pData, techConfig.cost)) {
                deductCost(pData, techConfig.cost);
                pData.techs.add(techId);
            }
            break;
        }
    }
}

// --- LOBBY A INICIALIZACE ---
function generateMap(size) {
    let board = Array.from({ length: size }, () => Array(size));
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) board[y][x] = 'PLAINS';
    
    const placeFeature = (type, count, minR, maxR) => {
        for(let i=0; i<count; i++) {
            const cx = Math.random() * size; const cy = Math.random() * size; const r = minR + Math.random() * (maxR - minR);
            for(let y = Math.max(0, Math.floor(cy-r)); y<Math.min(size, Math.ceil(cy+r)); y++) {
                for(let x = Math.max(0, Math.floor(cx-r)); x<Math.min(size, Math.ceil(cx+r)); x++) {
                    if(Math.hypot(x-cx, y-cy) < r) board[y][x] = type;
                }
            }
        }
    };
    placeFeature('FOREST', 20, 8, 15);
    placeFeature('MOUNTAIN', 12, 6, 12);
    return board;
}

function initializeGame(game) {
    console.log(`Initializing game ${game.code}...`);
    game.status = 'running';
    game.board = generateMap(GAME_CONFIG.GRID_SIZE);
    game.units = {};
    game.buildings = {};
    game.lastTickTime = Date.now();

    const startPositions = [
        { x: 30, y: 30 }, { x: GAME_CONFIG.GRID_SIZE - 30, y: GAME_CONFIG.GRID_SIZE - 30 },
        { x: 30, y: GAME_CONFIG.GRID_SIZE - 30 }, { x: GAME_CONFIG.GRID_SIZE - 30, y: 30 }
    ];

    game.players.forEach((player, index) => {
        const pos = startPositions[index];
        player.resources = { ...GAME_CONFIG.INITIAL_RESOURCES };
        player.units = {};
        player.pop = { current: 0, cap: 0 };
        player.techs = new Set();
        player.color = GAME_CONFIG.PLAYER_COLORS[index];

        const base = {
            id: createId(), ownerId: player.id, type: 'ZAKLADNA',
            x: pos.x, y: pos.y, hp: GAME_CONFIG.BUILDINGS.ZAKLADNA.hp, maxHp: GAME_CONFIG.BUILDINGS.ZAKLADNA.hp,
            buildProgress: 1, buildTime: 0, trainingQueue: [], rallyPoint: {x:pos.x+3, y:pos.y+3}
        };
        game.buildings[base.id] = base;
        
        calculatePlayerPopCap(player, game);
        
        const dummyDirtyData = { events: [] }; // Potřeba pro createUnit
        createUnit(game, player, 'STAVITEL', {x: pos.x + 3, y: pos.y}, dummyDirtyData);
        createUnit(game, player, 'PECHOTA', {x: pos.x - 3, y: pos.y}, dummyDirtyData);
        createUnit(game, player, 'PECHOTA', {x: pos.x, y: pos.y + 3}, dummyDirtyData);
        calculatePlayerPop(player);
    });

    const initialPacket = {
        config: { GRID_SIZE: GAME_CONFIG.GRID_SIZE, TERRAIN: GAME_CONFIG.TERRAIN, UNITS: GAME_CONFIG.UNITS, BUILDINGS: GAME_CONFIG.BUILDINGS },
        players: game.players.map(p => ({ id: p.id, name: p.name, color: p.color })),
        initialBoard: game.board,
        initialUnits: Object.values(game.units),
        initialBuildings: Object.values(game.buildings)
    };
    
    game.sockets.forEach(s => s.join(game.code));
    io.to(game.code).emit('gameStarted', initialPacket);
    game.gameInterval = setInterval(() => gameTick(game.code), GAME_CONFIG.TICK_RATE);
}

// --- SOCKET.IO HANDLERY ---
io.on('connection', (socket) => {
    console.log('A user connected:', socket.id);
    socket.on('findGame', (playerName) => {
        socket.playerName = playerName;
        waitingPlayers.push(socket);
        
        waitingPlayers.forEach(p => {
             p.emit('lobbyUpdate', waitingPlayers.map(pl => ({id: pl.id, name: pl.playerName})));
        });

        // Spustit hru pro 2 hráče
        if (waitingPlayers.length >= 2) {
            const gamePlayers = waitingPlayers.splice(0, 2);
            const gameCode = `avalon_${createId()}`;
            const newGame = {
                code: gameCode,
                status: 'starting',
                sockets: gamePlayers,
                players: gamePlayers.map(p => ({id: p.id, name: p.playerName})),
            };
            games[gameCode] = newGame;
            gamePlayers.forEach(p => p.gameCode = gameCode);
            
            initializeGame(newGame);
        }
    });

    socket.on('playerAction', (action) => handlePlayerAction(socket, action));

    socket.on('disconnect', () => {
        console.log('User disconnected:', socket.id);
        waitingPlayers = waitingPlayers.filter(p => p.id !== socket.id);
        
        const game = games[socket.gameCode];
        if (game) {
            // Jednoduchá logika, ukončíme hru pokud se někdo odpojí
            clearInterval(game.gameInterval);
            io.to(game.code).emit('gameOver', { reason: 'Jeden z velitelů opustil bojiště.' });
            delete games[socket.gameCode];
        }
    });
});

// ZMĚNA ZDE: Cesta je nyní správně do složky 'public'
app.use(express.static(path.join(__dirname, 'public')));

server.listen(PORT, () => console.log(`Server Avalon běží na portu ${PORT}`));

// --- END OF FILE server.js (Opraveno) ---