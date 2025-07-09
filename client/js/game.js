// --- START OF FILE client/js/game.js (KOMPLETNÍ ROBUSTNÍ REWORK) ---

// Globální proměnná GAME_CONFIG je načtena přímo v index.html
import { network } from './network.js';

// --- STAV HRY A PROMĚNNÉ ---
let gameState = null;
let myId = null;
let animationFrameId = null;
let camera = { x: 0, y: 0, scale: 0.5 };
const CELL_SIZE = 12;
let selectedUnits = new Set();
let selectedBuilding = null;
let placingBuildingType = null;
const FOW_STATE = { HIDDEN: 0, EXPLORED: 1, VISIBLE: 2 };
let visibilityMap = null;

// --- STAV VSTUPU ---
let isDragging = false;
let isBoxSelecting = false;
let dragStartPos = { x: 0, y: 0 };
let selectionStartPos = { x: 0, y: 0 };

// --- ELEMENTY DOM ---
const entityCanvas = document.getElementById('entity-canvas');
const entityCtx = entityCanvas.getContext('2d');
const fowCanvas = document.getElementById('fow-canvas');
const fowCtx = fowCanvas.getContext('2d');
const minimapCanvas = document.getElementById('minimap');
const minimapCtx = minimapCanvas.getContext('2d');
const buildGhost = document.getElementById('build-ghost');
const selectionBox = document.getElementById('selection-box');
const actionPanel = document.getElementById('selection-actions');

// --- HERNÍ SMYČKA ---

function gameLoop() {
    animationFrameId = requestAnimationFrame(gameLoop);
    if (!gameState) return;
    
    entityCtx.clearRect(0, 0, entityCanvas.width, entityCanvas.height);
    entityCtx.save();
    entityCtx.translate(camera.x, camera.y);
    entityCtx.scale(camera.scale, camera.scale);

    renderBoard(entityCtx);
    renderEntities(entityCtx);
    renderEffects(entityCtx);

    entityCtx.restore();
}

// --- RENDEROVACÍ FUNKCE (beze změny) ---

function renderBoard(ctx) { /* ... Zůstává stejný ... */ }
function renderFOW() { /* ... Zůstává stejný ... */ }
function renderEntities(ctx) { /* ... Zůstává stejný ... */ }
function renderEffects(ctx) { /* ... Zůstává stejný ... */ }
function drawHealthBar(ctx, x, y, width, height, progress) { /* ... Zůstává stejný ... */ }
function renderMinimap() { /* ... Zůstává stejný ... */ }

// --- FUNKCE PRO AKTUALIZACI UI (beze změny) ---

function updateResourceUI() { /* ... Zůstává stejný ... */ }
function formatCost(cost) { /* ... Zůstává stejný ... */ }
function updateSelectionPanel() { /* ... Zůstává stejný ... */ }

// --- ZPRACOVÁNÍ VSTUPU (KOMPLETNÍ REWORK) ---

/**
 * Převádí souřadnice události (event) na souřadnice ve světě hry.
 * @param {MouseEvent} e - Událost myši.
 * @returns {{x: number, y: number}} - Souřadnice v herních buňkách.
 */
function getMouseWorldPos(e) {
    const rect = entityCanvas.getBoundingClientRect();
    const worldX = (e.clientX - rect.left - camera.x) / camera.scale;
    const worldY = (e.clientY - rect.top - camera.y) / camera.scale;
    return { x: worldX / CELL_SIZE, y: worldY / CELL_SIZE };
}

/**
 * Převádí souřadnice události (event) na souřadnice na obrazovce (canvas).
 * @param {MouseEvent} e - Událost myši.
 * @returns {{x: number, y: number}} - Souřadnice v pixelech na canvasu.
 */
function getMouseScreenPos(e) {
    const rect = entityCanvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
}

function handleMouseDown(e) {
    if (e.button === 0) { // Levé tlačítko
        const worldPos = getMouseWorldPos(e);
        if (placingBuildingType) {
            const builderId = Array.from(selectedUnits).find(id => gameState.units.get(id)?.can_build);
            if (builderId) {
                network.sendPlayerAction({ type: 'BUILD_STRUCTURE', payload: { builderId, structureType: placingBuildingType, position: { x: Math.floor(worldPos.x), y: Math.floor(worldPos.y) } } });
            }
            placingBuildingType = null;
            buildGhost.style.display = 'none';
            entityCanvas.style.cursor = 'default';
            return;
        }
        
        isBoxSelecting = true;
        selectionStartPos = getMouseScreenPos(e);
        selectionBox.style.left = `${selectionStartPos.x}px`;
        selectionBox.style.top = `${selectionStartPos.y}px`;
        selectionBox.style.width = '0px';
        selectionBox.style.height = '0px';
        selectionBox.style.display = 'block';

    } else if (e.button === 1) { // Prostřední tlačítko
        isDragging = true;
        dragStartPos = { x: e.clientX - camera.x, y: e.clientY - camera.y };
        entityCanvas.style.cursor = 'grabbing';
    }
}

function handleMouseMove(e) {
    if (isDragging) {
        camera.x = e.clientX - dragStartPos.x;
        camera.y = e.clientY - dragStartPos.y;
        renderFOW(); // Překreslíme FoW při posunu kamery
    } else if (isBoxSelecting) {
        const currentPos = getMouseScreenPos(e);
        const x = Math.min(selectionStartPos.x, currentPos.x);
        const y = Math.min(selectionStartPos.y, currentPos.y);
        const width = Math.abs(selectionStartPos.x - currentPos.x);
        const height = Math.abs(selectionStartPos.y - currentPos.y);
        selectionBox.style.left = `${x}px`;
        selectionBox.style.top = `${y}px`;
        selectionBox.style.width = `${width}px`;
        selectionBox.style.height = `${height}px`;
    }
     if (placingBuildingType) {
        const worldPos = getMouseWorldPos(e);
        const buildingConf = GAME_CONFIG.BUILDINGS[placingBuildingType];
        const size = (buildingConf.name === 'Věž' ? 2 : 3);
        const screenX = (Math.floor(worldPos.x) * CELL_SIZE * camera.scale + camera.x);
        const screenY = (Math.floor(worldPos.y) * CELL_SIZE * camera.scale + camera.y);
        buildGhost.style.transform = `translate(${screenX}px, ${screenY}px)`;
        buildGhost.style.width = `${size * CELL_SIZE * camera.scale}px`;
        buildGhost.style.height = `${size * CELL_SIZE * camera.scale}px`;
    }
}

function handleMouseUp(e) {
    if (e.button === 0) { // Levé tlačítko
        if (isBoxSelecting) {
            selectionBox.style.display = 'none';
            isBoxSelecting = false;
            
            const endPos = getMouseScreenPos(e);
            const movedDist = Math.hypot(endPos.x - selectionStartPos.x, endPos.y - selectionStartPos.y);

            selectedBuilding = null;

            if (movedDist < 5) { // Toto byl KLIK, ne tažení
                selectedUnits.clear();
                const worldPos = getMouseWorldPos(e);
                let foundEntity = null;
                
                // Priorita výběru: Jednotky > Budovy
                let closestUnit = null, minDistSq = 0.5; // Hledáme do 0.5 buňky
                gameState.units.forEach(u => {
                    if (u.ownerId === myId) {
                        const distSq = (u.x - worldPos.x)**2 + (u.y - worldPos.y)**2;
                        if (distSq < minDistSq) { closestUnit = u; minDistSq = distSq; }
                    }
                });
                if (closestUnit) {
                    foundEntity = closestUnit;
                    selectedUnits.add(foundEntity.id);
                } else {
                    // Pokud nebyla nalezena jednotka, hledáme budovy
                    gameState.buildings.forEach(b => {
                        const b_size = (GAME_CONFIG.BUILDINGS[b.type]?.name === 'Věž' ? 2 : 3);
                        if (b.ownerId === myId && worldPos.x >= b.x && worldPos.x <= b.x + b_size && worldPos.y >= b.y && worldPos.y <= b.y + b_size) {
                            foundEntity = b;
                        }
                    });
                    if (foundEntity) {
                        selectedBuilding = foundEntity.id;
                    }
                }
            } else { // Toto bylo TAŽENÍ (box select)
                selectedUnits.clear();
                const rect = entityCanvas.getBoundingClientRect();
                const startWorld = getMouseWorldPos({clientX: selectionStartPos.x + rect.left, clientY: selectionStartPos.y + rect.top});
                const endWorld = getMouseWorldPos(e);

                const minX = Math.min(startWorld.x, endWorld.x);
                const maxX = Math.max(startWorld.x, endWorld.x);
                const minY = Math.min(startWorld.y, endWorld.y);
                const maxY = Math.max(startWorld.y, endWorld.y);

                gameState.units.forEach(u => {
                    if (u.ownerId === myId && u.x >= minX && u.x <= maxX && u.y >= minY && u.y <= maxY) {
                        selectedUnits.add(u.id);
                    }
                });
            }
            updateSelectionPanel();
        }
    }
    if (e.button === 1) { // Prostřední tlačítko
        isDragging = false;
        entityCanvas.style.cursor = 'default';
    }
}

function handleContextMenu(e) {
    e.preventDefault();
    if (placingBuildingType) {
        placingBuildingType = null;
        buildGhost.style.display = 'none';
        entityCanvas.style.cursor = 'default';
        return;
    }
    if (selectedUnits.size === 0) return;
    
    const targetPos = getMouseWorldPos(e);
    let targetEntity = null;
    let minDistSq = 1;

    // Najdi nejbližší nepřátelskou jednotku
    gameState.units.forEach(u => {
        if (u.ownerId !== myId) {
            const distSq = (u.x - targetPos.x)**2 + (u.y - targetPos.y)**2;
            if (distSq < minDistSq) {
                targetEntity = {type: 'unit', id: u.id};
                minDistSq = distSq;
            }
        }
    });
    
    // Najdi nepřátelskou budovu, pokud je blíž než jednotka
    gameState.buildings.forEach(b => {
        if(b.ownerId !== myId){
            const b_size = (GAME_CONFIG.BUILDINGS[b.type]?.name === 'Věž' ? 2 : 3);
            const b_center_x = b.x + b_size / 2;
            const b_center_y = b.y + b_size / 2;
            if (targetPos.x >= b.x && targetPos.x <= b.x + b_size && targetPos.y >= b.y && targetPos.y <= b.y + b_size) {
                const distSq = (b_center_x - targetPos.x)**2 + (b_center_y - targetPos.y)**2;
                 if(distSq < minDistSq){
                     targetEntity = {type: 'building', id: b.id};
                     minDistSq = distSq;
                 }
            }
        }
    });

    if (targetEntity) {
        network.sendPlayerAction({ type: 'ATTACK_TARGET', payload: { unitIds: Array.from(selectedUnits), targetId: targetEntity.id } });
    } else {
        network.sendPlayerAction({ type: 'MOVE_UNITS', payload: { unitIds: Array.from(selectedUnits), target: targetPos } });
    }
}

function handleWheel(e) {
    // Toto je klíčové, aby se nescrollovala celá stránka
    e.preventDefault(); 
    
    const mousePos = getMouseScreenPos(e);
    const zoomFactor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
    const newScale = Math.max(0.2, Math.min(camera.scale * zoomFactor, 2.5));

    // Vypočítáme pozici myši ve světě PŘED zoomem
    const worldX_before = (mousePos.x - camera.x) / camera.scale;
    const worldY_before = (mousePos.y - camera.y) / camera.scale;
    
    // Aktualizujeme scale
    camera.scale = newScale;
    
    // Upravíme pozici kamery tak, aby bod pod myší zůstal na stejném místě
    camera.x = mousePos.x - (worldX_before * camera.scale);
    camera.y = mousePos.y - (worldY_before * camera.scale);

    if (placingBuildingType) {
        const buildingConf = GAME_CONFIG.BUILDINGS[placingBuildingType];
        const size = (buildingConf.name === 'Věž' ? 2 : 3);
        buildGhost.style.width = buildGhost.style.height = `${size * CELL_SIZE * camera.scale}px`;
    }
    
    // Překreslíme FoW, protože se změnilo přiblížení
    renderFOW();
}

function handleActionPanelClick(e) {
    const button = e.target.closest('.action-button');
    if(!button) return;
    
    if (button.dataset.action === 'train') {
        network.sendPlayerAction({ type: 'TRAIN_UNIT', payload: { buildingId: selectedBuilding, unitType: button.dataset.unit } });
    } else if (button.classList.contains('build-button')) {
        placingBuildingType = button.dataset.structure;
        entityCanvas.style.cursor = 'copy';
        buildGhost.style.display = 'block';
    }
}

function resizeCanvas() {
    const viewport = document.getElementById('game-viewport');
    [entityCanvas, fowCanvas].forEach(c => { c.width = viewport.clientWidth; c.height = viewport.clientHeight; });
    const minimapPanel = document.querySelector('.minimap-panel');
    if(minimapPanel) {
        minimapCanvas.width = minimapPanel.clientWidth - 30; // 15px padding z každé strany
        minimapCanvas.height = minimapCanvas.width;
    }
    if(gameState) {
        renderFOW();
        renderMinimap();
    }
}

// --- VEŘEJNÉ ROZHRANÍ MODULU ---

export const game = {
    initialize: (initialPacket, localPlayerId) => {
        myId = localPlayerId;
        gameState = {
            ...initialPacket,
            players: new Map(initialPacket.players.map(p => [p.id, { ...p }])),
            units: new Map(),
            buildings: new Map(),
            effects: []
        };
        visibilityMap = new Uint8Array(gameState.config.GRID_SIZE * gameState.config.GRID_SIZE).fill(FOW_STATE.HIDDEN);

        const myPlayer = gameState.players.get(myId);
        if (myPlayer && myPlayer.startPos) {
            const startPos = myPlayer.startPos;
            camera.x = -startPos.x * CELL_SIZE * camera.scale + entityCanvas.width / 2;
            camera.y = -startPos.y * CELL_SIZE * camera.scale + entityCanvas.height / 2;
        }

        // Centralizovaná registrace všech event listenerů
        entityCanvas.addEventListener('mousedown', handleMouseDown);
        entityCanvas.addEventListener('mousemove', handleMouseMove);
        entityCanvas.addEventListener('mouseup', handleMouseUp);
        entityCanvas.addEventListener('contextmenu', handleContextMenu);
        // { passive: false } je nutné pro e.preventDefault() ve wheel handleru
        entityCanvas.addEventListener('wheel', handleWheel, { passive: false });
        actionPanel.addEventListener('click', handleActionPanelClick);
        window.addEventListener('resize', resizeCanvas);

        resizeCanvas();
        renderFOW();
        updateSelectionPanel();
        
        if (animationFrameId) cancelAnimationFrame(animationFrameId);
        gameLoop();
    },

    handleStateUpdate: (update) => {
        if (!gameState) return;
        update.players?.forEach(pData => {
            const player = gameState.players.get(pData.id);
            if (player) Object.assign(player, pData);
        });
        let fowChanged = false;
        if (update.visibilityChanges?.length > 0) {
            fowChanged = true;
            update.visibilityChanges.forEach(cell => {
                visibilityMap[cell.y * gameState.config.GRID_SIZE + cell.x] = cell.state;
            });
        }
        gameState.units = new Map(update.units.map(u => [u.id, u]));
        gameState.buildings = new Map(update.buildings.map(b => [b.id, b]));
        update.events?.forEach(event => {
            if (event.type === 'UNITS_DIED') {
                event.ids.forEach(id => selectedUnits.delete(id));
            } else if (event.type === 'ATTACK_EFFECT') {
                gameState.effects.push({ ...event, duration: 0.3, maxDuration: 0.3 });
            }
        });
        updateResourceUI();
        if (selectedBuilding || selectedUnits.size > 0) updateSelectionPanel();
        if (fowChanged) {
            renderFOW();
            renderMinimap();
        }
    },

    shutdown: () => {
        if (animationFrameId) {
            cancelAnimationFrame(animationFrameId);
            animationFrameId = null;
        }
        // Odebrání listenerů pro čistotu
        entityCanvas.removeEventListener('mousedown', handleMouseDown);
        entityCanvas.removeEventListener('mousemove', handleMouseMove);
        entityCanvas.removeEventListener('mouseup', handleMouseUp);
        entityCanvas.removeEventListener('contextmenu', handleContextMenu);
        entityCanvas.removeEventListener('wheel', handleWheel);
        actionPanel.removeEventListener('click', handleActionPanelClick);
        window.removeEventListener('resize', resizeCanvas);
    }
};

// Vkládám sem znovu kompletní, neměnné funkce, aby byl soubor 100% kompletní.
renderBoard = function(ctx) { const { GRID_SIZE, TERRAIN } = gameState.config; const startX = Math.floor(-camera.x / (CELL_SIZE * camera.scale)); const startY = Math.floor(-camera.y / (CELL_SIZE * camera.scale)); const endX = startX + Math.ceil(entityCanvas.width / (CELL_SIZE * camera.scale)) + 1; const endY = startY + Math.ceil(entityCanvas.height / (CELL_SIZE * camera.scale)) + 1; for (let y = Math.max(0, startY); y < Math.min(GRID_SIZE, endY); y++) { for (let x = Math.max(0, startX); x < Math.min(GRID_SIZE, endX); x++) { const state = visibilityMap[y * GRID_SIZE + x]; if (state === FOW_STATE.VISIBLE || state === FOW_STATE.EXPLORED) { ctx.fillStyle = TERRAIN[gameState.board[y][x]]?.color || '#000'; ctx.fillRect(x * CELL_SIZE, y * CELL_SIZE, CELL_SIZE, CELL_SIZE); } } } }
renderFOW = function() { if (!gameState || !visibilityMap) return; fowCtx.clearRect(0, 0, fowCanvas.width, fowCanvas.height); fowCtx.save(); fowCtx.translate(camera.x, camera.y); fowCtx.scale(camera.scale, camera.scale); const { GRID_SIZE } = gameState.config; const startX = Math.floor(-camera.x / (CELL_SIZE * camera.scale)); const startY = Math.floor(-camera.y / (CELL_SIZE * camera.scale)); const endX = startX + Math.ceil(fowCanvas.width / (CELL_SIZE * camera.scale)) + 1; const endY = startY + Math.ceil(fowCanvas.height / (CELL_SIZE * camera.scale)) + 1; for (let y = Math.max(0, startY); y < Math.min(GRID_SIZE, endY); y++) { for (let x = Math.max(0, startX); x < Math.min(GRID_SIZE, endX); x++) { const state = visibilityMap[y * GRID_SIZE + x]; if (state === FOW_STATE.EXPLORED) { fowCtx.fillStyle = "rgba(0, 0, 0, 0.5)"; fowCtx.fillRect(x * CELL_SIZE, y * CELL_SIZE, CELL_SIZE, CELL_SIZE); } else if (state === FOW_STATE.HIDDEN) { fowCtx.fillStyle = "black"; fowCtx.fillRect(x * CELL_SIZE, y * CELL_SIZE, CELL_SIZE, CELL_SIZE); } } } fowCtx.restore(); }
renderEntities = function(ctx) { gameState.buildings.forEach(b => { const pColor = gameState.players.get(b.ownerId)?.color || 'grey'; ctx.fillStyle = pColor; const b_size = (GAME_CONFIG.BUILDINGS[b.type]?.name === 'Věž' ? 2 : 3); ctx.fillRect(b.x * CELL_SIZE, b.y * CELL_SIZE, b_size * CELL_SIZE, b_size * CELL_SIZE); if (b.type === 'FARMA') { ctx.fillStyle = '#27ae60'; ctx.fillRect((b.x + 0.5) * CELL_SIZE, (b.y + 0.5) * CELL_SIZE, 2 * CELL_SIZE, 2 * CELL_SIZE); } if (b.type === 'DUL') { ctx.fillStyle = '#7f8c8d'; ctx.fillRect((b.x + 0.5) * CELL_SIZE, (b.y + 0.5) * CELL_SIZE, 2 * CELL_SIZE, 2 * CELL_SIZE); } if (b.type === 'VEZ') { ctx.fillStyle = '#bdc3c7'; ctx.fillRect((b.x + 0.5) * CELL_SIZE, (b.y + 0.5) * CELL_SIZE, 1 * CELL_SIZE, 1 * CELL_SIZE); } if (b.type === 'PILA') { ctx.fillStyle = '#8c5a2b'; ctx.beginPath(); ctx.moveTo((b.x+0.5)*CELL_SIZE, (b.y+2.5)*CELL_SIZE); ctx.lineTo((b.x+1.5)*CELL_SIZE, (b.y+0.5)*CELL_SIZE); ctx.lineTo((b.x+2.5)*CELL_SIZE, (b.y+2.5)*CELL_SIZE); ctx.closePath(); ctx.fill(); } ctx.strokeStyle = '#000'; ctx.strokeRect(b.x * CELL_SIZE, b.y * CELL_SIZE, b_size * CELL_SIZE, b_size * CELL_SIZE); if (b.hp < b.maxHp) drawHealthBar(ctx, b.x * CELL_SIZE, (b.y - 0.5) * CELL_SIZE, b_size * CELL_SIZE, 4 / camera.scale, b.hp / b.maxHp); if (selectedBuilding === b.id) { ctx.strokeStyle = 'white'; ctx.lineWidth = 3 / camera.scale; ctx.strokeRect(b.x * CELL_SIZE, b.y * CELL_SIZE, b_size * CELL_SIZE, b_size * CELL_SIZE); } }); gameState.units.forEach(u => { const pColor = gameState.players.get(u.ownerId)?.color || 'grey'; ctx.fillStyle = pColor; ctx.beginPath(); if (u.type === 'STAVITEL') { ctx.rect(u.x * CELL_SIZE - CELL_SIZE * 0.6, u.y * CELL_SIZE - CELL_SIZE * 0.6, CELL_SIZE * 1.2, CELL_SIZE * 1.2); } else { ctx.arc(u.x * CELL_SIZE, u.y * CELL_SIZE, CELL_SIZE * 0.7, 0, 2 * Math.PI); } ctx.fill(); if (u.type === "LUCISTNIK") { ctx.fillStyle = "white"; ctx.fillRect(u.x * CELL_SIZE - 2/camera.scale, u.y * CELL_SIZE - 2 / camera.scale, 4 / camera.scale, 4 / camera.scale); } if (selectedUnits.has(u.id)) { ctx.strokeStyle = 'white'; ctx.lineWidth = 2 / camera.scale; ctx.stroke(); } if (u.hp < u.maxHp) drawHealthBar(ctx, u.x * CELL_SIZE - CELL_SIZE, (u.y - 1) * CELL_SIZE, 2 * CELL_SIZE, 3 / camera.scale, u.hp / u.maxHp); }); }
renderEffects = function(ctx) { ctx.lineWidth = 2 / camera.scale; gameState.effects = gameState.effects.filter(e => { e.duration -= 1/60; if (e.duration <= 0) return false; ctx.globalAlpha = e.duration / e.maxDuration; if (e.unitType === 'LUCISTNIK' || e.unitType === 'VEZ') { ctx.strokeStyle = (e.unitType === 'VEZ') ? '#e74c3c' : 'yellow'; ctx.beginPath(); ctx.moveTo(e.from.x * CELL_SIZE, e.from.y * CELL_SIZE); ctx.lineTo(e.to.x * CELL_SIZE, e.to.y * CELL_SIZE); ctx.stroke(); } else { ctx.strokeStyle = 'red'; ctx.beginPath(); ctx.arc(e.to.x * CELL_SIZE, e.to.y * CELL_SIZE, CELL_SIZE * 0.5, 0, Math.PI * 2); ctx.stroke(); } return true; }); ctx.globalAlpha = 1.0; }
drawHealthBar = function(ctx, x, y, width, height, progress) { ctx.fillStyle = '#c0392b'; ctx.fillRect(x, y, width, height); ctx.fillStyle = '#27ae60'; ctx.fillRect(x, y, width * progress, height); ctx.strokeStyle = '#000'; ctx.lineWidth = 0.5 / camera.scale; ctx.strokeRect(x, y, width, height); }
renderMinimap = function() { if (!gameState || !visibilityMap) return; const size = gameState.config.GRID_SIZE; const pixelSize = minimapCanvas.width / size; minimapCtx.clearRect(0, 0, minimapCanvas.width, minimapCanvas.height); for(let y = 0; y < size; y++) { for(let x = 0; x < size; x++) { const state = visibilityMap[y * size + x]; if (state === FOW_STATE.VISIBLE || state === FOW_STATE.EXPLORED) { minimapCtx.fillStyle = gameState.config.TERRAIN[gameState.board[y][x]]?.color || 'black'; if (state === FOW_STATE.EXPLORED) minimapCtx.globalAlpha = 0.5; minimapCtx.fillRect(x * pixelSize, y * pixelSize, pixelSize, pixelSize); minimapCtx.globalAlpha = 1.0; } } } gameState.players.forEach(p => { minimapCtx.fillStyle = p.color; gameState.units.forEach(u => { if (u.ownerId === p.id) minimapCtx.fillRect(u.x * pixelSize, u.y * pixelSize, pixelSize, pixelSize); }); gameState.buildings.forEach(b => { if (b.ownerId === p.id) { const b_size = (GAME_CONFIG.BUILDINGS[b.type]?.name === 'Věž' ? 2 : 3); minimapCtx.fillRect(b.x * pixelSize, b.y * pixelSize, pixelSize * b_size, pixelSize * b_size); } }); }); }
updateResourceUI = function() { const me = gameState.players.get(myId); if(me && me.resources) { document.getElementById('gold-display').textContent = Math.floor(me.resources.gold); document.getElementById('food-display').textContent = Math.floor(me.resources.food); document.getElementById('wood-display').textContent = Math.floor(me.resources.wood); document.getElementById('stone-display').textContent = Math.floor(me.resources.stone); document.getElementById('science-display').textContent = Math.floor(me.resources.science); document.getElementById('pop-display').textContent = `${me.pop?.current || 0}/${me.pop?.cap || 0}`; } }
formatCost = function(cost) { let str = ''; if (cost.gold) str += `💰${cost.gold} `; if (cost.food) str += `🍖${cost.food} `; if (cost.wood) str += `🌲${cost.wood} `; if (cost.stone) str += `⛏️${cost.stone} `; return str.trim(); }
updateSelectionPanel = function() { const nameEl = document.getElementById('selection-name'); const detailsEl = document.getElementById('selection-details'); const actionsEl = document.getElementById('selection-actions'); detailsEl.innerHTML = ''; actionsEl.innerHTML = ''; if (selectedBuilding && gameState.buildings.has(selectedBuilding)) { const b = gameState.buildings.get(selectedBuilding); const b_conf = gameState.config.BUILDINGS[b.type]; nameEl.textContent = b_conf.name; detailsEl.innerHTML = `<p>HP: ${Math.ceil(b.hp)} / ${b.maxHp}</p>`; if (b_conf.trains) { b_conf.trains.forEach(unitType => { const u_conf = gameState.config.UNITS[unitType]; const costStr = formatCost(u_conf.cost); actionsEl.innerHTML += `<button class="action-button" data-action="train" data-unit="${unitType}">${u_conf.name} <br> <small>${costStr}</small></button>`; }); } if(b.trainingQueue?.length > 0) { detailsEl.innerHTML += '<h4>Fronta:</h4>' + b.trainingQueue.map(item => `<div>${gameState.config.UNITS[item.unitType].name} (${Math.floor(item.progress*100)}%)</div>`).join(''); } } else if (selectedUnits.size > 0) { if (selectedUnits.size === 1) { const unitId = selectedUnits.values().next().value; if(gameState.units.has(unitId)) { const unit = gameState.units.get(unitId); const u_conf = gameState.config.UNITS[unit.type]; nameEl.textContent = u_conf.name; detailsEl.innerHTML = `<p>HP: ${Math.ceil(unit.hp)} / ${unit.maxHp}</p>`; if (unit.can_build) { Object.entries(gameState.config.BUILDINGS).forEach(([key, conf]) => { if (Object.keys(conf.cost).length > 0) { const costStr = formatCost(conf.cost); actionsEl.innerHTML += `<button class="action-button build-button" data-structure="${key}">${conf.name} <br> <small>${costStr}</small></button>`; } }); } } else { selectedUnits.clear(); updateSelectionPanel(); } } else { const counts = {}; selectedUnits.forEach(id => { const u = gameState.units.get(id); if (u) counts[u.type] = (counts[u.type] || 0) + 1; }); nameEl.textContent = `${selectedUnits.size} jednotek`; detailsEl.innerHTML = Object.entries(counts).map(([type, count]) => `<div>${count}x ${gameState.config.UNITS[type].name}</div>`).join(''); } } else { nameEl.textContent = 'Nic nevybráno'; } }

// --- END OF FILE client/js/game.js ---
