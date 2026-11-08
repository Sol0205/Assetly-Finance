#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { backtestSentiment } = require('../lib/backtest');

function parseCsvLine(line) {
    const fields = [];
    let field = '';
    let quoted = false;
    for (let index = 0; index < line.length; index += 1) {
        const char = line[index];
        if (char === '"' && quoted && line[index + 1] === '"') {
            field += '"';
            index += 1;
        } else if (char === '"') quoted = !quoted;
        else if (char === ',' && !quoted) {
            fields.push(field.trim());
            field = '';
        } else field += char;
    }
    if (quoted) throw new Error('El CSV tiene comillas sin cerrar.');
    fields.push(field.trim());
    return fields;
}

function readCsv(csv) {
    const lines = csv.split(/\r?\n/).filter((line) => line.trim() && !line.trim().startsWith('#'));
    if (lines.length < 2) throw new Error('El CSV debe tener encabezado y al menos dos filas.');
    const header = parseCsvLine(lines[0]).map((name) => name.toLowerCase());
    const indexes = ['fecha', 'cierre', 'sentimiento'].map((name) => header.indexOf(name));
    if (indexes.some((index) => index < 0)) throw new Error('El encabezado debe incluir fecha,cierre,sentimiento.');
    return lines.slice(1).map((line, index) => {
        const fields = parseCsvLine(line);
        if (fields.length !== header.length) throw new Error(`Fila ${index + 2}: cantidad de columnas inesperada.`);
        return { fecha: fields[indexes[0]], cierre: fields[indexes[1]], sentimiento: fields[indexes[2]] };
    });
}

function argValue(flag, fallback) {
    const index = process.argv.indexOf(flag);
    if (index < 0) return fallback;
    const value = Number(process.argv[index + 1]);
    if (!Number.isFinite(value)) throw new Error(`Valor inválido para ${flag}.`);
    return value;
}

function main() {
    const file = process.argv[2];
    if (!file || file.startsWith('--')) {
        throw new Error('Uso: node scripts/backtest.js <historial.csv> [--buy 0.5] [--sell -0.5] [--cost-bps 5]');
    }
    const rows = readCsv(fs.readFileSync(path.resolve(file), 'utf8'));
    const result = backtestSentiment(rows, {
        umbralCompra: argValue('--buy', 0.5),
        umbralVenta: argValue('--sell', -0.5),
        costoBps: argValue('--cost-bps', 0)
    });
    const { curva, ...summary } = result;
    console.log(JSON.stringify(summary, null, 2));
}

if (require.main === module) {
    try {
        main();
    } catch (error) {
        console.error(`Backtest cancelado: ${error.message}`);
        process.exitCode = 1;
    }
}

module.exports = { readCsv, parseCsvLine };
