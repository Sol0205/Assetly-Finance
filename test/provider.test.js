'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { periodStart, fetchMarketAnalysis, safeProviderFailure, consumeRateLimit, constantTimeTokenMatch } = require('../server');

test('periodStart subtracts calendar months without overflowing at month end', () => {
    const result = periodStart('1mo', new Date('2026-03-31T12:00:00Z'));
    assert.equal(result.toISOString(), '2026-02-28T12:00:00.000Z');
});

test('market service returns normalized data and tolerates news-provider failure', async () => {
    const calls = [];
    const provider = {
        chart: async (ticker, options) => {
            calls.push({ ticker, options });
            return {
                meta: { currency: 'USD' },
                quotes: [
                    { date: new Date('2026-01-01T00:00:00Z'), close: 10 },
                    { date: new Date('2026-01-02T00:00:00Z'), close: 11 }
                ]
            };
        },
        search: async () => { throw new Error('news offline'); }
    };
    const result = await fetchMarketAnalysis(provider, {
        ticker: 'AAPL', periodo: '3mo', intervalo: '1d', umbralCompra: 0.5, umbralVenta: -0.5
    });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].ticker, 'AAPL');
    assert.equal(calls[0].options.interval, '1d');
    assert.equal(result.moneda, 'USD');
    assert.equal(result.estadoSentimiento, 'sin_datos');
    assert.equal(result.estadoNoticias, 'error');
});

test('provider failure response hides internal details and can be deterministic in tests', () => {
    const failure = safeProviderFailure(new Error('secret provider stack'), () => 0.5, () => 1000);
    assert.equal(failure.status, 502);
    assert.equal(failure.body.code, 'DATA_PROVIDER_ERROR');
    assert.match(failure.body.requestId, /^rs-/);
    assert.equal(JSON.stringify(failure).includes('secret provider stack'), false);
});

test('no quote failure becomes a not-found response', () => {
    const failure = safeProviderFailure(Object.assign(new Error('No quotes'), { code: 'NO_QUOTES' }));
    assert.equal(failure.status, 404);
    assert.equal(failure.body.code, 'NO_QUOTES');
});

test('rate limiter accepts a bounded burst, blocks excess, then resets after the window', () => {
    const store = new Map();
    assert.equal(consumeRateLimit(store, 'client', { limit: 2, windowMs: 1000, now: 100 }), true);
    assert.equal(consumeRateLimit(store, 'client', { limit: 2, windowMs: 1000, now: 200 }), true);
    assert.equal(consumeRateLimit(store, 'client', { limit: 2, windowMs: 1000, now: 300 }), false);
    assert.equal(consumeRateLimit(store, 'client', { limit: 2, windowMs: 1000, now: 1200 }), true);
});

test('alert token comparison requires exact configured bearer secret', () => {
    assert.equal(constantTimeTokenMatch('secret', 'secret'), true);
    assert.equal(constantTimeTokenMatch('wrong', 'secret'), false);
    assert.equal(constantTimeTokenMatch('secret', ''), false);
});
