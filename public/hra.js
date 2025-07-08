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
    const canvas = document.getElementById('game-canvas');
    const ctx = canvas.getContext('2d');
    
    const minimapCanvas = document.getElementById('minimap');
    const minimapCtx = minimapCanvas.getContext('2d');
    
    // UI prvky
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
    const CELL_SIZE = 10;

    // Nastavení velikosti plátna
    function resizeCanvas() {
        canvas.width = viewportEl.clientWidth;
        canvas.height = viewportEl.clientHeight;
    }
    window.addEventListener('resize', resizeCanvas);
    resizeCanvas();

    // --- Ovládání kamery ---
    let isDragging = false, didDrag = false;
    let camera = { x: 0, y: 0, scale: 0.5 };
    let startPos = { x: 0, y: 0 };
    
    canvas.addEventListener('mousedown', (e) => { if (e.button !== 0) return; isDragging = true; didDrag = false; startPos.x = e.clientX - camera.x; startPos.y = e.clientY - camera.y; });
    canvas.addEventListener('mousemove', (e) => { if (!isDragging) return; didDrag = true; camera.x = e.clientX - startPos.x; camera.y = e.clientY - startPos.y; });
    canvas.addEventListener('mouseup', () => { isDragging = false; });
    canvas.addEventListener('wheel', (e) => { 
        e.preventDefault(); 
        const mouseX = e.clientX - canvas.getBoundingClientRect().left;
        const mouseY = e.clientY - canvas.getBoundingClientRect().top;
        const zoom = Math.pow(1.1, -e.deltaY * 0.01);
        const newScale = Math.max(0.1, Math.min(camera.scale * zoom, 5.0));
        camera.x = mouseX - (mouseX - camera.x) * (newScale / camera.scale);
        camera.y = mouseY - (mouseY - camera.y) * (newScale / camera.scale);
        camera.scale = newScale;
    }, { passive: false });

    function screenToWorld(x, y) {
        return {
            x: (x - camera.x) / camera.scale,
            y: (y - camera.y) / camera.scale,
        };
    }

    // --- HLAVNÍ POSLUCHAČI ---
    socket.on('connect', () => { myId = socket.id; });
    
    socket.on('gameStateUpdate', (updatePacket) => {
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
        requestAnimationFrame(gameLoop);
        if (!gameState || !myId) return;
        
        ctx.save();
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.translate(camera.x, camera.y);
        ctx.scale(camera.scale, camera.scale);
        
        renderBoard();
        
        ctx.restore();

        renderMinimap();
        renderUI();
    }

    function renderBoard() {
        const view = {
            left: -camera.x / camera.scale,
            top: -camera.y / camera.scale,
            right: (canvas.width - camera.x) / camera.scale,
            bottom: (canvas.height - camera.y) / camera.scale
        };

        const startX = Math.max(0, Math.floor(view.left / CELL_SIZE));
        const endX = Math.min(gameState.gridSize, Math.ceil(view.right / CELL_SIZE));
        const startY = Math.max(0, Math.floor(view.top / CELL_SIZE));
        const endY = Math.min(gameState.gridSize, Math.ceil(view.bottom / CELL_SIZE));

        for (let y = startY; y < endY; y++) {
            for (let x = startX; x < endX; x++) {
                const cell = gameState.gameBoard[y][x];
                let color = '#282828';
                if (cell.ownerId) {
                    const owner = gameState.players.find(p => p.id === cell.ownerId);
                    if (owner) color = owner.color;
                }
                ctx.fillStyle = color;
                ctx.fillRect(x * CELL_SIZE, y * CELL_SIZE, CELL_SIZE, CELL_SIZE);
            }
        }
    }

    function renderMinimap() {
        const size = gameState.gridSize;
        const pixelSize = minimapCanvas.width / size;
        minimapCtx.fillStyle = '#000';
        minimapCtx.fillRect(0, 0, minimapCanvas.width, minimapCanvas.height);
        
        gameState.players.forEach(player => {
            minimapCtx.fillStyle = player.color;
            for(let y = 0; y < size; y++){
                for(let x = 0; x < size; x++){
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
    
    canvas.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        if (didDrag) return;
        if (!gameState || !myId) return;
        const me = gameState.players.find(p => p.id === myId);
        if(!me) return;
        
        const worldPos = screenToWorld(e.clientX - canvas.getBoundingClientRect().left, e.clientY - canvas.getBoundingClientRect().top);
        const targetX = Math.floor(worldPos.x / CELL_SIZE);
        const targetY = Math.floor(worldPos.y / CELL_SIZE);
        
        const unitsToSend = Math.max(1, Math.ceil(me.units * (expeditionSlider.value / 100)));
        socket.emit('launchExpedition', { gameCode, target: { x: targetX, y: targetY }, units: unitsToSend });
    });
    
    // --- Spuštění ---
    gameLoop();
});