// --- START OF FILE server.js (Definitivní oprava) ---

const http = require('http');
const express = require('express');
const path = require('path');
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const PORT = process.env.PORT || 3000;

// --- KONFIGURACE HRY: AVALON ---
const GAME_CONFIG = {
    GRID_SIZE: 250,
    TICK_RATE: 50,
    PLAYER_COLORS: ['#4caf50', '#f44336', '#2196f3', '#ffc107', '#9c27b0', '#ff9800'],
    TERRAIN: {
        PLAINS: { name: 'Roviny', movement_cost: 1.0, buildable: true, color: '#a5d6a7' },
        FOREST: { name: 'Les', movement_cost: 1.5, buildable: false, color: '#388e3c' },
        MOUNTAIN: { name: 'Hory', movement_cost: 2.5, buildable: false, color: '#795548' }
    },
    INITIAL_RESOURCES: { gold: 200, food: 150, wood: 100, stone: 50, science: 0 },
    UNITS: {
        STAVITEL: { name: "Stavitel", hp: 50, speed: 1.8, cost: { gold: 50, food: 10 }, upkeep: { food: 0.1 }, can_build: true, attack: 2, range: 1, attack_speed: 0.5, vision: 8 },
        PECHOTA: { name: "Pěchota", hp: 100, speed: 1.5, cost: { gold: 25, food: 10 }, upkeep: { food: 0.2 }, attack: 10, range: 1, attack_speed: 1, vision: 7 },
        LUCISTNIK: { name: "Lučištník", hp: 70, speed: 1.6, cost: { gold: 35, wood: 20 }, upkeep: { food: 0.25 }, attack: 12, range: 6, attack_speed: 1.2, vision: 9 },
        JIZDA: { name: "Jízda", hp: 130, speed: 2.5, cost: { gold: 60, food: 20 }, upkeep: { food: 0.4 }, attack: 15, range: 1.2, attack_speed: 0.9, vision: 10 }
    },
    RPS_MODIFIERS: {
        PECHOTA: { JIZDA: 1.5, LUCISTNIK: 0.75 },
        LUCISTNIK: { PECHOTA: 1.5, JIZDA: 0.75 },
        JIZDA: { LUCISTNIK: 1.5, PECHOTA: 0.75 }
    },
    BUILDINGS: {
        ZAKLADNA: { name: 'Hlavní město', hp: 2000, cost: {}, build_time: 0, provides_pop: 10, trains: ['STAVITEL'], vision: 12 },
        DUM: { name: 'Dům', hp: 250, cost: { wood: 30 }, build_time: 8, provides_pop: 5, vision: 3 },
        FARMA: { name: 'Farma', hp: 300, cost: { wood: 50 }, build_time: 10, production: { food: 0.8 }, placement: 'PLAINS', vision: 3 },
        PILA: { name: 'Pila', hp: 300, cost: { wood: 60 }, build_time: 12, production: { wood: 0.5 }, placement: 'FOREST', vision: 3 },
        DUL: { name: 'Důl', hp: 400, cost: { wood: 80, stone: 20 }, build_time: 15, production: { gold: 0.25, stone: 0.1 }, placement: 'MOUNTAIN', vision: 3 },
        KASARNY: { name: 'Kasárny', hp: 700, cost: { wood: 100, stone: 50 }, build_time: 20, trains: ['PECHOTA'], vision: 4 },
        STRELNICE: { name: 'Střelnice', hp: 600, cost: { wood: 120 }, build_time: 25, trains: ['LUCISTNIK'], vision: 4 },
        STAJE: { name: 'Stáje', hp: 800, cost: { gold: 50, wood: 150 }, build_time: 30, trains: ['JIZDA'], vision: 4 },
        UNIVERZITA: { name: 'Univerzita', hp: 500, cost: { gold: 100, wood: 200 }, build_time: 40, production: { science: 0.5 }, vision: 4 }
    },
    TECH_TREE: {
        vylepsene_zemedelstvi: { name: 'Vylepšené zemědělství', cost: { science: 50 }, effect: { food_prod_modifier: 0.2 } },
        kovarstvi: { name: 'Kovářství', cost: { science: 100 }, effect: { unit_attack_modifier: 0.1 } },
        opevneni: { name: 'Opevnění', cost: { science: 75 }, effect: { building_hp_modifier: 0.2 } },
    }
};

const games = {};

const createId = (length = 5) => Math.random().toString(36).substr(2, length).toUpperCase();
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

const FOW_STATE = { HIDDEN: 0, EXPLORED: 1, VISIBLE: 2 };

function updateVisibility(game) {
    game.players.forEach(player => {
        const visibilityMap = game.visibilityMaps[player.id];
        const dirtyCells = [];

        for (let i = 0; i < visibilityMap.length; i++) {
            if (visibilityMap[i] === FOW_STATE.VISIBLE) {
                visibilityMap[i] = FOW_STATE.EXPLORED;
            }
        }

        const reveal = (x, y, range) => {
            const startX = Math.max(0, Math.floor(x - range));
            const endX = Math.min(game.board.length - 1, Math.floor(x + range));
            const startY = Math.max(0, Math.floor(y - range));
            const endY = Math.min(game.board.length - 1, Math.floor(y + range));

            for (let iy = startY; iy <= endY; iy++) {
                for (let ix = startX; ix <= endX; ix++) {
                    const distSq = (x - ix) ** 2 + (y - iy) ** 2;
                    if (distSq <= range ** 2) {
                        const index = iy * GAME_CONFIG.GRID_SIZE + ix;
                        if (visibilityMap[index] !== FOW_STATE.VISIBLE) {
                            visibilityMap[index] = FOW_STATE.VISIBLE;
                            dirtyCells.push({ x: ix, y: iy, state: FOW_STATE.VISIBLE });
                        }
                    }
                }
            }
        };

        Object.values(player.units).forEach(u => reveal(u.x, u.y, GAME_CONFIG.UNITS[u.type].vision));
        Object.values(game.buildings).filter(b => b.ownerId === player.id && b.buildProgress === 1).forEach(b => reveal(b.x + 1.5, b.y + 1.5, GAME_CONFIG.BUILDINGS[b.type].vision));

        if (dirtyCells.length > 0) {
            game.dirtyData.visibilityChanges[player.id] = (game.dirtyData.visibilityChanges[player.id] || []).concat(dirtyCells);
        }
    });
}

function gameTick(gameCode) {
    const game = games[gameCode];
    if (!game || game.status !== 'running') return;

    const now = Date.now();
    const deltaTime = (now - game.lastTickTime) / 1000.0;
    game.lastTickTime = now;

    game.dirtyData = {
        players: new Set(),
        units: new Set(),
        buildings: new Set(),
        events: [],
        visibilityChanges: {}
    };

    updateResourceProduction(game, deltaTime);
    updateBuildingConstruction(game, deltaTime);
    updateUnitTraining(game, deltaTime);
    updateUnitMovement(game, deltaTime);
    updateCombat(game, deltaTime);
    updateVisibility(game);

    game.players.forEach(player => {
        const socket = game.sockets.find(s => s.id === player.id);
        if (socket) {
            const packet = createPlayerUpdatePacket(game, player.id);
            if (Object.values(packet).some(val => Array.isArray(val) ? val.length > 0 : val !== undefined)) {
                socket.emit('gameStateUpdate', packet);
            }
        }
    });
}

function createPlayerUpdatePacket(game, playerId) {
    const playerVisibilityMap = game.visibilityMaps[playerId];
    const dirty = game.dirtyData;

    const isVisible = (x, y) => {
        const ix = Math.floor(x);
        const iy = Math.floor(y);
        if (ix < 0 || iy < 0 || ix >= GAME_CONFIG.GRID_SIZE || iy >= GAME_CONFIG.GRID_SIZE) return false;
        return playerVisibilityMap[iy * GAME_CONFIG.GRID_SIZE + ix] === FOW_STATE.VISIBLE;
    };
    
    const packet = {
        players: [],
        units: [],
        buildings: [],
        events: [],
        visibilityChanges: dirty.visibilityChanges[playerId] || []
    };

    dirty.players.forEach(id => {
        const p = game.players.find(pl => pl.id === id);
        if (p && id === playerId) {
            packet.players.push({
                id: p.id,
                resources: p.resources,
                pop: p.pop,
                techs: Array.from(p.techs)
            });
        }
    });

    Object.values(game.units).forEach(u => {
        if (isVisible(u.x, u.y)) {
             packet.units.push({ id: u.id, ownerId: u.ownerId, type: u.type, x: u.x, y: u.y, hp: u.hp, maxHp: u.maxHp, moveTarget: u.moveTarget });
        }
    });

    Object.values(game.buildings).forEach(b => {
         if (isVisible(b.x + 1.5, b.y + 1.5)) {
            packet.buildings.push({ id: b.id, ownerId: b.ownerId, type: b.type, x: b.x, y: b.y, hp: b.hp, maxHp: b.maxHp, buildProgress: b.buildProgress, trainingQueue: b.trainingQueue.map(i => ({unitType: i.unitType, progress: i.progress})) });
        }
    });
    
    packet.events = dirty.events.filter(e => {
        if(e.type === 'UNITS_DIED') return true;
        const pos = e.pos || e.to;
        return pos && isVisible(pos.x, pos.y);
    });

    return packet;
}

function updateResourceProduction(game, deltaTime) {
    game.players.forEach(p => {
        const production = { gold: 0, food: 0, wood: 0, stone: 0, science: 0 };
        const upkeep = { food: 0 };
        Object.values(game.buildings).filter(b => b.ownerId === p.id && b.buildProgress === 1).forEach(b => {
            const b_config = GAME_CONFIG.BUILDINGS[b.type];
            if (b_config.production) {
                for (const res in b_config.production) {
                    production[res] += b_config.production[res];
                }
            }
        });
        if (p.techs.has('vylepsene_zemedelstvi')) production.food *= (1 + GAME_CONFIG.TECH_TREE.vylepsene_zemedelstvi.effect.food_prod_modifier);
        Object.values(p.units).forEach(u => upkeep.food += GAME_CONFIG.UNITS[u.type].upkeep.food || 0);
        p.resources.gold += production.gold * deltaTime;
        p.resources.food += (production.food - upkeep.food) * deltaTime;
        p.resources.wood += production.wood * deltaTime;
        p.resources.stone += production.stone * deltaTime;
        p.resources.science += production.science * deltaTime;
        if (p.resources.food < 0) p.resources.food = 0;
        game.dirtyData.players.add(p.id);
    });
}

function updateBuildingConstruction(game, deltaTime) {
    Object.values(game.buildings).forEach(b => {
        if (b.buildProgress < 1) {
            b.buildProgress += deltaTime / b.buildTime;
            if (b.buildProgress >= 1) {
                b.buildProgress = 1;
                b.hp = GAME_CONFIG.BUILDINGS[b.type].hp;
                game.dirtyData.events.push({ type: 'SFX', name: 'construction_complete', pos: {x: b.x, y: b.y} });
                const owner = game.players.find(p => p.id === b.ownerId);
                if (owner && GAME_CONFIG.BUILDINGS[b.type].provides_pop) {
                    calculatePlayerPopCap(owner, game);
                    game.dirtyData.players.add(owner.id);
                }
            }
            game.dirtyData.buildings.add(b.id);
        }
    });
}

function updateUnitTraining(game, deltaTime) {
    Object.values(game.buildings).forEach(b => {
        if (b.trainingQueue.length > 0) {
            const item = b.trainingQueue[0];
            item.progress += deltaTime / item.buildTime;
            if (item.progress >= 1) {
                b.trainingQueue.shift();
                const owner = game.players.find(p => p.id === b.ownerId);
                if (owner && owner.pop.current < owner.pop.cap) {
                    const rallyPoint = b.rallyPoint || { x: b.x + 2, y: b.y + 2 };
                    createUnit(game, owner, item.unitType, rallyPoint);
                    calculatePlayerPop(owner);
                    game.dirtyData.players.add(owner.id);
                    game.dirtyData.events.push({ type: 'SFX', name: 'unit_trained', pos: {x: b.x, y: b.y} });
                }
            }
            game.dirtyData.buildings.add(b.id);
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
        const unitConf = GAME_CONFIG.UNITS[u.type];
        const speedModifier = 1 / (GAME_CONFIG.TERRAIN[terrainType]?.movement_cost || 1);
        const speed = unitConf.speed * speedModifier;
        u.x += (dx / dist) * speed * deltaTime;
        u.y += (dy / dist) * speed * deltaTime;
        game.dirtyData.units.add(u.id);
    });
}

function updateCombat(game, deltaTime) {
    const deadUnits = new Set();
    const allUnits = Object.values(game.units);

    allUnits.forEach(u => {
        if (deadUnits.has(u.id)) return;
        const u_conf = GAME_CONFIG.UNITS[u.type];
        if (u.attackCooldown > 0) u.attackCooldown -= deltaTime;

        let target = u.targetUnitId ? game.units[u.targetUnitId] : null;
        if (!target || deadUnits.has(target.id)) {
            u.targetUnitId = null;
            let closestEnemy = null;
            let min_dist_sq = (u_conf.vision)**2;
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
            if (distSq <= u_conf.range**2) {
                u.moveTarget = null;
                if (u.attackCooldown <= 0) {
                    const t_conf = GAME_CONFIG.UNITS[target.type];
                    const modifier = GAME_CONFIG.RPS_MODIFIERS[u.type]?.[target.type] || 1;
                    const damage = u_conf.attack * modifier;
                    target.hp -= damage;
                    game.dirtyData.events.push({ type: 'ATTACK_EFFECT', from: {x: u.x, y: u.y}, to: {x: target.x, y: target.y}, unitType: u.type });
                    game.dirtyData.units.add(target.id);
                    u.attackCooldown = 1 / u_conf.attack_speed;
                    if (target.hp <= 0) deadUnits.add(target.id);
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
                if (owner) {
                    delete owner.units[deadId];
                    calculatePlayerPop(owner);
                    game.dirtyData.players.add(owner.id);
                }
                delete game.units[deadId];
            }
        });
        game.dirtyData.events.push({ type: 'UNITS_DIED', ids: Array.from(deadUnits) });
    }
}

function createUnit(game, player, unitType, pos) {
    const u_config = GAME_CONFIG.UNITS[unitType];
    const newUnit = {
        id: createId(), ownerId: player.id, type: unitType, x: pos.x, y: pos.y,
        hp: u_config.hp, maxHp: u_config.hp,
        attackCooldown: 0, moveTarget: null, targetUnitId: null, can_build: u_config.can_build || false
    };
    game.units[newUnit.id] = newUnit;
    player.units[newUnit.id] = newUnit;
    return newUnit;
}

function handlePlayerAction(socket, action) {
    const game = games[socket.gameCode];
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
                const terrainType = game.board[Math.floor(position.y)]?.[Math.floor(position.x)];
                if (config.placement && config.placement !== terrainType) {
                    socket.emit('gameError', { message: `Nelze postavit ${config.name} na tomto terénu.` });
                    return;
                }
                
                deductCost(pData, config.cost);
                const newBuilding = {
                    id: createId(), ownerId: pData.id, type: structureType,
                    x: position.x, y: position.y, hp: 1, maxHp: config.hp,
                    buildProgress: 0, buildTime: config.build_time,
                    trainingQueue: [], rallyPoint: {x: position.x + 3, y: position.y + 3},
                };
                game.buildings[newBuilding.id] = newBuilding;
                builder.moveTarget = position;
                game.dirtyData.players.add(pData.id);
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
                    building.trainingQueue.push({ unitType, buildTime: unitConfig.cost.gold / 2.5, progress: 0 });
                    game.dirtyData.players.add(pData.id);
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
                game.dirtyData.players.add(pData.id);
            }
            break;
        }
    }
}

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
    game.visibilityMaps = {};

    const startPositions = [
        { x: 30, y: 30 }, { x: GAME_CONFIG.GRID_SIZE - 30, y: GAME_CONFIG.GRID_SIZE - 30 },
        { x: 30, y: GAME_CONFIG.GRID_SIZE - 30 }, { x: GAME_CONFIG.GRID_SIZE - 30, y: 30 }
    ];

    game.players.forEach((player, index) => {
        game.visibilityMaps[player.id] = new Uint8Array(GAME_CONFIG.GRID_SIZE * GAME_CONFIG.GRID_SIZE).fill(FOW_STATE.HIDDEN);
        const pos = startPositions[index % startPositions.length];
        player.startPos = pos;
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
        
        createUnit(game, player, 'STAVITEL', {x: pos.x + 3, y: pos.y});
        createUnit(game, player, 'PECHOTA', {x: pos.x - 3, y: pos.y});
        createUnit(game, player, 'PECHOTA', {x: pos.x, y: pos.y + 3});
        calculatePlayerPopCap(player, game);
        calculatePlayerPop(player);
    });

    const initialPacket = {
        gameCode: game.code,
        config: { GRID_SIZE: GAME_CONFIG.GRID_SIZE, TERRAIN: GAME_CONFIG.TERRAIN, UNITS: GAME_CONFIG.UNITS, BUILDINGS: GAME_CONFIG.BUILDINGS },
        players: game.players.map(p => ({ id: p.id, name: p.name, color: p.color, startPos: p.startPos })),
        board: game.board,
    };
    
    io.to(game.code).emit('gameStarted', initialPacket);
    game.gameInterval = setInterval(() => gameTick(game.code), GAME_CONFIG.TICK_RATE);
}

io.on('connection', (socket) => {
    socket.playerInfo = { id: socket.id, name: 'Anonym' };

    const leaveLobby = (gameCode) => {
        const game = games[gameCode];
        if (!game) return;
        socket.leave(gameCode);
        game.sockets = game.sockets.filter(s => s.id !== socket.id);
        const playerIndex = game.players.findIndex(p => p.id === socket.id);
        if (playerIndex > -1) game.players.splice(playerIndex, 1);
        if (game.players.length === 0 && game.status === 'lobby') {
            delete games[gameCode];
        } else {
            if (socket.id === game.hostId && game.players.length > 0) {
                game.hostId = game.players[0].id;
            }
            io.to(gameCode).emit('lobbyUpdate', { players: game.players, hostId: game.hostId });
        }
    };

    socket.on('setPlayerName', name => socket.playerInfo.name = name.substring(0, 20));

    const createLobby = (isPrivate, isSolo = false) => {
        const gameCode = createId();
        const game = {
            code: gameCode, status: 'lobby', isPrivate: isPrivate,
            sockets: [socket], players: [socket.playerInfo], hostId: socket.id,
            gameInterval: null
        };
        games[gameCode] = game;
        socket.join(gameCode);
        socket.gameCode = gameCode;
        socket.emit('lobbyJoined', { gameCode: game.code, players: game.players, hostId: game.hostId });
        if (isSolo) {
            initializeGame(game);
        }
    };

    socket.on('createPrivateLobby', () => createLobby(true));
    socket.on('createSoloGame', () => createLobby(true, true));

    socket.on('joinLobby', (gameCode) => {
        const game = games[gameCode];
        if (game && game.status === 'lobby') {
            if (game.players.some(p => p.id === socket.id)) return;
            if (game.players.length >= GAME_CONFIG.PLAYER_COLORS.length) {
                return socket.emit('gameError', { message: 'Lobby je plné.' });
            }
            socket.join(gameCode);
            socket.gameCode = gameCode;
            game.sockets.push(socket);
            game.players.push(socket.playerInfo);
            socket.emit('lobbyJoined', { gameCode: game.code, players: game.players, hostId: game.hostId });
            io.to(gameCode).emit('lobbyUpdate', { players: game.players, hostId: game.hostId });
        } else {
            socket.emit('gameError', { message: 'Lobby neexistuje nebo hra již běží.' });
        }
    });

    socket.on('findPublicLobby', () => {
        let availableLobby = Object.values(games).find(g => !g.isPrivate && g.status === 'lobby' && g.players.length < GAME_CONFIG.PLAYER_COLORS.length);
        if (availableLobby) {
            socket.emit('joinLobby', availableLobby.code);
        } else {
            createLobby(false);
        }
    });
    
    socket.on('startGame', (gameCode) => {
        const game = games[gameCode];
        if (game && game.hostId === socket.id && game.status === 'lobby') {
            initializeGame(game);
        }
    });

    socket.on('playerAction', (action) => handlePlayerAction(socket, action));

    socket.on('disconnect', () => {
        if (socket.gameCode) {
            const game = games[socket.gameCode];
            if(game) {
                if(game.status === 'running') {
                    clearInterval(game.gameInterval);
                    io.to(game.code).emit('gameOver', { reason: `${socket.playerInfo.name} opustil bojiště.` });
                    delete games[socket.gameCode];
                } else {
                    leaveLobby(socket.gameCode);
                }
            }
        }
    });
});

app.use(express.static(path.join(__dirname, 'public')));
server.listen(PORT, () => console.log(`Server Avalon běží na portu ${PORT}`));

// --- END OF FILE server.js (Definitivní oprava) ---