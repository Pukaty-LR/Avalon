document.addEventListener('DOMContentLoaded', () => {
    const socket = io();
    const urlParams = new URLSearchParams(window.location.search);
    const gameCode = urlParams.get('gameCode');

    if (!gameCode) { window.location.href = '/'; return; }

    // --- Odkazy na HTML prvky ---
    const viewportEl = document.getElementById('game-viewport');
    const gridEl = document.getElementById('game-grid');
    const minimapCanvas = document.getElementById('minimap');
    const minimapCtx = minimapCanvas.getContext('2d');
    const buyUnitBtn = document.getElementById('buy-unit-button');
    const expeditionSlider = document.getElementById('expedition-slider');
    const expeditionSliderValueEl = document.getElementById('expedition-slider-value');

    let gameState = null;
    let myId = null;
    let cells = [];

    // --- Ovládání kamery (převzato z původní hry) ---
    let isDragging = false, didDrag = false;
    let startPos = { x: 0, y: 0 }, gridPos = { x: 0, y: 0 };
    let scale = 1.0;
    const MIN_SCALE = 0.1, MAX_SCALE = 2.5;

    viewportEl.addEventListener('mousedown', (e) => { if (e.button !== 0) return; isDragging = true; didDrag = false; gridEl.style.cursor = 'grabbing'; startPos.x = e.clientX - gridPos.x; startPos.y = e.clientY - gridPos.y; });
    viewportEl.addEventListener('mousemove', (e) => { if (!isDragging) return; didDrag = true; gridPos.x = e.clientX - startPos.x; gridPos.y = e.clientY - startPos.y; updateGridTransform(); });
    viewportEl.addEventListener('mouseup', () => { isDragging = false; gridEl.style.cursor = 'grab'; });
    viewportEl.addEventListener('wheel', (e) => { e.preventDefault(); const rect = viewportEl.getBoundingClientRect(); const mouseX = e.clientX - rect.left; const mouseY = e.clientY - rect.top; const oldScale = scale; scale -= e.deltaY * 0.001 * scale; scale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, scale)); gridPos.x = mouseX - (mouseX - gridPos.x) * (scale / oldScale); gridPos.y = mouseY - (mouseY - gridPos.y) * (scale / oldScale); updateGridTransform(); }, { passive: false });
    function updateGridTransform() { gridEl.style.transform = `translate(${gridPos.x}px, ${gridPos.y}px) scale(${scale})`; }

    // --- HLAVNÍ POSLUCHAČI ---
    socket.on('connect', () => { myId = socket.id; });
    socket.on('gameStateUpdate', (newState) => {
        const isFirstUpdate = !gameState;
        gameState = newState;
        if (isFirstUpdate) {
            createGrid(gameState.gridSize);
        }
        requestAnimationFrame(renderGame);
    });

    function createGrid(size) {
        gridEl.innerHTML = '';
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
    }

    function renderGame() {
        if (!gameState || !myId) return;
        renderBoard();
        renderMinimap();
        renderUI();
    }

    function renderBoard() {
        gameState.gameBoard.forEach(row => {
            row.forEach(cellData => {
                const cellEl = cells[cellData.y][cellData.x];
                let ownerColor = '#282828';
                if (cellData.ownerId) {
                    const owner = gameState.players.find(p => p.id === cellData.ownerId);
                    if (owner) ownerColor = owner.color;
                }
                cellEl.style.backgroundColor = ownerColor;
            });
        });
        // TODO: Vykreslení struktur a expedic
    }

    function renderMinimap() {
        const size = gameState.gridSize;
        const pixelSize = minimapCanvas.width / size;
        minimapCtx.clearRect(0, 0, minimapCanvas.width, minimapCanvas.height);
        gameState.gameBoard.forEach(row => {
            row.forEach(cell => {
                if (cell.ownerId) {
                    const owner = gameState.players.find(p => p.id === cell.ownerId);
                    if (owner) {
                        minimapCtx.fillStyle = owner.color;
                        minimapCtx.fillRect(cell.x * pixelSize, cell.y * pixelSize, pixelSize, pixelSize);
                    }
                }
            });
        });
    }

    function renderUI() {
        const me = gameState.players.find(p => p.id === myId);
        if (me) {
            document.getElementById('player-name-display').textContent = me.name;
            document.getElementById('player-name-display').style.color = me.color;
            document.getElementById('gold-display').textContent = Math.floor(me.gold);
            document.getElementById('crystals-display').textContent = Math.floor(me.crystals);
            document.getElementById('units-display').textContent = me.units;
            document.getElementById('expeditions-display').textContent = gameState.expeditions.filter(e => e.ownerId === myId).length;
            document.getElementById('territory-display').textContent = me.territoryCount;
            updateSliderLabel(me.units);
        }
    }

    function updateSliderLabel(totalUnits) {
        const percentage = expeditionSlider.value;
        const unitsToSend = Math.max(1, Math.ceil(totalUnits * (percentage / 100)));
        expeditionSliderValueEl.textContent = `${percentage}% (${unitsToSend} ⚔️)`;
    }
    expeditionSlider.addEventListener('input', () => {
        if(gameState && myId){
            const me = gameState.players.find(p => p.id === myId);
            if(me) updateSliderLabel(me.units);
        }
    });

    // --- ODESÍLÁNÍ AKCÍ NA SERVER ---
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
});