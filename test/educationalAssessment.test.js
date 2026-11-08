'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildEducationalAssessment } = require('../lib/educationalAssessment');
const { officialExchangePage } = require('../server');

test('official exchange lookup only links markets the app can identify', () => {
    assert.equal(officialExchangePage('NasdaqGS NMS', 'AAPL').url, 'https://www.nasdaq.com/market-activity/stocks/aapl');
    assert.equal(officialExchangePage('New York Stock Exchange NYQ', 'IBM').url, 'https://www.nyse.com/quote/XNYS:IBM');
    assert.equal(officialExchangePage('Buenos Aires BUE', 'GGAL.BA').url, 'https://www.byma.com.ar/');
    assert.equal(officialExchangePage('Unknown', '^GSPC'), null);
});

test('combines price, fundamentals, and a sufficient validated-news sample transparently', () => {
    const result = buildEducationalAssessment({
        periodo: '3mo', variacionPct: 12, sentimiento: 0.72, titularesValidos: 5,
        fundamentals: { revenueGrowth: 0.1, profitMargins: 0.2, returnOnEquity: 0.15, freeCashflow: 100, debtToEquity: 80 }
    });
    assert.equal(result.resultado, 'COMPRAR · LECTURA EDUCATIVA');
    assert.equal(result.cobertura, 3);
    assert.deepEqual(result.componentes.map((item) => item.id), ['precio', 'fundamentos', 'noticias']);
    assert.match(result.aviso, /no es asesoramiento financiero/i);
});

test('does not generate a buy/sell/hold reading when fewer than two evidence groups exist', () => {
    const result = buildEducationalAssessment({ periodo: '1mo', variacionPct: 9, sentimiento: 0.8, titularesValidos: 1, fundamentals: {} });
    assert.equal(result.resultado, 'DATOS INSUFICIENTES');
    assert.equal(result.cobertura, 1);
    assert.equal(result.componentes.find((item) => item.id === 'noticias').estado, 'muestra_insuficiente');
});

test('mixed signals return maintain and missing news never becomes neutral evidence', () => {
    const result = buildEducationalAssessment({
        periodo: '6mo', variacionPct: 0, titularesValidos: 0,
        fundamentals: { revenueGrowth: 0.1, profitMargins: -0.1, returnOnEquity: 0, freeCashflow: 0, debtToEquity: 250 }
    });
    assert.equal(result.resultado, 'MANTENER · LECTURA EDUCATIVA');
    assert.equal(result.componentes.find((item) => item.id === 'noticias').puntaje, null);
});
