const request = require('supertest');

// Przygotowujemy tablice do przechowania instancji mocków
const poolInstances = [];
const redisInstances = [];

// Mock modułu 'pg'
jest.mock('pg', () => {
    return {
        Pool: jest.fn(() => {
            const client = { query: jest.fn() };
            poolInstances.push(client);
            return client;
        }),
    };
});

// Mock modułu 'ioredis'
jest.mock('ioredis', () => {
    return jest.fn().mockImplementation(() => {
        const client = {
            get: jest.fn(),
            set: jest.fn(),
            ping: jest.fn(),
            del: jest.fn(),
        };
        redisInstances.push(client);
        return client;
    });
});

// Importujemy aplikację (po zdefiniowaniu mocków)
const app = require('../../app');

describe('Proste testy aplikacji', () => {
    let pgPoolMock;
    let redisMock;

    beforeAll(() => {
        // Pierwsze wywołania konstruktora Pool i Redis były w app.js; pobieramy te instancje:
        pgPoolMock = poolInstances[0];
        redisMock = redisInstances[0];
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    it('GET /health → 200 gdy PostgreSQL i Redis działają', async () => {
        pgPoolMock.query.mockResolvedValueOnce({ rows: [{ '?column?': 1 }] });
        redisMock.ping.mockResolvedValueOnce('PONG');

        const res = await request(app).get('/health');

        expect(res.status).toBe(200);
        expect(res.body).toEqual({
            status: 'OK',
            postgres: 'reachable',
            redis: 'reachable',
        });
        expect(pgPoolMock.query).toHaveBeenCalledWith('SELECT 1');
        expect(redisMock.ping).toHaveBeenCalled();
    });

    it('GET /items → zwraca dane z bazy, gdy cache pusty', async () => {
        redisMock.get.mockResolvedValueOnce(null);
        const fakeRows = [
            { id: 1, name: 'A', description: 'desc A', created_at: '2025-01-01T00:00:00Z' },
            { id: 2, name: 'B', description: 'desc B', created_at: '2025-02-02T00:00:00Z' },
        ];
        pgPoolMock.query.mockResolvedValueOnce({ rows: fakeRows });
        redisMock.set.mockResolvedValueOnce('OK');

        const res = await request(app).get('/items');

        expect(res.status).toBe(200);
        expect(res.body).toEqual(fakeRows);
        expect(redisMock.get).toHaveBeenCalledWith('items:all');
        expect(pgPoolMock.query).toHaveBeenCalledWith(
            'SELECT id, name, description, created_at FROM items ORDER BY created_at DESC'
        );
        expect(redisMock.set).toHaveBeenCalledWith(
            'items:all',
            JSON.stringify(fakeRows),
            'EX',
            30
        );
    });
});
