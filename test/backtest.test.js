'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { backtestSentiment } = require('../lib/backtest');
const { readCsv, parseCsvLine } = require('../scripts/backtest');

test('backtests dated sentiment as a long/cash strategy against buy-and-hold', () => {
    const result = backtestSentiment([
        { fecha: '2026-01-01', cierre: 100, sentimiento: 0.7 },
        { fecha: '2026-01-02', cierre: 110, sentimiento: -0.8 },
        { fecha: '2026-01-03', cierre: 99, sentimiento: 0 }
    ]);
    assert.ok(Math.abs(result.retornoEstrategiaPct - 10) < 1e-9);
    assert.ok(Math.abs(result.retornoBenchmarkPct + 1) < 1e-9);
    assert.equal(result.operaciones, 2);
    assert.equal(result.periodosInvertidos, 1);
    assert.equal(result.aciertoEnPeriodosInvertidosPct, 100);
    assert.equal(result.modo, 'long/cash');
});

test('charges entry and exit costs', () => {
    const result = backtestSentiment([
        { fecha: '2026-01-01', cierre: 100, sentimiento: 0.7 },
        { fecha: '2026-01-02', cierre: 110, sentimiento: -0.8 },
        { fecha: '2026-01-03', cierre: 99, sentimiento: 0 }
    ], { costoBps: 100 });
    assert.ok(result.retornoEstrategiaPct < 10);
});

test('rejects malformed, non-monotonic, and too-short histories', () => {
    assert.throws(() => backtestSentiment([]), /al menos dos/);
    assert.throws(() => backtestSentiment([
        { fecha: '2026-01-02', cierre: 100, sentimiento: 0 },
        { fecha: '2026-01-01', cierre: 101, sentimiento: 0 }
    ]), /ordenadas/);
    assert.throws(() => backtestSentiment([
        { fecha: '2026-01-01', cierre: 100, sentimiento: 2 },
        { fecha: '2026-01-02', cierre: 101, sentimiento: 0 }
    ]), /inválido/);
});

test('reads CSV columns by header and handles quoted commas', () => {
    assert.deepEqual(parseCsvLine('"2026-01-01",100,"0.7, note"'), ['2026-01-01', '100', '0.7, note']);
    const rows = readCsv('fecha,cierre,sentimiento\n2026-01-01,100,0.2\n2026-01-02,101,-0.1');
    assert.deepEqual(rows, [
        { fecha: '2026-01-01', cierre: '100', sentimiento: '0.2' },
        { fecha: '2026-01-02', cierre: '101', sentimiento: '-0.1' }
    ]);
    assert.throws(() => readCsv('date,close,score\na,b,c'), /encabezado/);
});
