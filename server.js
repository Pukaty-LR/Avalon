// --- START OF FILE server.js ---

const http = require('http');
const express = require('express');
const { Server } = require("socket.io");
const path = require('path');

// Protože projekt není nastaven jako ES modul ("type": "module" v package.json),
// musíme použít starší syntaxi 'require'.
// Cesta nyní vede do složky /server
const { LobbyManager } = require('./server/lobbyManager.js');

// --- NASTAVENÍ SERVERU ---

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const PORT = process.env.PORT || 3000;

// --- STATICKÉ SOUBORY ---

// V CommonJS je '__dirname' globální proměnná, která obsahuje cestu k aktuální složce.
// Servírujeme obsah složky 'client' přímo.
app.use(express.static(path.join(__dirname, 'client')));
// Obsah složky 'shared' bude dostupný pod URL /shared
// Toto budeme potřebovat, aby si klient mohl načíst konfiguraci.
app.use('/shared', express.static(path.join(__dirname, 'shared')));

// --- INICIALIZACE SPRÁVCE LOBBY ---

// Vytvoříme jednu instanci LobbyManageru, které předáme 'io' objekt.
const lobbyManager = new LobbyManager(io);

// --- ZPRACOVÁNÍ PŘIPOJENÍ ---

// Toto je hlavní vstupní bod pro každého nového hráče.
// Pouze předáme nově připojený socket našemu manažerovi, který se postará o zbytek.
io.on('connection', (socket) => {
    console.log(`A new hero has arrived: ${socket.id}`);
    lobbyManager.handleNewConnection(socket);
});

// --- SPUŠTĚNÍ SERVERU ---

server.listen(PORT, () => {
    console.log(`Server Avalon is awake and listening on port ${PORT}`);
});

// --- END OF FILE server.js ---
