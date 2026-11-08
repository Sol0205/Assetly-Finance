'use strict';

const { analizarSentimientoNoticias } = require('./sentiment');
const { generarSenal } = require('./decisionLogic');

const NAME_SUFFIXES = new Set(['inc', 'incorporated', 'corp', 'corporation', 'company', 'co', 'plc', 'ltd', 'limited', 'holdings', 'holding', 'group', 'class']);

function normalizeWords(value) {
    return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function hasPublisherSource(item) {
    if (typeof item?.publisher !== 'string' || !item.publisher.trim() || typeof item?.link !== 'string') return false;
    let hostname;
    try {
        const parsed = new URL(item.link);
        if (parsed.protocol !== 'https:') return false;
        hostname = parsed.hostname.toLowerCase().replace(/^www\./, '');
        // Yahoo Finance serves attributed, syndicated publisher stories on its own article URLs.
        // The source remains explicitly attributed in the UI; ordinary Yahoo pages are not accepted.
        if (hostname === 'finance.yahoo.com' && (/^\/m\//.test(parsed.pathname) || /^\/markets\/stocks\/articles\//.test(parsed.pathname))) return true;
    } catch { return false; }
    const publisher = normalizeWords(item.publisher).replace(/\s+/g, '');
    const aliases = {
        'associatedpress': ['apnews'], 'thewallstreetjournal': ['wsj'], 'themotleyfool': ['fool'],
        'financialtimes': ['ft'], 'prnewswire': ['prnewswire'], 'businesswire': ['businesswire'],
        'globenewswire': ['globenewswire'], 'yahoofinance': ['yahoo']
    };
    const tokens = (aliases[publisher] || [publisher]).filter((token) => token.length >= 3);
    return tokens.some((token) => hostname.split('.').some((label) => label.includes(token)));
}

function filterRelevantNews(news, ticker, meta = {}) {
    const aliases = new Set();
    for (const name of [meta.shortName, meta.longName]) {
        const words = normalizeWords(name).split(/\s+/).filter((word) => word && !NAME_SUFFIXES.has(word));
        if (words.length) aliases.add(words.join(' '));
        for (const word of words) if (word.length >= 3) aliases.add(word);
    }
    const symbol = normalizeWords(ticker);
    if (symbol.length >= 2) aliases.add(symbol);

    return (Array.isArray(news) ? news : []).filter((item) => {
        if (!hasPublisherSource(item)) return false;
        const title = ` ${normalizeWords(item?.title)} `;
        return title.trim().length > 0 && [...aliases].some((alias) => title.includes(` ${alias} `));
    });
}

function providerDate(value) {
    if (value instanceof Date) return Number.isFinite(value.getTime()) ? value : null;
    if (typeof value === 'number') {
        const milliseconds = value < 1e12 ? value * 1000 : value;
        const date = new Date(milliseconds);
        return Number.isFinite(date.getTime()) ? date : null;
    }
    const date = value ? new Date(value) : null;
    return date && Number.isFinite(date.getTime()) ? date : null;
}

function selectLivePrice(quote) {
    if (!quote) return null;
    const state = String(quote.marketState || 'CLOSED').toUpperCase();
    const extendedDate = providerDate(quote.extendedMarketTime);
    if (['PRE', 'PREPRE'].includes(state) && Number.isFinite(quote.preMarketPrice)) {
        return { price: quote.preMarketPrice, date: providerDate(quote.preMarketTime) || extendedDate, state, kind: 'preMarket', previousClose: quote.regularMarketPreviousClose };
    }
    if (['POST', 'POSTPOST'].includes(state) && Number.isFinite(quote.postMarketPrice)) {
        return { price: quote.postMarketPrice, date: providerDate(quote.postMarketTime) || extendedDate, state, kind: 'postMarket', previousClose: quote.regularMarketPreviousClose };
    }
    if (Number.isFinite(quote.regularMarketPrice)) {
        return { price: quote.regularMarketPrice, date: providerDate(quote.regularMarketTime), state, kind: 'regularMarket', changePct: quote.regularMarketChangePercent, previousClose: quote.regularMarketPreviousClose };
    }
    if (Number.isFinite(quote.extendedMarketPrice)) return { price: quote.extendedMarketPrice, date: extendedDate, state, kind: 'extendedMarket', previousClose: quote.regularMarketPreviousClose };
    return null;
}

function buildPeriodSummary(quotes = []) {
    if (!quotes.length) return null;
    const first = quotes[0];
    const last = quotes[quotes.length - 1];
    const valid = quotes.filter((quote) => Number.isFinite(quote.close));
    if (!valid.length || !Number.isFinite(first.close) || !Number.isFinite(last.close) || first.close === 0) return null;
    const high = valid.reduce((best, quote) => quote.close > best.close ? quote : best, valid[0]);
    const low = valid.reduce((best, quote) => quote.close < best.close ? quote : best, valid[0]);
    return {
        desde: first.date,
        hasta: last.date,
        precioInicial: first.close,
        precioFinal: last.close,
        variacionPct: Math.round(((last.close - first.close) / first.close) * 10000) / 100,
        maximo: { precio: high.close, fecha: high.date },
        minimo: { precio: low.close, fecha: low.date },
        observaciones: valid.length,
        definicion: 'Variación del primer al último cierre del periodo seleccionado; no es rendimiento total ni incluye dividendos.'
    };
}

function buildAnalysis({ ticker, chart, liveQuote = null, quoteError = false, news = [], newsError = false, umbralCompra = 0.5, umbralVenta = -0.5 }) {
    const quotes = (chart?.quotes || [])
        .filter((quote) => Number.isFinite(quote.close) && quote.date && Number.isFinite(new Date(quote.date).getTime()))
        .sort((a, b) => new Date(a.date) - new Date(b.date));

    if (quotes.length === 0) {
        const error = new Error('No se encontraron cotizaciones para ese símbolo y periodo.');
        error.code = 'NO_QUOTES';
        throw error;
    }

    const latest = quotes[quotes.length - 1];
    const previous = quotes.length > 1 ? quotes[quotes.length - 2] : null;
    const currentQuote = selectLivePrice(liveQuote);
    const baselinePrice = currentQuote?.previousClose ?? previous?.close ?? null;
    const changePct = Number.isFinite(currentQuote?.changePct)
        ? currentQuote.changePct
        : baselinePrice !== null && baselinePrice !== 0
            ? ((currentQuote?.price ?? latest.close) - baselinePrice) / baselinePrice * 100
            : null;
    const { promedio, detalle } = analizarSentimientoNoticias(news);
    const senal = detalle.length > 0
        ? generarSenal(promedio, umbralCompra, umbralVenta)
        : { senal: 'SIN DATOS', icono: '—', color: '#8993a4' };

    return {
        ticker,
        nombre: chart?.meta?.shortName || chart?.meta?.longName || ticker,
        moneda: chart?.meta?.currency || null,
        exchange: chart?.meta?.fullExchangeName || chart?.meta?.exchangeName || null,
        zonaHoraria: chart?.meta?.exchangeTimezoneName || null,
        precioActual: currentQuote?.price ?? latest.close,
        fechaPrecio: currentQuote?.date ?? latest.date,
        tipoPrecio: currentQuote ? currentQuote.kind : 'lastClose',
        estadoMercado: currentQuote?.state ?? null,
        retrasoMinutos: Number.isFinite(liveQuote?.exchangeDataDelayedBy) ? liveQuote.exchangeDataDelayedBy : null,
        fuenteCotizacion: liveQuote?.quoteSourceName || null,
        estadoCotizacion: currentQuote ? 'actualizada' : quoteError ? 'solo_cierre_historico' : 'sin_cotizacion_intradia',
        estadoActualizacion: liveQuote?.quoteSourceName === 'Twelve Data' ? 'proveedor_alternativo' : currentQuote ? 'actualizada' : quoteError ? 'sin_actualizar' : 'actualizada',
        avisoActualizacion: liveQuote?.quoteSourceName === 'Twelve Data' ? 'Yahoo Finance no respondió. La cotización viene de Twelve Data tras validar símbolo, moneda, mercado, horario y tipo de precio.' : null,
        avisoCotizacion: quoteError ? 'No se pudo consultar el precio actual; se muestra el último cierre de la serie histórica.' : null,
        precioAnterior: baselinePrice,
        fechaPrecioAnterior: previous?.date ?? null,
        variacionPct: changePct,
        periodoVariacion: currentQuote ? 'vs. cierre previo de la sesión' : previous ? 'vs. cierre anterior del intervalo' : null,
        precios: quotes.map(({ date, close }) => ({ fecha: date, close })),
        resumenPeriodo: buildPeriodSummary(quotes),
        sentimientoPromedio: detalle.length ? promedio : null,
        estadoSentimiento: detalle.length ? 'disponible' : 'sin_datos',
        estadoNoticias: newsError ? 'error' : detalle.length ? 'disponibles' : 'sin_noticias_relevantes',
        cantidadNoticias: detalle.length,
        detalleNoticias: detalle,
        senal: senal.senal,
        icono: senal.icono,
        color: senal.color,
        umbralCompra,
        umbralVenta,
        generadoEn: new Date().toISOString(),
        fuentes: ['Yahoo Finance', 'VADER']
    };
}

module.exports = { buildAnalysis, buildPeriodSummary, filterRelevantNews, selectLivePrice, providerDate, hasPublisherSource };
