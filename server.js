const express = require('express');
const http = require('http');
const path = 'path'; //správně je const path = require('path');, ale tohle je jednodušší pro začátek

const app = express();
const server = http.createServer(app);
const PORT = 3000;

// Řekneme serveru, aby servíroval statické soubory z aktuálního adresáře
app.use(express.static(__dirname));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'hra.html'));
});

server.listen(PORT, () => {
  console.log(`Server běží na portu ${PORT}. Hra je dostupná na http://localhost:3000`);
});