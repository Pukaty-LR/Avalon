document.addEventListener('DOMContentLoaded', () => {
    const socket = io();
    const urlParams = new URLSearchParams(window.location.search);
    const gameCode = urlParams.get('gameCode');

    const initialGameStateJSON = sessionStorage.getItem('initialGameState');
    if (!gameCode || !initialGameStateJSON) { 
        alert('Chyba při načítání hry, návrat do lobby.');
        window.location.href = '/'; 
        return; 
    }
    let gameState = JSON.parse(initialGameStateJSON);
    sessionStorage.removeItem('initialGameState');

    // --- Odkazy na HTML prvky ---
    const viewportEl = document.getElementById('game-viewport');
    const gridEl = document.getElementById('game-grid');
    const minimapCanvas = document.getElementById('minimap');
    const minimapCtx = minimapCanvas.getContext('2d');
    const buyUnitBtn = document.getElementById('buy-unit-button');
    const expeditionSlider = document.getElementById('expedition-slider');
    const expeditionSliderValueEl = document.getElementById('expedition-slider-value');
    const playerNameDisplayEl = document.getElementById('player-name-display');
    const goldEl = document.getElementById('gold-display');
    const crystalsEl = document.getElementById('crystals-display');
    const unitsEl = document.getElementById('units-display');
    const expeditionsEl = document.getElementById('expeditions-display');
    const territoryEl = document.getElementById('territory-display');

    let myId = null;
    let cells = [];

    // --- Ovládání kamery ---
    let isDragging = false, didDrag = false;
    let startPos = { x: 0, y: 0 }, gridPos = { x: 0, y: 0 };
    let scale = 0.2;
    const MIN_SCALE = 0.05, MAX_SCALE = 2.5;
    viewportEl.addEventListener('mousedown', (e) => { if (e.button !== 0) return; isDragging = true; didDrag = false; gridEl.style.cursor = 'grabbing'; startPos.x = e.clientX - gridPos.x; startPos.y = e.clientY - gridPos.y; });
    viewportEl.addEventListener('mousemove', (e) => { if (!isDragging) return; didDrag = true; gridPos.x = e.clientX - startPos.x; gridPos.y = e.clientY - startPos.y; updateGridTransform(); });
    viewportEl.addEventListener('mouseup', () => { isDragging = false; gridEl.style.cursor = 'grab'; });
    viewportEl.addEventListener('wheel', (e) => { e.preventDefault(); const rect = viewportEl.getBoundingClientRect(); const mouseX = e.clientX - rect.left; const mouseY = e.clientY - rect.top; const oldScale = scale; scale -= e.deltaY * 0.001 * scale; scale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, scale)); gridPos.x = mouseX - (mouseX - gridPos.x) * (scale / oldScale); gridPos.y = mouseY - (mouseY - gridPos.y) * (scale / oldScale); updateGridTransform(); }, { passive: false });
    function updateGridTransform() { gridEl.style.transform = `translate(${gridPos.x}px, ${gridPos.y}px) scale(${scale})`; }

    // --- HLAVNÍ POSLUCHAČI ---
    socket.on('connect', () => { myId = socket.id; });
    
    socket.on('gameStateUpdate', (updatePacket) => {
        // Jednoduše aktualizujeme data
        gameState.players = updatePacket.players;
        gameState.expeditions = updatePacket.expeditions;
        
        updatePacket.boardChanges.forEach(change => {
            if(gameState.gameBoard[change.y]?.[change.x]){
                gameState.gameBoard[change.y][change.x].ownerId = change.ownerId;
            }
        });
    });

    // --- HLAVNÍ VYKRESLOVACÍ SMYČKA ---
    function gameLoop() {
        if (!gameState || !myId) {
            requestAnimationFrame(gameLoop);
            return;
        }
        
        // Vykreslíme vždy vše, ale efektivně
        renderBoard();
        renderMinimap();
        renderUI();

        requestAnimationFrame(gameLoop);
    }

    function initialize() {
        createGrid(gameState.gridSize);
        // Start hlavní smyčky
        gameLoop();
    }
    
    function createGrid(size) {
        gridEl.style.setProperty('--grid-size', size);
        cells = Array.from({ length: size }, () => Array(size));
        for (let y = 0; y < size; y++) {
            for (let x = 0; x < size; x++) {
                const cellEl = document.createElement('div');
                cellEl.className = 'cell';
                cellEl.dataset.x = x;
                cellEl.dataset.y = y;
                gridEl.appendChild(cellEl);
                cells[y][x] = cellEl;
            }
        }
        // Vykreslení počátečního stavu
        gameState.gameBoard.forEach(row => row.forEach(cellData => updateCellVisual(cellData)));
    }
    
    function updateCellVisual(cellData) {
        if(!cellData) return;
        const cellEl = cells[cellData.y]?.[cellData.x];
        if(!cellEl) return;
        let ownerColor = '#282828';
        if (cellData.ownerId) {
            const owner = gameState.players.find(p => p.id === cellData.ownerId);
            if (owner) ownerColor = owner.color;
        }
        // Kontrola, zda je potřeba změnit barvu, pro optimalizaci
        if(cellEl.style.backgroundColor !== ownerColor) {
            cellEl.style.backgroundColor = ownerColor;
        }
    }

    function renderBoard() {
        // Vykreslíme pouze změněné buňky
         gameState.gameBoard.forEach(row => {
            row.forEach(cellData => {
                updateCellVisual(cellData);
            });
        });
    }

    function renderMinimap() {
        const size = gameState.gridSize;
        const pixelSize = minimapCanvas.width / size;
        minimapCtx.fillStyle = '#000';
        minimapCtx.fillRect(0, 0, minimapCanvas.width, minimapCanvas.height);
        
        gameState.players.forEach(player => {
            minimapCtx.fillStyle = player.color;
            for(let y=0; y < size; y++){
                for(let x=0; x < size; x++){
                    if(gameState.gameBoard[y][x].ownerId === player.id){
                         minimapCtx.fillRect(x * pixelSize, y * pixelSize, 1, 1);
                    }
                }
            }
        });
    }

    function renderUI() {
        const me = gameState.players.find(p => p.id === myId);
        if (me) {
            playerNameDisplayEl.textContent = me.name;
            playerNameDisplayEl.style.color = me.color;
            goldEl.textContent = Math.floor(me.gold);
            crystalsEl.textContent = Math.floor(me.crystals);
            unitsEl.textContent = me.units;
            expeditionsEl.textContent = gameState.expeditions.filter(e => e.ownerId === myId).length;
            territoryEl.textContent = me.territoryCount;
            updateSliderLabel(me.units);
        }
    }

    function updateSliderLabel(totalUnits) {
        const percentage = expeditionSlider.value;
        const unitsToSend = Math.max(1, Math.ceil(totalUnits * (percentage / 100)));
        expeditionSliderValueEl.textContent = `${percentage}% (${unitsToSend} ⚔️)`;
    }
    expeditionSlider.addEventListener('input', () => {
        const me = gameState?.players.find(p => p.id === myId);
        if(me) updateSliderLabel(me.units);
    });

    buyUnitBtn.addEventListener('click', () => socket.emit('buyUnit', { gameCode }));
    
    gridEl.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        if (didDrag) return;
        const cellEl = e.target.closest('.cell');
        if (!cellEl || !gameState || !myId) return;
        const me = gameState.players.find(p => p.id === myId);
        if(!me) return;
        const targetX = parseInt(cellEl.dataset.x);
        const targetY = parseInt(cellEl.dataset.y);
        const unitsToSend = Math.max(1, Math.ceil(me.units * (expeditionSlider.value / 100)));
        socket.emit('launchExpedition', { gameCode, target: { x: targetX, y: targetY }, units: unitsToSend });
    });
    
    // --- Spuštění ---
    initialize();
});