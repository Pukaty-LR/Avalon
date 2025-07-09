// --- START OF FILE server/gameInstance.js (FINÁLNÍ OPRAVENÁ A KOMPLETNÍ VERZE) ---

const { GAME_CONFIG } = require('../shared/config.js');

const createId = (length = 5) => Math.random().toString(36).substr(2, length).toUpperCase();
const FOW_STATE = { HIDDEN: 0, EXPLORED: 1, VISIBLE: 2 };

class GameInstance {
    constructor(gameCode, players) {
        this.code = gameCode;
        this.players = players.reduce((acc, p) => {
            acc[p.id] = { ...p, units: {}, resources: {}, pop: {} };
            return acc;
        }, {});
        
        this.board = [];
        this.units = {};
        this.buildings = {};
        this.visibilityMaps = {};
        this.dirtyData = {};
    }

    initializeGame() {
        this.board = this.generateMap(GAME_CONFIG.GRID_SIZE);
        
        // TOTO BYLO ROZBITÉ A NYNÍ JE OPRAVENO:
        const startPositions = [
            { x: 30, y: 30 }, { x: GAME_CONFIG.GRID_SIZE - 30, y: 30 },
            { x: GAME_CONFIG.GRID_SIZE - 30, y: GAME_CONFIG.GRID_SIZE - 30 }, { x: 30, y: GAME_CONFIG.GRID_SIZE - 30 },
            { x: 30, y: GAME_CONFIG.GRID_SIZE / 2 }, { x: GAME_CONFIG.GRID_SIZE - 30, y: GAME_CONFIG.GRID_SIZE / 2 },
            { x: GAME_CONFIG.GRID_SIZE / 2, y: 30 }, { x: GAME_CONFIG.GRID_SIZE / 2, y: GAME_CONFIG.GRID_SIZE - 30 }
        ];

        Object.values(this.players).forEach((player, index) => {
            // TOTO BYLO ROZBITÉ A NYNÍ JE OPRAVENO:
            this.visibilityMaps[player.id] = new Uint8Array(GAME_CONFIG.GRID_SIZE * GAME_CONFIG.GRID_SIZE).fill(FOW_STATE.HIDDEN);
            const pos = startPositions[index % startPositions.length];
            player.startPos = pos;
            player.resources = { ...GAME_CONFIG.INITIAL_RESOURCES };
            player.pop = { current: 0, cap: 0 };
            player.color = GAME_CONFIG.PLAYER_COLORS[index];
            
            const base = this.createBuilding(player, 'ZAKLADNA', pos.x, pos.y);
            base.buildProgress = 1;
            
            this.createUnit(player, 'STAVITEL', {x: pos.x + 4, y: pos.y + 1});
            this.createUnit(player, 'PECHOTA', {x: pos.x - 1, y: pos.y + 1});
            this.createUnit(player, 'PECHOTA', {x: pos.x + 1.5, y: pos.y + 4});
            
            this.calculatePlayerPopCap(player);
            this.calculatePlayerPop(player);
        });

        return {
            gameCode: this.code,
            config: GAME_CONFIG,
            players: Object.values(this.players).map(p => ({ id: p.id, name: p.name, color: p.color, startPos: p.startPos })),
            board: this.board,
        };
    }

    gameTick(deltaTime) {
        this.dirtyData = { players: new Set(), units: new Set(), buildings: new Set(), events: [], visibilityChanges: {} };
        this.updateResourceProduction(deltaTime);
        this.updateBuildingConstruction(deltaTime);
        this.updateUnitTraining(deltaTime);
        this.updateCombat(deltaTime);
        this.updateUnitMovement(deltaTime);
        this.updateVisibility();
        return this.createUpdatePackets();
    }
    
    updateResourceProduction(deltaTime) {
        Object.values(this.players).forEach(p => {
            const production = { gold: 0, food: 0, wood: 0, stone: 0, science: 0 };
            const upkeep = { food: 0 };
            Object.values(this.buildings).filter(b => b.ownerId === p.id && b.buildProgress === 1).forEach(b => {
                const b_config = GAME_CONFIG.BUILDINGS[b.type];
                if (b_config.production) {
                    for (const res in b_config.production) production[res] += b_config.production[res];
                }
            });
            Object.values(p.units).forEach(u => upkeep.food += GAME_CONFIG.UNITS[u.type].upkeep.food || 0);
            p.resources.gold += production.gold * deltaTime;
            p.resources.food += (production.food - upkeep.food) * deltaTime;
            if (p.resources.food < 0) p.resources.food = 0;
            p.resources.wood += production.wood * deltaTime;
            p.resources.stone += production.stone * deltaTime;
            p.resources.science += production.science * deltaTime;
            this.dirtyData.players.add(p.id);
        });
    }

    updateBuildingConstruction(deltaTime) {
        Object.values(this.buildings).forEach(b => {
            if (b.buildProgress < 1) {
                b.buildProgress += deltaTime / b.buildTime;
                if (b.buildProgress >= 1) {
                    b.buildProgress = 1;
                    const b_conf = GAME_CONFIG.BUILDINGS[b.type];
                    b.hp = b_conf.hp; b.maxHp = b_conf.hp;
                    this.dirtyData.events.push({ type: 'SFX', name: 'construction_complete', pos: { x: b.x, y: b.y } });
                    const owner = this.players[b.ownerId];
                    if (owner && b_conf.provides_pop) {
                        this.calculatePlayerPopCap(owner);
                        this.dirtyData.players.add(owner.id);
                    }
                }
                this.dirtyData.buildings.add(b.id);
            }
        });
    }

    updateUnitTraining(deltaTime) {
        Object.values(this.buildings).forEach(b => {
            if (b.trainingQueue.length > 0) {
                const item = b.trainingQueue[0];
                const unitConfig = GAME_CONFIG.UNITS[item.unitType];
                const buildTime = (unitConfig.cost.food + (unitConfig.cost.gold || 0) + (unitConfig.cost.wood || 0)) / 5;
                item.progress += deltaTime / buildTime;
                if (item.progress >= 1) {
                    b.trainingQueue.shift();
                    const owner = this.players[b.ownerId];
                    if (owner && owner.pop.current < owner.pop.cap) {
                        const rallyPoint = b.rallyPoint || { x: b.x + 2, y: b.y + 2 };
                        this.createUnit(owner, item.unitType, rallyPoint);
                        this.calculatePlayerPop(owner);
                        this.dirtyData.players.add(owner.id);
                        this.dirtyData.events.push({ type: 'SFX', name: 'unit_trained', pos: { x: b.x, y: b.y } });
                    }
                }
                this.dirtyData.buildings.add(b.id);
            }
        });
    }

    updateUnitMovement(deltaTime) {
        Object.values(this.units).forEach(u => {
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
            const terrainTypeKey = this.board[gridY]?.[gridX] || 'PLAINS';
            const terrainType = GAME_CONFIG.TERRAIN[terrainTypeKey];
            const unitConf = GAME_CONFIG.UNITS[u.type];
            const speedModifier = 1 / (terrainType?.movement_cost || 1);
            const speed = unitConf.speed * speedModifier;
            u.x += (dx / dist) * speed * deltaTime;
            u.y += (dy / dist) * speed * deltaTime;
            this.dirtyData.units.add(u.id);
        });
    }

    updateCombat(deltaTime) {
        const deadEntities = { units: new Set(), buildings: new Set() };
        const allUnits = Object.values(this.units);
        const allBuildings = Object.values(this.buildings);
        allUnits.forEach(u => {
            if (deadEntities.units.has(u.id)) return;
            const u_conf = GAME_CONFIG.UNITS[u.type];
            if (u.attackCooldown > 0) u.attackCooldown -= deltaTime;
            let target = u.targetId ? (this.units[u.targetId] || this.buildings[u.targetId]) : null;
            if (!target || deadEntities.units.has(target.id) || deadEntities.buildings.has(target.id)) {
                u.targetId = null;
                target = this.findClosestEnemy(u, allUnits, allBuildings, deadEntities);
                if (target) u.targetId = target.id;
            }
            if (target) {
                const isBuilding = !!target.buildProgress;
                const targetSize = isBuilding ? (GAME_CONFIG.BUILDINGS[target.type].name === 'Věž' ? 2 : 3) : 1;
                const targetX = target.x + (isBuilding ? targetSize / 2 : 0);
                const targetY = target.y + (isBuilding ? targetSize / 2 : 0);
                const distSq = (u.x - targetX) ** 2 + (u.y - targetY) ** 2;
                if (distSq <= u_conf.range ** 2) {
                    u.moveTarget = null;
                    if (u.attackCooldown <= 0) {
                        let damage = u_conf.attack;
                        if (!isBuilding && GAME_CONFIG.RPS_MODIFIERS[u.type]) {
                            damage *= GAME_CONFIG.RPS_MODIFIERS[u.type][target.type] || 1;
                        }
                        target.hp -= damage;
                        this.dirtyData.events.push({ type: 'ATTACK_EFFECT', from: { x: u.x, y: u.y }, to: { x: targetX, y: targetY }, unitType: u.type });
                        isBuilding ? this.dirtyData.buildings.add(target.id) : this.dirtyData.units.add(target.id);
                        u.attackCooldown = 1 / u_conf.attack_speed;
                        if (target.hp <= 0) {
                            isBuilding ? deadEntities.buildings.add(target.id) : deadEntities.units.add(target.id);
                        }
                    }
                } else {
                    u.moveTarget = { x: targetX, y: targetY };
                }
            }
        });
        allBuildings.forEach(b => {
            if (deadEntities.buildings.has(b.id)) return;
            const b_conf = GAME_CONFIG.BUILDINGS[b.type];
            if (!b_conf.attack || b.buildProgress < 1) return;
            if (b.attackCooldown > 0) b.attackCooldown -= deltaTime;
            let target = b.targetUnitId ? this.units[b.targetUnitId] : null;
            if (!target || deadEntities.units.has(target.id)) {
                b.targetUnitId = null;
                target = this.findClosestEnemy(b, allUnits, [], deadEntities);
                if (target) b.targetUnitId = target.id;
            }
            if (target) {
                const b_size = b_conf.name === 'Věž' ? 2 : 3;
                const b_center_x = b.x + b_size / 2;
                const b_center_y = b.y + b_size / 2;
                const distSq = (b_center_x - target.x) ** 2 + (b_center_y - target.y) ** 2;
                if (distSq <= b_conf.range ** 2) {
                    if (b.attackCooldown <= 0) {
                        target.hp -= b_conf.attack;
                        this.dirtyData.events.push({ type: 'ATTACK_EFFECT', from: { x: b_center_x, y: b_center_y }, to: { x: target.x, y: target.y }, unitType: b.type });
                        this.dirtyData.units.add(target.id);
                        b.attackCooldown = 1 / b_conf.attack_speed;
                        if (target.hp <= 0) deadEntities.units.add(target.id);
                    }
                }
            }
        });
        if (deadEntities.units.size > 0) {
            deadEntities.units.forEach(deadId => {
                const deadUnit = this.units[deadId];
                if (deadUnit) {
                    const owner = this.players[deadUnit.ownerId];
                    if (owner) {
                        delete owner.units[deadId];
                        this.calculatePlayerPop(owner);
                        this.dirtyData.players.add(owner.id);
                    }
                    delete this.units[deadId];
                }
            });
            this.dirtyData.events.push({ type: 'UNITS_DIED', ids: Array.from(deadEntities.units) });
        }
        if (deadEntities.buildings.size > 0) {
            deadEntities.buildings.forEach(deadId => {
                if (this.buildings[deadId]) delete this.buildings[deadId];
            });
        }
    }

    updateVisibility() {
        Object.values(this.players).forEach(player => {
            const visibilityMap = this.visibilityMaps[player.id];
            const dirtyCells = [];
            for (let i = 0; i < visibilityMap.length; i++) {
                if (visibilityMap[i] === FOW_STATE.VISIBLE) {
                    visibilityMap[i] = FOW_STATE.EXPLORED;
                }
            }
            const reveal = (x, y, range) => {
                const startX = Math.max(0, Math.floor(x - range));
                const endX = Math.min(this.board.length - 1, Math.floor(x + range));
                const startY = Math.max(0, Math.floor(y - range));
                const endY = Math.min(this.board.length - 1, Math.floor(y + range));
                for (let iy = startY; iy <= endY; iy++) {
                    for (let ix = startX; ix <= endX; ix++) {
                        if ((x - ix) ** 2 + (y - iy) ** 2 <= range ** 2) {
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
            Object.values(this.buildings).filter(b => b.ownerId === player.id && b.buildProgress === 1).forEach(b => {
                 const b_size = GAME_CONFIG.BUILDINGS[b.type].name === 'Věž' ? 2 : 3;
                 reveal(b.x + b_size / 2, b.y + b_size / 2, GAME_CONFIG.BUILDINGS[b.type].vision)
            });
            if (dirtyCells.length > 0) {
                this.dirtyData.visibilityChanges[player.id] = (this.dirtyData.visibilityChanges[player.id] || []).concat(dirtyCells);
            }
        });
    }

    handlePlayerAction(socketId, action) {
        const pData = this.players[socketId];
        if (!pData) return;
        switch (action.type) {
            case 'MOVE_UNITS': {
                action.payload.unitIds.forEach(id => {
                    const unit = pData.units[id];
                    if (unit) { unit.moveTarget = action.payload.target; unit.targetId = null; }
                });
                break;
            }
            case 'ATTACK_TARGET': {
                const target = this.units[action.payload.targetId] || this.buildings[action.payload.targetId];
                if (!target) return;
                action.payload.unitIds.forEach(id => {
                     const unit = pData.units[id];
                     if(unit) unit.targetId = action.payload.targetId;
                });
                break;
            }
            case 'BUILD_STRUCTURE': {
                const { builderId, structureType, position } = action.payload;
                const builder = pData.units[builderId];
                const config = GAME_CONFIG.BUILDINGS[structureType];
                if (builder?.can_build && config && this.canAfford(pData, config.cost)) {
                    const terrainType = this.board[position.y]?.[position.x];
                    if (config.placement && config.placement !== 'ANY' && config.placement !== terrainType) return;
                    this.deductCost(pData, config.cost);
                    this.createBuilding(pData, structureType, position.x, position.y);
                    builder.moveTarget = position;
                    this.dirtyData.players.add(pData.id);
                }
                break;
            }
            case 'TRAIN_UNIT': {
                const { buildingId, unitType } = action.payload;
                const building = this.buildings[buildingId];
                const unitConfig = GAME_CONFIG.UNITS[unitType];
                if (building?.ownerId === pData.id && unitConfig && this.canAfford(pData, unitConfig.cost) && (pData.pop.current < pData.pop.cap)) {
                    if(building.trainingQueue.length < 5) {
                        this.deductCost(pData, unitConfig.cost);
                        building.trainingQueue.push({ unitType, progress: 0 });
                        this.dirtyData.players.add(pData.id);
                    }
                }
                break;
            }
        }
    }

    createUnit(player, unitType, pos) {
        const u_config = GAME_CONFIG.UNITS[unitType];
        const newUnit = {
            id: createId(), ownerId: player.id, type: unitType, x: pos.x, y: pos.y,
            hp: u_config.hp, maxHp: u_config.hp, can_build: u_config.can_build || false,
            attackCooldown: 0, moveTarget: null, targetId: null,
        };
        this.units[newUnit.id] = newUnit;
        player.units[newUnit.id] = newUnit;
        return newUnit;
    }

    createBuilding(player, structureType, x, y) {
        const config = GAME_CONFIG.BUILDINGS[structureType];
        const b_size = (config.name === 'Věž' ? 2 : 3);
        const newBuilding = {
            id: createId(), ownerId: player.id, type: structureType, x, y, hp: 1, maxHp: config.hp,
            buildProgress: 0, buildTime: config.build_time, trainingQueue: [], 
            rallyPoint: {x: x + b_size/2, y: y + b_size + 1},
            attackCooldown: 0, targetUnitId: null
        };
        this.buildings[newBuilding.id] = newBuilding;
        return newBuilding;
    }

    findClosestEnemy(attacker, allUnits, allBuildings, deadEntities) {
        let closestEnemy = null;
        const visionRange = GAME_CONFIG.UNITS[attacker.type]?.vision || GAME_CONFIG.BUILDINGS[attacker.type]?.vision;
        let min_dist_sq = visionRange ** 2;
        const isAttackerBuilding = !!attacker.buildProgress;
        const attacker_size = isAttackerBuilding ? (GAME_CONFIG.BUILDINGS[attacker.type].name === 'Věž' ? 2 : 3) : 0;
        const attacker_center_x = attacker.x + (isAttackerBuilding ? attacker_size / 2 : 0);
        const attacker_center_y = attacker.y + (isAttackerBuilding ? attacker_size / 2 : 0);
        allUnits.forEach(potentialTarget => {
            if (potentialTarget.ownerId !== attacker.ownerId && !deadEntities.units.has(potentialTarget.id)) {
                const dist_sq = (attacker_center_x - potentialTarget.x)**2 + (attacker_center_y - potentialTarget.y)**2;
                if (dist_sq < min_dist_sq) {
                    min_dist_sq = dist_sq;
                    closestEnemy = potentialTarget;
                }
            }
        });
        if (!isAttackerBuilding) {
            allBuildings.forEach(potentialTarget => {
                 if (potentialTarget.ownerId !== attacker.ownerId && !deadEntities.buildings.has(potentialTarget.id) && potentialTarget.buildProgress === 1) {
                    const targetSize = GAME_CONFIG.BUILDINGS[potentialTarget.type].name === 'Věž' ? 2 : 3;
                    const targetX = potentialTarget.x + targetSize/2;
                    const targetY = potentialTarget.y + targetSize/2;
                    const dist_sq = (attacker_center_x - targetX)**2 + (attacker_center_y - targetY)**2;
                    if (dist_sq < min_dist_sq) {
                        min_dist_sq = dist_sq;
                        closestEnemy = potentialTarget;
                    }
                }
            });
        }
        return closestEnemy;
    }

    generateMap(size) {
        let board = Array.from({ length: size }, () => Array(size).fill('PLAINS'));
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
        placeFeature('FOREST', 40, 8, 15);
        placeFeature('MOUNTAIN', 25, 6, 12);
        return board;
    }
    
    createUpdatePackets() {
        const allPackets = {};
        Object.keys(this.players).forEach(playerId => {
            const playerVisibilityMap = this.visibilityMaps[playerId];
            const isVisible = (x, y) => {
                const ix = Math.floor(x);
                const iy = Math.floor(y);
                if (ix < 0 || iy < 0 || ix >= GAME_CONFIG.GRID_SIZE || iy >= GAME_CONFIG.GRID_SIZE) return false;
                return playerVisibilityMap[iy * GAME_CONFIG.GRID_SIZE + ix] === FOW_STATE.VISIBLE;
            };

            const packet = { players: [], units: [], buildings: [], events: [], visibilityChanges: this.dirtyData.visibilityChanges[playerId] || [] };
            if (this.dirtyData.players.has(playerId)) {
                const p = this.players[playerId];
                packet.players.push({ id: p.id, resources: p.resources, pop: p.pop });
            }
            Object.values(this.units).forEach(u => {
                if (isVisible(u.x, u.y)) {
                    packet.units.push({ id: u.id, ownerId: u.ownerId, type: u.type, x: u.x, y: u.y, hp: u.hp, maxHp: u.maxHp, moveTarget: u.moveTarget });
                }
            });
            Object.values(this.buildings).forEach(b => {
                const b_size = GAME_CONFIG.BUILDINGS[b.type].name === 'Věž' ? 2 : 3;
                if (isVisible(b.x + b_size/2, b.y + b_size/2)) {
                    packet.buildings.push({ id: b.id, ownerId: b.ownerId, type: b.type, x: b.x, y: b.y, hp: b.hp, maxHp: b.maxHp, buildProgress: b.buildProgress, trainingQueue: b.trainingQueue.map(i => ({unitType: i.unitType, progress: i.progress})) });
                }
            });
            packet.events = this.dirtyData.events.filter(e => {
                if (e.type === 'UNITS_DIED') return true;
                const pos = e.pos || e.to;
                return pos && isVisible(pos.x, pos.y);
            });
            
            if (Object.values(packet).some(val => Array.isArray(val) ? val.length > 0 : val !== undefined)) {
                allPackets[playerId] = packet;
            }
        });
        return allPackets;
    }

    calculatePlayerPop(player) { player.pop.current = Object.keys(player.units).length; }
    calculatePlayerPopCap(player) {
        player.pop.cap = Object.values(this.buildings)
            .filter(b => b.ownerId === player.id && b.buildProgress === 1 && GAME_CONFIG.BUILDINGS[b.type].provides_pop)
            .reduce((sum, b) => sum + GAME_CONFIG.BUILDINGS[b.type].provides_pop, 0);
    }
}

module.exports = { GameInstance };
// --- END OF FILE server/gameInstance.js ---
