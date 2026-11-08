'use strict';

const { generarSenal } = require('./decisionLogic');

function backtestSentiment(rows, { umbralCompra = 0.5, umbralVenta = -0.5, costoBps = 0 } = {}) {
    if (!Array.isArray(rows) || rows.length < 2) {
        throw new Error('El backtest necesita al menos dos observaciones históricas.');
    }
    if (!Number.isFinite(umbralCompra) || !Number.isFinite(umbralVenta)
        || umbralVenta >= umbralCompra || !Number.isFinite(costoBps) || costoBps < 0) {
        throw new Error('Los umbrales o el costo de transacción no son válidos.');
    }

    const data = rows.map((row, index) => {
        const time = Date.parse(row.fecha);
        const close = Number(row.cierre);
        const sentimiento = Number(row.sentimiento);
        if (!Number.isFinite(time) || !Number.isFinite(close) || close <= 0
            || !Number.isFinite(sentimiento) || sentimiento < -1 || sentimiento > 1) {
            throw new Error(`Fila ${index + 2}: fecha, cierre o sentimiento inválido.`);
        }
        return { fecha: new Date(time).toISOString(), cierre: close, sentimiento };
    });

    for (let index = 1; index < data.length; index += 1) {
        if (Date.parse(data[index].fecha) <= Date.parse(data[index - 1].fecha)) {
            throw new Error('Las fechas deben estar ordenadas y no repetirse.');
        }
    }

    let strategyValue = 1;
    let benchmarkValue = 1;
    let previousPosition = 0;
    let profitablePeriods = 0;
    let investedPeriods = 0;
    let trades = 0;
    let peak = 1;
    let maxDrawdown = 0;
    const costRate = costoBps / 10_000;
    const curve = [{ fecha: data[0].fecha, estrategia: 1, benchmark: 1 }];

    for (let index = 0; index < data.length - 1; index += 1) {
        const { senal } = generarSenal(data[index].sentimiento, umbralCompra, umbralVenta);
        // Long/cash: COMPRA mantiene exposición; VENTA y MANTENER quedan en efectivo.
        const position = senal === 'COMPRA' ? 1 : 0;
        const marketReturn = (data[index + 1].cierre / data[index].cierre) - 1;
        const turnover = Math.abs(position - previousPosition);
        const strategyReturn = (position * marketReturn) - (turnover * costRate);
        strategyValue *= 1 + strategyReturn;
        benchmarkValue *= 1 + marketReturn;
        if (position) {
            investedPeriods += 1;
            if (strategyReturn > 0) profitablePeriods += 1;
        }
        if (turnover > 0) trades += 1;
        previousPosition = position;
        peak = Math.max(peak, strategyValue);
        maxDrawdown = Math.max(maxDrawdown, (peak - strategyValue) / peak);
        curve.push({ fecha: data[index + 1].fecha, estrategia: strategyValue, benchmark: benchmarkValue });
    }

    return {
        observaciones: data.length,
        periodos: data.length - 1,
        inicio: data[0].fecha,
        fin: data[data.length - 1].fecha,
        modo: 'long/cash',
        umbralCompra,
        umbralVenta,
        costoBps,
        retornoEstrategiaPct: (strategyValue - 1) * 100,
        retornoBenchmarkPct: (benchmarkValue - 1) * 100,
        maxDrawdownPct: maxDrawdown * 100,
        operaciones: trades,
        periodosInvertidos: investedPeriods,
        aciertoEnPeriodosInvertidosPct: investedPeriods ? (profitablePeriods / investedPeriods) * 100 : null,
        curva: curve
    };
}

module.exports = { backtestSentiment };
