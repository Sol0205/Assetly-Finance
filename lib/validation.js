'use strict';

const PERIODS = new Set(['1mo', '3mo', '6mo', '1y']);
const INTERVALS = new Set(['1d', '1h']);

function validateAnalysisQuery(query = {}) {
    const ticker = String(query.ticker || '').trim().toUpperCase();
    const periodo = String(query.periodo || '3mo');
    const intervalo = String(query.intervalo || '1d');
    const umbralCompra = Number(query.umbralCompra ?? 0.5);
    const umbralVenta = Number(query.umbralVenta ?? -0.5);

    if (!/^[A-Z0-9.^-]{1,15}$/.test(ticker)) {
        return { ok: false, message: 'Ingresá un símbolo válido (por ejemplo, AAPL o GGAL.BA).' };
    }
    if (!PERIODS.has(periodo)) {
        return { ok: false, message: 'El periodo seleccionado no es válido.' };
    }
    if (!INTERVALS.has(intervalo)) {
        return { ok: false, message: 'El intervalo seleccionado no es válido.' };
    }
    if (!Number.isFinite(umbralCompra) || umbralCompra < 0 || umbralCompra > 1) {
        return { ok: false, message: 'El umbral de compra debe estar entre 0 y 1.' };
    }
    if (!Number.isFinite(umbralVenta) || umbralVenta < -1 || umbralVenta > 0) {
        return { ok: false, message: 'El umbral de venta debe estar entre -1 y 0.' };
    }
    if (umbralVenta >= umbralCompra) {
        return { ok: false, message: 'El umbral de venta debe ser menor que el de compra.' };
    }

    return { ok: true, value: { ticker, periodo, intervalo, umbralCompra, umbralVenta } };
}

function isValidPhoneNumber(value) {
    return typeof value === 'string' && /^\+[1-9]\d{7,14}$/.test(value.trim());
}

function normalizePhoneNumber(value) {
    let digits = String(value || '').trim().replace(/\D/g, '');
    if (String(value || '').trim().startsWith('00')) digits = digits.slice(2);
    return digits ? `+${digits}` : '';
}

module.exports = { validateAnalysisQuery, isValidPhoneNumber, normalizePhoneNumber, PERIODS, INTERVALS };
