'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createApp } = require('../server');
const { UserStore } = require('../lib/userStore');

function mockFinance() {
    const now = new Date('2026-11-05T21:00:00Z');
    const quote = (symbol) => ({ symbol, shortName: `${symbol} Corporation`, currency: 'USD', exchange: 'NMS', fullExchangeName: 'Nasdaq', regularMarketPrice: 120, regularMarketTime: now, regularMarketPreviousClose: 118, regularMarketChangePercent: 1.69, marketState: 'CLOSED', quoteSourceName: 'Yahoo Finance' });
    return {
        quote: async (symbols) => Array.isArray(symbols) ? symbols.map(quote) : quote(symbols),
        chart: async (symbol) => ({ meta: { currency: 'USD', fullExchangeName: 'Nasdaq' }, quotes: [
            { date: new Date('2026-11-04T21:00:00Z'), close: 100 },
            { date: new Date('2026-11-05T21:00:00Z'), close: 110 }
        ] }),
        quoteSummary: async (symbol) => ({
            price: { currency: 'USD', marketCap: 1_000_000 },
            assetProfile: { sector: 'Technology', industry: 'Software' },
            summaryDetail: { trailingPE: 20, dividendYield: 0.01, marketCap: 1_000_000 },
            financialData: { financialCurrency: 'USD', revenueGrowth: 0.12, profitMargins: 0.2, operatingMargins: 0.25, returnOnEquity: 0.18, debtToEquity: 50, freeCashflow: 10_000, totalCash: 15_000, totalDebt: 2_000 }
        })
    };
}

async function withServer(t) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-finance-test-'));
    const store = new UserStore(path.join(dir, 'users.json'));
    const server = createApp({ financeProvider: mockFinance(), userStore: store }).listen(0, '127.0.0.1');
    await new Promise((resolve) => server.once('listening', resolve));
    t.after(async () => {
        await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
        fs.rmSync(dir, { recursive: true, force: true });
    });
    const base = `http://127.0.0.1:${server.address().port}`;
    const request = async (url, options = {}) => {
        const response = await fetch(`${base}${url}`, { ...options, headers: { ...(options.body ? { 'content-type': 'application/json' } : {}), ...(options.headers || {}) } });
        return { response, body: await response.json() };
    };
    return { request };
}

async function register(request) {
    const { response, body } = await request('/api/auth/register', { method: 'POST', body: JSON.stringify({ email: 'tester@example.com', password: 'long-test-password' }) });
    assert.equal(response.status, 201);
    return { cookie: response.headers.get('set-cookie').split(';')[0] };
}

test('fundamentals and comparison return labeled metrics and partial data safely', async (t) => {
    const { request } = await withServer(t);
    const fundamentals = await request('/api/fundamentals?ticker=AAPL');
    assert.equal(fundamentals.response.status, 200);
    assert.equal(fundamentals.body.estado, 'disponible');
    assert.equal(fundamentals.body.sector, 'Technology');
    assert.equal(fundamentals.body.metricas.trailingPE.valor, 20);
    const comparison = await request('/api/compare?tickers=AAPL,MSFT');
    assert.equal(comparison.response.status, 200);
    assert.deepEqual(comparison.body.rows.map((row) => row.ticker), ['AAPL', 'MSFT']);
    assert.equal(comparison.body.rows[0].moneda, 'USD');
    assert.equal((await request('/api/compare?tickers=A,B,C,D,E')).response.status, 400);
});

test('authenticated goals, journal, and simulated portfolio buy/sell preserve history', async (t) => {
    const { request } = await withServer(t);
    const auth = await register(request);
    const headers = { cookie: auth.cookie };
    const goal = await request('/api/goals', { method: 'POST', headers, body: JSON.stringify({ title: 'Meta USD', target: 500, currency: 'usd', targetDate: '2027-01-01' }) });
    assert.equal(goal.response.status, 201);
    assert.equal(goal.body.goals[0].currency, 'USD');
    assert.equal((await request('/api/journal', { method: 'POST', headers, body: JSON.stringify({ ticker: 'AAPL', category: 'research', note: 'Revisar márgenes.' }) })).response.status, 201);
    assert.equal((await request('/api/journal', { headers })).body.entries.length, 1);
    assert.equal((await request('/api/portfolio/buy', { method: 'POST', headers, body: JSON.stringify({ ticker: 'AAPL', shares: 2 }) })).response.status, 201);
    assert.equal((await request('/api/portfolio/sell', { method: 'POST', headers, body: JSON.stringify({ ticker: 'AAPL', shares: 1 }) })).response.status, 201);
    const portfolio = await request('/api/portfolio', { headers });
    assert.equal(portfolio.body.positions.length, 2);
    assert.equal(portfolio.body.holdings[0].shares, 1);
    assert.equal(portfolio.body.holdings[0].currency, 'USD');
    assert.equal(portfolio.body.holdings[0].estadoPrecio, 'actualizada');
    assert.equal((await request('/api/portfolio/sell', { method: 'POST', headers, body: JSON.stringify({ ticker: 'AAPL', shares: 2 }) })).response.status, 400);
});

test('WhatsApp alert uses the saved template; the test action is clearly separate', async (t) => {
    const { request } = await withServer(t);
    const auth = await register(request);
    const headers = { cookie: auth.cookie };
    const template = 'AI Finance {ticker}: {senal}; cierre {precio} {moneda} ({fecha}); sentimiento {sentimiento}.';
    const settings = await request('/api/settings/whatsapp', { method: 'PUT', headers, body: JSON.stringify({ phone: '+5491123456789', message: template }) });
    assert.equal(settings.response.status, 200);
    const alert = await request('/api/whatsapp-alert', { method: 'POST', headers, body: JSON.stringify({ ticker: 'AAPL', senal: 'MANTENER', precio: 123.45, moneda: 'USD', fecha: '2026-11-06', sentimiento: 'sin datos' }) });
    assert.equal(alert.response.status, 200);
    const actualUrl = new URL(alert.body.url);
    assert.equal(actualUrl.hostname, 'wa.me');
    assert.match(actualUrl.searchParams.get('text'), /AI Finance AAPL: MANTENER; cierre 123\.45 USD/);
    assert.doesNotMatch(actualUrl.searchParams.get('text'), /mensaje de prueba/i);
    const testAlert = await request('/api/whatsapp-alert', { method: 'POST', headers, body: JSON.stringify({ test: true }) });
    assert.match(new URL(testAlert.body.url).searchParams.get('text'), /mensaje de prueba/i);
});
