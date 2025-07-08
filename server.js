const express = require('express');
const http = require('http');
const path = require('path');

const app = express();
const server = http.createServer(app);
const PORT = 3000;

// Řekneme serveru, aby posílal soubory z aktuálního adresáře (kde je hra.html)
app.use(express.static(__dirname));

// Hlavní cesta, která pošle soubor s hrou
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'hra.html'));
});

server.listen(PORT, () => {
  console.log(`Server běží! Otevři v prohlížeči http://TVOJE_IP:${PORT}`);
});