/**
 * Módulo de Análisis de Sentimiento
 * -----------------------------------
 * Usa vader-sentiment, un puerto en JavaScript de VADER (Valence Aware
 * Dictionary and sEntiment Reasoner): un analizador léxico, rápido y sin
 * necesidad de entrenamiento previo. Devuelve un score 'compound' entre
 * -1 (muy negativo) y +1 (muy positivo), compatible con los umbrales
 * pedidos (+0.5 compra / -0.5 venta).
 */

const vader = require('vader-sentiment');

/**
 * Analiza el sentimiento de una lista de noticias.
 * @param {Array<{title?: string}>} noticias - noticias con al menos 'title'.
 * @returns {{ promedio: number, detalle: Array<{titulo: string, score: number}> }}
 */
function analizarSentimientoNoticias(noticias) {
    if (!noticias || noticias.length === 0) {
        return { promedio: 0, detalle: [] };
    }

    const detalle = [];
    const scores = [];

    for (const noticia of noticias) {
        const titulo = typeof noticia?.title === 'string' ? noticia.title.trim() : '';
        if (!titulo) continue;

        const resultado = vader.SentimentIntensityAnalyzer.polarity_scores(titulo);
        const compound = resultado.compound;

        scores.push(compound);
        const providerTime = noticia?.providerPublishTime;
        let parsedDate = NaN;
        if (providerTime instanceof Date) {
            parsedDate = providerTime.getTime();
        } else if (typeof providerTime === 'number' && Number.isFinite(providerTime)) {
            parsedDate = new Date(providerTime < 1e12 ? providerTime * 1000 : providerTime).getTime();
        } else if (typeof providerTime === 'string' && providerTime.trim()) {
            const numericTime = Number(providerTime);
            parsedDate = Number.isFinite(numericTime)
                ? new Date(numericTime < 1e12 ? numericTime * 1000 : numericTime).getTime()
                : Date.parse(providerTime);
        } else if (noticia?.publishedAt != null) {
            parsedDate = new Date(noticia.publishedAt).getTime();
        }
        let paginaFuente = null;
        try { if (new URL(noticia.link).hostname.replace(/^www\./i, '').toLowerCase() === 'finance.yahoo.com') paginaFuente = 'Yahoo Finance · republicación atribuida'; }
        catch { /* no se presenta un enlace inválido */ }
        detalle.push({
            titulo,
            score: Math.round(compound * 1000) / 1000,
            fuente: typeof noticia?.publisher === 'string' ? noticia.publisher : null,
            paginaFuente,
            fecha: Number.isFinite(parsedDate) ? new Date(parsedDate).toISOString() : null,
            url: typeof noticia?.link === 'string' && /^https:\/\//i.test(noticia.link) ? noticia.link : null
        });
    }

    const promedio = scores.length > 0
        ? Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 1000) / 1000
        : 0;

    return { promedio, detalle };
}

module.exports = { analizarSentimientoNoticias };
