'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { validateAnalysisQuery, isValidPhoneNumber } = require('../lib/validation');

test('accepts a valid ticker and applies safe defaults', () => {
    const result = validateAnalysisQuery({ ticker: ' aapl ' });
    assert.equal(result.ok, true);
    assert.deepEqual(result.value, {
        ticker: 'AAPL', periodo: '3mo', intervalo: '1d', umbralCompra: 0.5, umbralVenta: -0.5
    });
});

test('accepts common exchange ticker punctuation', () => {
    assert.equal(validateAnalysisQuery({ ticker: 'GGAL.BA' }).ok, true);
    assert.equal(validateAnalysisQuery({ ticker: '^GSPC' }).ok, true);
});

test('rejects invalid ticker and period values', () => {
    assert.equal(validateAnalysisQuery({ ticker: '<script>' }).ok, false);
    assert.equal(validateAnalysisQuery({ ticker: 'AAPL', periodo: 'max' }).ok, false);
    assert.equal(validateAnalysisQuery({ ticker: 'AAPL', intervalo: '1m' }).ok, false);
});

test('rejects non-finite, out-of-range, and overlapping thresholds', () => {
    for (const query of [
        { ticker: 'AAPL', umbralCompra: 'NaN' },
        { ticker: 'AAPL', umbralCompra: 1.1 },
        { ticker: 'AAPL', umbralVenta: -1.1 },
        { ticker: 'AAPL', umbralCompra: 0.3, umbralVenta: 0.3 },
        { ticker: 'AAPL', umbralCompra: 0.2, umbralVenta: 0.4 }
    ]) assert.equal(validateAnalysisQuery(query).ok, false);
});

test('accepts international E.164-style phone numbers only', () => {
    assert.equal(isValidPhoneNumber('+5491122334455'), true);
    assert.equal(isValidPhoneNumber('1122334455'), false);
    assert.equal(isValidPhoneNumber('+0123'), false);
});
