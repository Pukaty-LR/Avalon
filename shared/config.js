// --- START OF FILE shared/config.js (OPRAVENÁ VERZE) ---

// Používáme CommonJS syntaxi (module.exports), se kterou si poradí
// jak serverový 'require', tak i klientský 'import'.

const GAME_CONFIG = {
    GRID_SIZE: 250,
    TICK_RATE: 50,
    MAX_PLAYERS: 8,
    PLAYER_COLORS: ['#4caf50', '#f44336', '#2196f3', '#ffc107', '#9c27b0', '#ff9800', '#00bcd4', '#e91e63'],
    TERRAIN: {
        PLAINS: { name: 'Roviny', movement_cost: 1.0, buildable: true, color: '#a5d6a7' },
        FOREST: { name: 'Les', movement_cost: 1.5, buildable: true, color: '#388e3c' },
        MOUNTAIN: { name: 'Hory', movement_cost: 2.5, buildable: true, color: '#795548' }
    },
    INITIAL_RESOURCES: { gold: 200, food: 150, wood: 100, stone: 50, science: 0 },
    UNITS: {
        STAVITEL: { name: "Stavitel", hp: 50, speed: 1.8, cost: { food: 50 }, upkeep: { food: 0.1 }, can_build: true, attack: 2, range: 1, attack_speed: 0.5, vision: 8 },
        PECHOTA: { name: "Pěchota", hp: 100, speed: 1.5, cost: { food: 25, gold: 10 }, upkeep: { food: 0.2 }, attack: 10, range: 1, attack_speed: 1, vision: 7 },
        LUCISTNIK: { name: "Lučištník", hp: 70, speed: 1.6, cost: { wood: 25, gold: 25 }, upkeep: { food: 0.25 }, attack: 12, range: 6, attack_speed: 1.2, vision: 9 },
        JIZDA: { name: "Jízda", hp: 130, speed: 2.5, cost: { food: 60, gold: 40 }, upkeep: { food: 0.4 }, attack: 15, range: 1.2, attack_speed: 0.9, vision: 10 }
    },
    RPS_MODIFIERS: {
        PECHOTA: { JIZDA: 1.5, LUCISTNIK: 0.75 },
        LUCISTNIK: { PECHOTA: 1.5, JIZDA: 0.75 },
        JIZDA: { LUCISTNIK: 1.5, PECHOTA: 0.75 }
    },
    BUILDINGS: {
        ZAKLADNA: { name: 'Hlavní město', hp: 2000, cost: {}, build_time: 0, provides_pop: 10, trains: ['STAVITEL', 'PECHOTA'], vision: 12 },
        DUM: { name: 'Dům', hp: 250, cost: { wood: 30 }, build_time: 8, provides_pop: 5, vision: 3 },
        FARMA: { name: 'Farma', hp: 300, cost: { wood: 50 }, build_time: 10, production: { food: 0.8 }, placement: 'PLAINS', vision: 3 },
        PILA: { name: 'Pila', hp: 300, cost: { wood: 40, gold: 10 }, build_time: 12, production: { wood: 0.6 }, placement: 'FOREST', vision: 3 },
        DUL: { name: 'Důl', hp: 400, cost: { wood: 80, stone: 20 }, build_time: 15, production: { gold: 0.25, stone: 0.1 }, placement: 'MOUNTAIN', vision: 3 },
        KASARNY: { name: 'Kasárny', hp: 700, cost: { wood: 100, stone: 50 }, build_time: 20, trains: ['PECHOTA', 'LUCISTNIK'], vision: 4 },
        STAJE: { name: 'Stáje', hp: 800, cost: { gold: 50, wood: 150 }, build_time: 30, trains: ['JIZDA'], vision: 4 },
        UNIVERZITA: { name: 'Univerzita', hp: 500, cost: { gold: 100, wood: 200 }, build_time: 40, production: { science: 0.5 }, vision: 4 },
        VEZ: { name: 'Věž', hp: 500, cost: { wood: 75, stone: 125 }, build_time: 25, vision: 10, attack: 20, range: 8, attack_speed: 1.5, placement: 'ANY' }
    }
};

// Exportujeme objekt, aby ho bylo možné načíst pomocí 'require' na serveru.
module.exports = { GAME_CONFIG };

// --- END OF FILE shared/config.js ---
