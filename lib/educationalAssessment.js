'use strict';

function stateFor(score, positiveAt = 0.35) {
    if (score >= positiveAt) return 'favorable';
    if (score <= -positiveAt) return 'desfavorable';
    return 'mixto';
}

function buildEducationalAssessment({ periodo, variacionPct, fundamentals, sentimiento, titularesValidos = 0, umbralCompra = 0.5, umbralVenta = -0.5 }) {
    const components = [];
    if (Number.isFinite(variacionPct)) {
        const score = variacionPct >= 5 ? 1 : variacionPct <= -5 ? -1 : 0;
        components.push({ id: 'precio', nombre: 'Tendencia del precio', puntaje: score, estado: stateFor(score), detalle: `${variacionPct > 0 ? '+' : ''}${variacionPct.toFixed(2)}% en ${periodo || 'el periodo consultado'}; umbrales descriptivos: ±5%.` });
    } else {
        components.push({ id: 'precio', nombre: 'Tendencia del precio', puntaje: null, estado: 'sin_datos', detalle: 'No hay una variación válida para el periodo seleccionado.' });
    }

    const tests = [
        ['Crecimiento de ingresos', fundamentals?.revenueGrowth, (v) => v > 0],
        ['Margen neto', fundamentals?.profitMargins, (v) => v > 0],
        ['Retorno sobre patrimonio', fundamentals?.returnOnEquity, (v) => v > 0],
        ['Flujo de caja libre', fundamentals?.freeCashflow, (v) => v > 0],
        ['Deuda / patrimonio', fundamentals?.debtToEquity, (v) => v < 200, (v) => v > 300]
    ].filter(([, value]) => Number.isFinite(value));
    if (tests.length >= 3) {
        const scores = tests.map(([, value, favorable, adverse]) => favorable(value) ? 1 : adverse?.(value) ? -1 : 0);
        const score = scores.reduce((sum, item) => sum + item, 0) / scores.length;
        const metricDetail = tests.map(([name, value], index) => {
            const rendered = ['Crecimiento de ingresos', 'Margen neto', 'Retorno sobre patrimonio'].includes(name)
                ? `${(value * 100).toFixed(2)}%`
                : name === 'Flujo de caja libre'
                    ? `${value.toLocaleString('es-AR', { maximumFractionDigits: 0 })} ${fundamentals.currency || ''}`.trim()
                    : `${value.toFixed(2)}%`;
            const direction = scores[index] > 0 ? 'favorable' : scores[index] < 0 ? 'desfavorable' : 'mixto';
            return `${name}: ${rendered} (${direction})`;
        }).join('; ');
        components.push({ id: 'fundamentos', nombre: 'Fundamentos', puntaje: score, estado: stateFor(score), detalle: `${scores.filter((v) => v > 0).length} favorables, ${scores.filter((v) => v < 0).length} desfavorables y ${scores.filter((v) => v === 0).length} mixtos, de ${tests.length} métricas. ${metricDetail}` });
    } else {
        components.push({ id: 'fundamentos', nombre: 'Fundamentos', puntaje: null, estado: 'sin_datos', detalle: `Se requieren al menos 3 métricas comparables; disponibles: ${tests.length}.` });
    }

    if (titularesValidos >= 3 && Number.isFinite(sentimiento)) {
        const score = sentimiento >= umbralCompra ? 1 : sentimiento <= umbralVenta ? -1 : 0;
        components.push({ id: 'noticias', nombre: 'Sentimiento de noticias', puntaje: score, estado: stateFor(score), detalle: `VADER ${sentimiento.toFixed(3)} sobre ${titularesValidos} titulares válidos; umbrales configurados ${umbralCompra.toFixed(2)} / ${umbralVenta.toFixed(2)}.` });
    } else {
        components.push({ id: 'noticias', nombre: 'Sentimiento de noticias', puntaje: null, estado: titularesValidos ? 'muestra_insuficiente' : 'sin_datos', detalle: `${titularesValidos} titulares válidos; se requieren al menos 3 para incluir este factor.` });
    }

    const valid = components.filter((item) => Number.isFinite(item.puntaje));
    const weights = { precio: 0.4, fundamentos: 0.4, noticias: 0.2 };
    const weightTotal = valid.reduce((sum, item) => sum + weights[item.id], 0);
    const score = valid.length >= 2 ? valid.reduce((sum, item) => sum + item.puntaje * weights[item.id], 0) / weightTotal : null;
    const resultado = score == null ? 'DATOS INSUFICIENTES' : score >= 0.35 ? 'COMPRAR · LECTURA EDUCATIVA' : score <= -0.35 ? 'VENDER · LECTURA EDUCATIVA' : 'MANTENER · LECTURA EDUCATIVA';
    return {
        resultado,
        puntaje: score == null ? null : Math.round(score * 1000) / 1000,
        cobertura: valid.length,
        componentes: components,
        pesos: weights,
        periodo: periodo || null,
        metodologia: 'Reglas descriptivas: precio favorable desde +5% y desfavorable desde −5% en el periodo elegido. Fundamentos: crecimiento, margen neto, retorno sobre patrimonio y flujo de caja libre mayores a 0 se cuentan favorables; deuda/patrimonio <200 favorable, >300 desfavorable; se necesitan 3 de 5 métricas. Noticias: se usan solo con 3 o más titulares y los umbrales VADER configurados. Ponderación 40% precio, 40% fundamentos, 20% noticias, reescalada si falta un factor. Se requieren 2 factores. Estos cortes son heurísticos, no han sido validados como estrategia de inversión.',
        aviso: 'Lectura automática no personalizada, educativa y sensible a la calidad de las fuentes. No es asesoramiento financiero ni una predicción; revisá los datos y tu situación antes de decidir.'
    };
}

module.exports = { buildEducationalAssessment };
