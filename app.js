// app.js
//
// Prosty serwer Express łączący się z PostgreSQL i Redis.
// Zakładamy, że w środowisku ustawione są zmienne:
//   - DATABASE_URL (np. postgres://user:pass@host:port/dbname)
//   - REDIS_URL (np. redis://host:port)
//   - PORT (opcjonalnie, domyślnie 3000)
const express = require('express');
const { Pool } = require('pg');
const Redis = require('ioredis');

require('dotenv').config();

const app = express();
app.use(express.json());

// Konfiguracja PostgreSQL
const pgPool = new Pool({
    connectionString:
    process.env.DATABASE_URL,
    // można dodać dodatkowe opcje, np. ssl
});

// Konfiguracja Redis
const redis = new Redis(process.env.REDIS_URL);

// Proste cache’owanie w Redis: klucz → wartość
// Funkcja pomocnicza do pobrania z cache lub wykonania fallbacku
async function cacheOrFetch(key, fetchFn, ttlSeconds = 60) {
    const cached = await redis.get(key);
    if (cached){
        return JSON.parse(cached);
    }
    const result = await fetchFn();
    await redis.set(key, JSON.stringify(result), 'EX', ttlSeconds);
    return result;
}

// Endpoint: sprawdzenie zdrowia serwera, bazy i Redis
app.get('/health', async (req, res) => {
    try {
        // Sprawdzenie PostgreSQL
        await pgPool.query('SELECT 1');
        // Sprawdzenie Redis
        await redis.ping();
        res.json({ status: 'OK', postgres: 'reachable', redis: 'reachable' });
    } catch (err) {
        console.error('Błąd health check:', err);
        res.status(500).json({ status: 'ERROR', error: err.message });
    }
});

// docker-compose exec postgres psql -U postgres -d myappdb
//
// psql (13.21 (Debian 13.21-1.pgdg120+1))
// Type "help" for help.
//
//                     myappdb=# CREATE TABLE IF NOT EXISTS items (
//     id SERIAL PRIMARY KEY,
//     name TEXT NOT NULL,
//     description TEXT,
//     created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
// );
// \q


(async () => {
    try {
        await pgPool.query(`
      CREATE TABLE IF NOT EXISTS items (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );
    `);
        console.log('Tabela "items" gotowa.');
    } catch (err) {
        console.error('Błąd przy tworzeniu tabeli items:', err);
    }
})();

app.get('/items', async (req, res) => {
    try {
        const items = await cacheOrFetch('items:all', async () => {
            const { rows } = await pgPool.query('SELECT id, name, description, created_at FROM items ORDER BY created_at DESC');
            return rows;
        }, 30);
        res.json(items);
    } catch (err) {
        console.error('GET /items error:', err);
        res.status(500).json({ error: 'Nie udało się pobrać listy itemów' });
    }
});


app.post('/items', async (req, res) => {
    const { name, description } = req.body;
    if (!name) {
        return res.status(400).json({ error: 'Pole "name" jest wymagane' });
    }

    try {
        const insertText = `
      INSERT INTO items (name, description)
      VALUES ($1, $2)
      RETURNING id, name, description, created_at
    `;
        const { rows } = await pgPool.query(insertText, [name, description || null]);
        await redis.del('items:all');
        res.status(201).json(rows[0]);
    } catch (err) {
        console.error('POST /items error:', err);
        res.status(500).json({ error: 'Nie udało się utworzyć nowego itemu' });
    }
});

app.get('/items/:id', async (req, res) => {
    const { id } = req.params;
    try {
        const cacheKey = `items:${id}`;
        const item = await cacheOrFetch(cacheKey, async () => {
            const { rows } = await pgPool.query(
                'SELECT id, name, description, created_at FROM items WHERE id = $1',
                [id]
            );
            return rows[0] || null;
        }, 60);

        if (!item) {
            return res.status(404).json({ error: 'Item nie znaleziony' });
        }
        res.json(item);
    } catch (err) {
        console.error(`GET /items/${id} error:`, err);
        res.status(500).json({ error: 'Nie udało się pobrać itemu' });
    }
});


app.put('/items/:id', async (req, res) => {
    const { id } = req.params;
    const { name, description } = req.body;
    if (!name) {
        return res.status(400).json({ error: 'Pole "name" jest wymagane' });
    }

    try {
        const updateText = `
      UPDATE items
      SET name = $1, description = $2
      WHERE id = $3
      RETURNING id, name, description, created_at
    `;
        const { rows } = await pgPool.query(updateText, [name, description || null, id]);
        if (rows.length === 0) {
            return res.status(404).json({ error: 'Item nie istnieje' });
        }
        // Wyczyść cache całej listy i konkretnego itemu
        await Promise.all([
            redis.del('items:all'),
            redis.del(`items:${id}`)
        ]);
        res.json(rows[0]);
    } catch (err) {
        console.error(`PUT /items/${id} error:`, err);
        res.status(500).json({ error: 'Nie udało się zaktualizować itemu' });
    }
});


app.delete('/items/:id', async (req, res) => {
    const { id } = req.params;
    try {
        const { rowCount } = await pgPool.query('DELETE FROM items WHERE id = $1', [id]);
        if (rowCount === 0) {
            return res.status(404).json({ error: 'Item nie znaleziony' });
        }
        // Wyczyść cache
        await Promise.all([
            redis.del('items:all'),
            redis.del(`items:${id}`)
        ]);
        res.status(204).end();
    } catch (err) {
        console.error(`DELETE /items/${id} error:`, err);
        res.status(500).json({ error: 'Nie udało się usunąć itemu' });
    }
});


module.exports = app;
