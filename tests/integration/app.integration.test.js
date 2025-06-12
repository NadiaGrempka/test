const request = require('supertest');

jest.mock('pg', () => {
    const mPool = {
        query: jest.fn().mockResolvedValue({ rows: [], rowCount: 0 })
    };
    return { Pool: jest.fn(() => mPool) };
});

jest.mock('ioredis', () => {
    return jest.fn().mockImplementation(() => ({
        get:   jest.fn().mockResolvedValue(null),
        set:   jest.fn().mockResolvedValue('OK'),
        del:   jest.fn().mockResolvedValue(1),
        ping:  jest.fn().mockResolvedValue('PONG')
    }));
});
const app = require('../../app');

describe('GET /health', () => {
    it('should return status OK and reachable services', async () => {
        const res = await request(app).get('/health');
        expect(res.statusCode).toBe(200);
        expect(res.body).toEqual({
            status:   'OK',
            postgres: 'reachable',
            redis:    'reachable'
        });
    });
});
