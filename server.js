// --- START OF FILE server.js ---

import http from 'http';
import express from 'express';
import { Server } from 'socket.io';
import path from 'path';
import { fileURLToPath } from 'url';

// Důležité: Importujeme naše nové moduly pro správu lobby a her
// Cesta nyní vede do složky /server
import { LobbyManager } from './server/lobbyManager.js';

// --- NASTAVENÍ SERVERU ---

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const PORT = process.env.PORT || 3000;

// Nastavení pro správné fungování __dirname s ES moduly
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// --- STATICKÉ SOUBORY ---

// Server nyní běží z kořenového adresáře, takže cesty jsou jednodušší.
// Servírujeme obsah složky 'client' přímo.
app.use(express.static(path.join(__dirname, 'client')));
// Obsah složky 'shared' bude dostupný pod URL /shared
app.use('/shared', express.static(path.join(__dirname, 'shared')));


// --- INICIALIZACE SPRÁVCE LOBBY ---

// Vytvoříme jednu instanci LobbyManageru, které předáme 'io' objekt.
// Tento manažer se bude starat o veškerou komunikaci a logiku před začátkem hry.
const lobbyManager = new LobbyManager(io);


// --- ZPRACOVÁNÍ PŘIPOJENÍ ---

// Toto je hlavní vstupní bod pro každého nového hráče.
// Místo psaní veškeré logiky sem, pouze předáme nově připojený socket našemu manažerovi.
io.on('connection', (socket) => {
    console.log(`A new hero has arrived: ${socket.id}`);
    lobbyManager.handleNewConnection(socket);
});


// --- SPUŠTĚNÍ SERVERU ---

server.listen(PORT, () => {
    console.log(`Server Avalon is awake and listening on port ${PORT}`);
});

// --- END OF FILE server.js ---
