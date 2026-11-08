'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildAnalysis, filterRelevantNews } = require('../lib/analysis');
const { generarSenal } = require('../lib/decisionLogic');
const { analizarSentimientoNoticias } = require('../lib/sentiment');

test('decision rules respect strict threshold boundaries', () => {
    assert.equal(generarSenal(0.5).senal, 'MANTENER');
    assert.equal(generarSenal(0.501).senal, 'COMPRA');
    assert.equal(generarSenal(-0.5).senal, 'MANTENER');
    assert.equal(generarSenal(-0.501).senal, 'VENTA');
});

test('empty and invalid-title news do not become fake neutral observations', () => {
    assert.deepEqual(analizarSentimientoNoticias([]), { promedio: 0, detalle: [] });
    assert.deepEqual(analizarSentimientoNoticias([null, { title: '  ' }, {}]), { promedio: 0, detalle: [] });
});

test('normalizes news timestamps delivered as Date objects, seconds, or milliseconds', () => {
    const details = analizarSentimientoNoticias([
        { title: 'Stock rises', providerPublishTime: new Date('2026-11-05T12:00:00Z') },
        { title: 'Stock falls', providerPublishTime: 1793880000 },
        { title: 'Stock steady', providerPublishTime: Date.parse('2026-11-05T14:00:00Z') }
    ]).detalle;
    assert.equal(details[0].fecha, '2026-11-05T12:00:00.000Z');
    assert.equal(details[1].fecha, '2026-11-05T12:00:00.000Z');
    assert.equal(details[2].fecha, '2026-11-05T14:00:00.000Z');
});

test('filters out market headlines that are unrelated to the selected company', () => {
    const headlines = filterRelevantNews([
        { title: 'Apple expands services revenue', publisher: 'Apple', link: 'https://www.apple.com/newsroom/story', relatedTickers: ['AAPL'] },
        { title: 'Nvidia shares fall below $200', publisher: 'NVIDIA', link: 'https://www.nvidia.com/news/story', relatedTickers: ['NVDA', 'AAPL'] },
        { title: 'Market update: Apple, Microsoft and Amazon gain', publisher: 'Apple', link: 'https://www.apple.com/newsroom/market-story', relatedTickers: ['AAPL', 'MSFT'] }
    ], 'AAPL', { shortName: 'Apple Inc.' });
    assert.deepEqual(headlines.map((item) => item.title), [
        'Apple expands services revenue',
        'Market update: Apple, Microsoft and Amazon gain'
    ]);
});

test('accepts only attributed Yahoo Finance article pages as syndicated publisher sources', () => {
    const headlines = filterRelevantNews([
        { title: 'Apple expands services revenue', publisher: 'Business Daily', link: 'https://finance.yahoo.com/m/1234/apple-revenue.html' },
        { title: 'Apple shares gain', publisher: 'Business Daily', link: 'https://finance.yahoo.com/quote/AAPL/' },
        { title: 'Apple shares gain', publisher: 'Business Daily', link: 'https://finance.yahoo.com.evil.example/m/1234/apple.html' },
        { title: 'Apple shares gain', publisher: '', link: 'https://finance.yahoo.com/m/1234/apple.html' }
    ], 'AAPL', { shortName: 'Apple Inc.' });
    assert.deepEqual(headlines.map((item) => item.title), ['Apple expands services revenue']);
});

test('builds an analysis with quote metadata and a previous-close comparison', () => {
    const result = buildAnalysis({
        ticker: 'AAPL',
        chart: {
            meta: { shortName: 'Apple Inc.', currency: 'USD', exchangeName: 'NMS', exchangeTimezoneName: 'America/New_York' },
            quotes: [
                { date: new Date('2026-10-29T20:00:00Z'), close: 100 },
                { date: new Date('2026-10-30T20:00:00Z'), close: 105 }
            ]
        },
        news: [{ title: 'Company reports strong growth and record revenue', publisher: 'Example', link: 'https://example.com/story', providerPublishTime: 1793380800 }]
    });
    assert.equal(result.nombre, 'Apple Inc.');
    assert.equal(result.moneda, 'USD');
    assert.equal(result.precioActual, 105);
    assert.equal(result.variacionPct, 5);
    assert.equal(result.estadoSentimiento, 'disponible');
    assert.equal(result.cantidadNoticias, 1);
    assert.equal(result.detalleNoticias[0].fuente, 'Example');
    assert.equal(result.detalleNoticias[0].url, 'https://example.com/story');
    assert.equal(result.periodoVariacion, 'vs. cierre anterior del intervalo');
});

test('reports missing news separately and suppresses a sentiment signal', () => {
    const result = buildAnalysis({
        ticker: 'AAPL', chart: { quotes: [{ date: new Date(), close: 20 }] }, news: [{ title: '' }]
    });
    assert.equal(result.estadoSentimiento, 'sin_datos');
    assert.equal(result.estadoNoticias, 'sin_noticias_relevantes');
    assert.equal(result.sentimientoPromedio, null);
    assert.equal(result.senal, 'SIN DATOS');
    assert.equal(result.variacionPct, null);
});

test('rejects charts without usable closes', () => {
    assert.throws(() => buildAnalysis({ ticker: 'BAD', chart: { quotes: [{ close: null }] } }), { code: 'NO_QUOTES' });
});
