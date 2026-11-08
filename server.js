'use strict';

require('dotenv').config();
const express = require('express');
const path = require('path');
const crypto = require('crypto');
const { buildAnalysis, filterRelevantNews } = require('./lib/analysis');
const { validateAnalysisQuery, isValidPhoneNumber, normalizePhoneNumber } = require('./lib/validation');
const { selectLivePrice } = require('./lib/analysis');
const { crearEnlaceWhatsapp } = require('./lib/whatsappAlert');
const { UserStore } = require('./lib/userStore');
const { MarketCache } = require('./lib/marketCache');
const { TwelveDataProvider, isComparableSecondaryQuote, normalizeMarketName } = require('./lib/providers/twelveData');
const { buildEducationalAssessment } = require('./lib/educationalAssessment');

const MAX_STALE_QUOTE_MS = 7 * 24 * 60 * 60 * 1000;
function normalizeQuote(ticker, quote) {
    const selected = selectLivePrice(quote);
    if (!selected) return null;
    const baseline = selected.previousClose;
    const variacionPct = Number.isFinite(selected.changePct)
        ? selected.changePct
        : Number.isFinite(baseline) && baseline !== 0 ? ((selected.price - baseline) / baseline) * 100 : null;
    return { ticker, nombre: quote.shortName || quote.longName || ticker, precio: selected.price, fecha: selected.date?.toISOString?.() || null, tipo: selected.kind, estadoMercado: selected.state, moneda: quote.currency || null, exchange: quote.fullExchangeName || quote.exchange || null, variacionPct, retrasoMinutos: Number.isFinite(quote.exchangeDataDelayedBy) ? quote.exchangeDataDelayedBy : null, fuente: quote.quoteSourceName || 'Yahoo Finance' };
}

function staleQuote(cache, ticker) {
    const entry = cache.get(`quote:${ticker}`, MAX_STALE_QUOTE_MS);
    return entry ? { ...entry.value, estadoActualizacion: 'desactualizada', cacheGuardadaEn: entry.savedAt, avisoActualizacion: 'No se pudo actualizar la cotización. Se muestra el último dato disponible, no una cotización actual.' } : null;
}

function secondaryQuoteWarning(data) {
    return { ...data, estadoActualizacion: 'proveedor_alternativo', avisoActualizacion: 'Yahoo Finance no respondió. Esta cotización fue obtenida de un proveedor alternativo y validada por símbolo, moneda, mercado, horario y tipo de precio.' };
}

let yahooFinancePromise;
function getYahooFinance() {
    if (!yahooFinancePromise) {
        yahooFinancePromise = import('yahoo-finance2')
            .then((mod) => new mod.default())
            .catch((error) => {
                yahooFinancePromise = null;
                throw error;
            });
    }
    return yahooFinancePromise;
}

function periodStart(periodo, now = new Date()) {
    const start = new Date(now);
    const months = { '1mo': 1, '3mo': 3, '6mo': 6, '1y': 12 }[periodo];
    const day = start.getUTCDate();
    start.setUTCDate(1);
    start.setUTCMonth(start.getUTCMonth() - months);
    const lastDay = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 0)).getUTCDate();
    start.setUTCDate(Math.min(day, lastDay));
    return start;
}

function toIsoDate(value) {
    if (value instanceof Date && Number.isFinite(value.getTime())) return value.toISOString();
    if (typeof value === 'number' && Number.isFinite(value)) {
        const date = new Date(value < 1e12 ? value * 1000 : value);
        return Number.isFinite(date.getTime()) ? date.toISOString() : null;
    }
    const date = value ? new Date(value) : null;
    return date && Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function financeNumber(value) {
    if (Number.isFinite(value)) return value;
    const raw = value && typeof value === 'object' ? (value.raw ?? value.value) : null;
    return Number.isFinite(raw) ? raw : null;
}

function officialExchangePage(exchangeName, ticker) {
    const exchange = String(exchangeName || '').toLowerCase();
    const symbol = String(ticker || '').trim();
    if (!symbol || !/^[A-Za-z0-9.^=-]{1,15}$/.test(symbol)) return null;
    if (/nasdaq|\b(nms|ngm|ngs)\b/.test(exchange) && !symbol.startsWith('^')) {
        return { nombre: 'Nasdaq · mercado oficial', url: `https://www.nasdaq.com/market-activity/stocks/${encodeURIComponent(symbol.toLowerCase())}`, tipo: 'ficha_del_mercado' };
    }
    if (/nyse|new york stock exchange|\bxnys\b|\bnyq\b/.test(exchange) && !symbol.startsWith('^')) {
        return { nombre: 'NYSE · mercado oficial', url: `https://www.nyse.com/quote/XNYS:${encodeURIComponent(symbol.toUpperCase())}`, tipo: 'ficha_del_mercado' };
    }
    if (/byma|buenos aires|\bbue\b/.test(exchange)) {
        return { nombre: 'BYMA · sitio oficial del mercado', url: 'https://www.byma.com.ar/', tipo: 'sitio_del_mercado' };
    }
    return null;
}

function normalizeCalendarEvents(calendar, now = Date.now()) {
    if (!calendar) return [];
    const events = [];
    const add = (kind, label, value, estimated = false) => {
        const date = toIsoDate(value);
        if (!date || Date.parse(date) < now - 24 * 60 * 60 * 1000) return;
        events.push({ tipo: kind, titulo: label, fecha: date, estimado: estimated, fuente: 'Yahoo Finance' });
    };
    const earnings = calendar.earnings || {};
    (earnings.earningsDate || []).forEach((date) => add('resultados', earnings.isEarningsDateEstimate ? 'Fecha estimada de resultados' : 'Publicación de resultados', date, Boolean(earnings.isEarningsDateEstimate)));
    (earnings.earningsCallDate || []).forEach((date) => add('resultados', 'Llamada de resultados', date));
    add('dividendos', 'Fecha ex-dividendo', calendar.exDividendDate);
    add('dividendos', 'Fecha de pago de dividendo', calendar.dividendDate);
    return events.sort((a, b) => Date.parse(a.fecha) - Date.parse(b.fecha)).slice(0, 12);
}

async function fetchMarketAnalysis(yahooFinance, { ticker, periodo, intervalo, umbralCompra, umbralVenta }, { getSecondaryRawQuote, getCachedRawQuote } = {}) {
    const chart = await yahooFinance.chart(ticker, { period1: periodStart(periodo), interval: intervalo });
    let news = [];
    let newsError = false;
    let liveQuote = null;
    const results = await Promise.allSettled([
        yahooFinance.search(ticker, { newsCount: 20 }),
        typeof yahooFinance.quote === 'function' ? yahooFinance.quote(ticker) : Promise.resolve(null),
        typeof yahooFinance.quoteSummary === 'function' ? yahooFinance.quoteSummary(ticker, { modules: ['calendarEvents', 'assetProfile', 'financialData', 'defaultKeyStatistics', 'summaryDetail', 'price'] }) : Promise.resolve(null)
    ]);
    if (results[0].status === 'fulfilled') news = filterRelevantNews(results[0].value?.news, ticker, chart?.meta).slice(0, 10);
    else {
        newsError = true;
        console.warn(`[news] No se pudieron obtener noticias para ${ticker}: ${results[0].reason.message}`);
    }
    if (results[1].status === 'fulfilled') liveQuote = results[1].value;
    else console.warn(`[quote] No se pudo obtener cotización actual para ${ticker}: ${results[1].reason.message}`);
    const summary = results[2].status === 'fulfilled' ? results[2].value : null;
    const calendarEvents = summary ? normalizeCalendarEvents(summary.calendarEvents) : results[2].status === 'fulfilled' ? [] : null;
    if (results[2].status === 'rejected') console.warn(`[calendar] No se pudieron consultar eventos para ${ticker}: ${results[2].reason.message}`);
    if (!liveQuote && getSecondaryRawQuote) {
        try {
            liveQuote = await getSecondaryRawQuote(ticker);
            const expectedCurrency = chart?.meta?.currency;
            const expectedExchange = chart?.meta?.fullExchangeName || chart?.meta?.exchangeName;
            if (liveQuote && ((expectedCurrency && liveQuote.currency !== expectedCurrency)
                || (expectedExchange && normalizeMarketName(liveQuote.fullExchangeName) !== normalizeMarketName(expectedExchange)))) {
                console.warn(`[quote] Se descartó el respaldo de ${ticker}: moneda o mercado no coincide con la serie histórica.`);
                liveQuote = null;
            }
        }
        catch (error) { console.warn(`[quote] Proveedor alternativo no disponible para análisis de ${ticker}: ${error.message}`); }
    }
    let usedCache = false;
    if (!liveQuote && getCachedRawQuote) {
        liveQuote = getCachedRawQuote(ticker);
        usedCache = Boolean(liveQuote);
    }
    const analysis = buildAnalysis({ ticker, chart, liveQuote, quoteError: !liveQuote || usedCache, news, newsError, umbralCompra, umbralVenta });
    analysis.periodoSeleccionado = periodo;
    analysis.intervaloSeleccionado = intervalo;
    const financialData = summary?.financialData || {};
    const summaryDetail = summary?.summaryDetail || {};
    const quotePrice = summary?.price || {};
    const fundamentals = {
        revenueGrowth: financeNumber(financialData.revenueGrowth),
        profitMargins: financeNumber(financialData.profitMargins),
        returnOnEquity: financeNumber(financialData.returnOnEquity),
        freeCashflow: financeNumber(financialData.freeCashflow),
        debtToEquity: financeNumber(financialData.debtToEquity),
        marketCap: financeNumber(quotePrice.marketCap ?? summaryDetail.marketCap),
        trailingPE: financeNumber(summaryDetail.trailingPE),
        dividendYield: financeNumber(summaryDetail.dividendYield),
        sector: summary?.assetProfile?.sector || null,
        moneda: quotePrice.currency || financialData.financialCurrency || chart?.meta?.currency || null,
        currency: quotePrice.currency || financialData.financialCurrency || chart?.meta?.currency || null
    };
    analysis.fuentesOficiales = {
        cotizacion: { nombre: analysis.fuenteCotizacion || 'Yahoo Finance', fecha: analysis.fechaPrecio || null },
        fundamentos: { nombre: 'Yahoo Finance · estados financieros reportados', consultadoEn: new Date().toISOString() },
        noticias: (analysis.detalleNoticias || []).map((item) => ({ medio: item.fuente, url: item.url, pagina: item.paginaFuente || 'sitio del medio' })),
        mercado: officialExchangePage(`${chart?.meta?.exchangeName || ''} ${chart?.meta?.fullExchangeName || ''}`, ticker)
    };
    analysis.orientacionEducativa = buildEducationalAssessment({
        periodo,
        variacionPct: analysis.resumenPeriodo?.variacionPct ?? null,
        fundamentals,
        sentimiento: analysis.sentimientoPromedio,
        titularesValidos: analysis.cantidadNoticias,
        umbralCompra,
        umbralVenta
    });
    const validCloses = (chart?.quotes || []).filter((row) => Number.isFinite(row.close));
    const timestamps = validCloses.map((row) => new Date(row.date).getTime()).filter(Number.isFinite);
    const gaps = timestamps.slice(1).map((time, index) => (time - timestamps[index]) / 86400000).filter(Number.isFinite);
    analysis.calidadMuestra = { observaciones: validCloses.length, primerCierre: toIsoDate(validCloses[0]?.date), ultimoCierre: toIsoDate(validCloses.at(-1)?.date), mayorIntervaloDias: gaps.length ? Math.max(...gaps) : null, nota: 'Cantidad de cierres válidos recibidos del proveedor. Los intervalos sin cotización pueden corresponder a fines de semana o feriados; no es una medida de calidad certificada.' };
    analysis.calendarioEventos = calendarEvents;
    analysis.estadoCalendario = calendarEvents === null ? 'error' : calendarEvents.length ? 'disponible' : 'sin_eventos';
    const previousDate = chart?.quotes?.slice(-2, -1)[0]?.date;
    const variationStart = previousDate ? Date.parse(previousDate) : NaN;
    const variationEnd = Date.parse(analysis.fechaPrecio || '');
    analysis.contextoVariacion = {
        desde: toIsoDate(previousDate),
        hasta: toIsoDate(analysis.fechaPrecio),
        noticias: analysis.detalleNoticias.filter((item) => Number.isFinite(Date.parse(item.fecha || ''))
            && (!Number.isFinite(variationStart) || Date.parse(item.fecha) >= variationStart)
            && (!Number.isFinite(variationEnd) || Date.parse(item.fecha) <= variationEnd + 60 * 60 * 1000)),
        nota: 'La coincidencia temporal ayuda a investigar la variación, pero no demuestra que una noticia la haya causado.'
    };
    if (usedCache) {
        analysis.estadoActualizacion = 'desactualizada';
        analysis.estadoCotizacion = 'solo_cierre_historico';
        analysis.avisoActualizacion = 'No se pudo actualizar la cotización. Se muestra el último dato guardado, con su fuente y hora originales; no es un precio actual.';
    }
    return analysis;
}

function safeProviderFailure(error, random = Math.random, now = Date.now) {
    if (error.code === 'NO_QUOTES') {
        return { status: 404, body: { error: error.message, code: error.code } };
    }
    const requestId = `${now().toString(36)}-${random().toString(36).slice(2, 8)}`;
    return {
        status: 502,
        body: {
            error: 'No pudimos obtener los datos ahora. Revisá el símbolo o intentá de nuevo en unos minutos.',
            code: 'DATA_PROVIDER_ERROR',
            requestId
        }
    };
}

function consumeRateLimit(store, key, { limit, windowMs, now = Date.now() }) {
    if (!store.has(key) && store.size >= 1000) {
        for (const [storedKey, times] of store) {
            if (times.every((time) => now - time >= windowMs)) store.delete(storedKey);
        }
        if (store.size >= 1000) return false;
    }
    const attempts = (store.get(key) || []).filter((time) => now - time < windowMs);
    if (attempts.length >= limit) {
        store.set(key, attempts);
        return false;
    }
    attempts.push(now);
    store.set(key, attempts);
    return true;
}

function constantTimeTokenMatch(provided, expected) {
    if (typeof provided !== 'string' || typeof expected !== 'string' || !expected) return false;
    const actual = Buffer.from(provided);
    const target = Buffer.from(expected);
    return actual.length === target.length && crypto.timingSafeEqual(actual, target);
}

function createApp({ financeProvider, userStore = new UserStore() } = {}) {
    const app = express();
    app.disable('x-powered-by');
    app.use((req, res, next) => {
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
        res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
        res.setHeader('X-Frame-Options', 'DENY');
        res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' https://cdn.jsdelivr.net; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; connect-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'");
        next();
    });
    app.use(express.json({ limit: '12kb' }));
    app.use(express.static(path.join(__dirname, 'public'), { etag: true, maxAge: 0 }));

    const whatsappLinkAvailable = true;
    const alertAttempts = new Map();
    const analysisAttempts = new Map();
    const authAttempts = new Map();
    const quoteAttempts = new Map();
    const searchAttempts = new Map();
    const marketCache = new MarketCache();
    const secondaryProvider = new TwelveDataProvider();
    async function getSecondaryRawQuote(ticker, requireReference = false) {
        if (!secondaryProvider.configured) return null;
        try {
            const quote = await secondaryProvider.quote(ticker);
            const cached = marketCache.get(`quote:${ticker}`, MAX_STALE_QUOTE_MS);
            const reference = cached ? { ...cached.value, savedAt: cached.savedAt } : null;
            if (requireReference && !reference) {
                console.warn(`[quote] Se descartó el dato alternativo de Twelve Data para ${ticker}: no hay una referencia reciente del proveedor principal para comparar.`);
                return null;
            }
            if (!isComparableSecondaryQuote(ticker, quote, reference)) {
                console.warn(`[quote] Se descartó el dato alternativo de Twelve Data para ${ticker}: no pasó la validación de comparabilidad.`);
                return null;
            }
            return quote;
        } catch (error) {
            console.warn(`[quote] El proveedor alternativo no pudo entregar una cotización usable para ${ticker}: ${error.message}`);
            return null;
        }
    }
    async function getSecondaryQuote(ticker) {
        const quote = await getSecondaryRawQuote(ticker, true);
        const normalized = quote && normalizeQuote(ticker, quote);
        if (!normalized) return null;
        const data = secondaryQuoteWarning(normalized);
        data.consultadoEn = new Date().toISOString();
        marketCache.set(`quote:${ticker}`, data, data.consultadoEn);
        return data;
    }
    async function getSecondaryQuoteForAnalysis(ticker) {
        const quote = await getSecondaryRawQuote(ticker);
        const normalized = quote && normalizeQuote(ticker, quote);
        if (normalized) {
            const data = secondaryQuoteWarning(normalized);
            data.consultadoEn = new Date().toISOString();
            marketCache.set(`quote:${ticker}`, data, data.consultadoEn);
        }
        return quote;
    }
    function getCachedRawQuote(ticker) {
        const cached = staleQuote(marketCache, ticker);
        if (!cached || !Number.isFinite(cached.precio) || !cached.fecha) return null;
        return {
            symbol: cached.ticker,
            shortName: cached.nombre,
            regularMarketPrice: cached.precio,
            regularMarketTime: new Date(cached.fecha),
            regularMarketPreviousClose: Number.isFinite(cached.variacionPct) && cached.variacionPct !== -100
                ? cached.precio / (1 + cached.variacionPct / 100)
                : null,
            regularMarketChangePercent: cached.variacionPct,
            marketState: cached.estadoMercado || 'CLOSED',
            currency: cached.moneda,
            fullExchangeName: cached.exchange,
            quoteSourceName: cached.fuente || 'Proveedor original'
        };
    }
    let highlightsCache = { expiresAt: 0, data: null };
    const sessions = new Map();
    const sessionCookie = process.env.NODE_ENV === 'production' ? '__Host-ai-finance-session' : 'ai-finance-session';
    const defaultPhone = normalizePhoneNumber(process.env.DEFAULT_WHATSAPP_PHONE || '');
    const sessionMaxAge = 7 * 24 * 60 * 60 * 1000;

    function readSession(req) {
        const cookie = req.headers.cookie || '';
        const token = cookie.split(';').map((part) => part.trim()).find((part) => part.startsWith(`${sessionCookie}=`))?.slice(sessionCookie.length + 1);
        const session = token && sessions.get(token);
        if (!session || session.expires < Date.now()) { if (token) sessions.delete(token); return null; }
        return { token, user: userStore.get(session.userId) };
    }
    function requireAuth(req, res, next) {
        const session = readSession(req);
        if (!session?.user) return res.status(401).json({ error: 'Iniciá sesión para usar esta función.', code: 'AUTH_REQUIRED' });
        req.user = session.user;
        next();
    }
    function setSession(res, user) {
        const token = crypto.randomBytes(32).toString('base64url');
        sessions.set(token, { userId: user.id, expires: Date.now() + sessionMaxAge });
        res.setHeader('Set-Cookie', `${sessionCookie}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${Math.floor(sessionMaxAge / 1000)}${process.env.NODE_ENV === 'production' ? '; Secure' : ''}`);
    }
    function authRateLimited(req) {
        return !consumeRateLimit(authAttempts, req.ip || 'unknown', { limit: 8, windowMs: 60_000 });
    }

    app.get('/api/health', (req, res) => res.json({ ok: true, servicio: 'Assetly Finance', timestamp: new Date().toISOString() }));
    app.get('/api/config', (req, res) => res.json({ whatsappLinkAvailable, authenticated: Boolean(readSession(req)?.user) }));

    app.get('/api/market-highlights', async (req, res) => {
        if (highlightsCache.data && highlightsCache.expiresAt > Date.now()) {
            res.setHeader('Cache-Control', 'no-store');
            return res.json(highlightsCache.data);
        }
        const symbols = ['AAPL', 'MSFT', 'NVDA', 'GOOGL', 'SPY'];
        try {
            const yahoo = financeProvider || await getYahooFinance();
            const quotes = await yahoo.quote(symbols);
            const byTicker = new Map((Array.isArray(quotes) ? quotes : []).map((quote) => [String(quote.symbol || '').toUpperCase(), quote]));
            const assets = [];
            for (const ticker of symbols) {
                const quote = byTicker.get(ticker);
                const asset = quote ? normalizeQuote(ticker, quote) : null;
                if (asset) {
                    asset.estadoActualizacion = 'actualizada';
                    asset.consultadoEn = new Date().toISOString();
                    marketCache.set(`quote:${ticker}`, asset, asset.consultadoEn);
                    assets.push(asset);
                    continue;
                }
                const alternate = await getSecondaryQuote(ticker);
                assets.push(alternate || staleQuote(marketCache, ticker) || { ticker, nombre: ticker, estadoActualizacion: 'sin_datos', avisoActualizacion: 'No hay cotización disponible.' });
            }
            if (!assets.length) return res.status(502).json({ error: 'No hay cotizaciones disponibles en este momento.' });
            const hasWarnings = assets.some((asset) => asset.estadoActualizacion !== 'actualizada');
            const data = { assets, actualizadoEn: new Date().toISOString(), estadoActualizacion: hasWarnings ? 'parcial' : 'actualizada', avisoActualizacion: hasWarnings ? 'Hay símbolos que se obtuvieron de un proveedor alternativo, de la caché o que siguen sin dato; cada tarjeta indica su estado.' : null };
            highlightsCache = { expiresAt: Date.now() + 30_000, data };
            res.setHeader('Cache-Control', 'no-store');
            return res.json(data);
        } catch (error) {
            const alternateQuotes = await Promise.all(symbols.map((ticker) => getSecondaryQuote(ticker)));
            const assets = symbols.map((ticker, index) => alternateQuotes[index] || staleQuote(marketCache, ticker) || { ticker, nombre: ticker, estadoActualizacion: 'sin_datos', avisoActualizacion: 'No hay cotización disponible para este símbolo.' });
            if (assets.length) {
                const data = { assets, actualizadoEn: new Date().toISOString(), estadoActualizacion: 'proveedor_alternativo', avisoActualizacion: 'Yahoo Finance no respondió. Se muestran cotizaciones alternativas validadas o los últimos datos guardados, identificados por tarjeta.' };
                highlightsCache = { expiresAt: Date.now() + 15_000, data };
                res.setHeader('Cache-Control', 'no-store');
                return res.json(data);
            }
            const cachedAssets = symbols.flatMap((ticker) => staleQuote(marketCache, ticker) || []);
            if (cachedAssets.length) {
                const data = { assets: cachedAssets, actualizadoEn: new Date().toISOString(), estadoActualizacion: 'desactualizada', avisoActualizacion: 'Falló la actualización de mercado. Los valores visibles son los últimos datos guardados y conservan su hora y fuente originales.' };
                highlightsCache = { expiresAt: Date.now() + 15_000, data };
                res.setHeader('Cache-Control', 'no-store');
                return res.json(data);
            }
            const failure = safeProviderFailure(error);
            return res.status(failure.status).json(failure.body);
        }
    });

    app.get('/api/search-symbols', async (req, res) => {
        const query = typeof req.query.q === 'string' ? req.query.q.trim() : '';
        if (query.length < 1 || query.length > 60) return res.status(400).json({ error: 'Ingresá entre 1 y 60 caracteres para buscar.' });
        const client = req.ip || req.socket.remoteAddress || 'unknown';
        if (!consumeRateLimit(searchAttempts, client, { limit: 30, windowMs: 60_000 })) return res.status(429).json({ error: 'Se alcanzó el límite de búsquedas. Esperá un minuto.' });
        try {
            const yahoo = financeProvider || await getYahooFinance();
            const result = await yahoo.search(query, { quotesCount: 20, newsCount: 0 });
            const symbols = (result.quotes || []).filter((item) => item.symbol && item.quoteType !== 'NONE').slice(0, 20).map((item) => ({ ticker: item.symbol, nombre: item.shortname || item.longname || item.symbol, tipo: item.quoteType || 'OTHER', exchange: item.exchange || item.exchDisp || null, mercado: item.market || null }));
            res.setHeader('Cache-Control', 'no-store');
            return res.json({ symbols, fuente: 'Yahoo Finance' });
        } catch (error) {
            const failure = safeProviderFailure(error);
            return res.status(failure.status).json(failure.body);
        }
    });

    app.get('/api/auth/me', (req, res) => {
        const session = readSession(req);
        return res.json({ user: session?.user ? userStore.publicUser(session.user) : null });
    });
    app.post('/api/auth/register', (req, res) => {
        if (authRateLimited(req)) return res.status(429).json({ error: 'Demasiados intentos. Esperá un minuto.', code: 'RATE_LIMITED' });
        const { email, password } = req.body || {};
        if (typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) return res.status(400).json({ error: 'Ingresá un correo válido.' });
        if (typeof password !== 'string' || password.length < 10 || password.length > 128) return res.status(400).json({ error: 'La contraseña debe tener entre 10 y 128 caracteres.' });
        const result = userStore.create({ email, password, defaultPhone });
        if (result.error) return res.status(409).json({ error: result.error });
        setSession(res, userStore.get(result.user.id));
        return res.status(201).json({ user: result.user });
    });
    app.post('/api/auth/login', (req, res) => {
        if (authRateLimited(req)) return res.status(429).json({ error: 'Demasiados intentos. Esperá un minuto.', code: 'RATE_LIMITED' });
        const { email, password } = req.body || {};
        if (typeof email !== 'string' || typeof password !== 'string' || password.length > 128) return res.status(400).json({ error: 'Ingresá correo y contraseña.' });
        const user = userStore.authenticate(email, password);
        if (!user) return res.status(401).json({ error: 'Correo o contraseña incorrectos.' });
        setSession(res, userStore.get(user.id));
        return res.json({ user });
    });
    app.post('/api/auth/logout', (req, res) => {
        const session = readSession(req);
        if (session) sessions.delete(session.token);
        res.setHeader('Set-Cookie', `${sessionCookie}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${process.env.NODE_ENV === 'production' ? '; Secure' : ''}`);
        return res.json({ ok: true });
    });
    app.get('/api/portfolio', requireAuth, async (req, res) => {
        const positions = userStore.portfolio(req.user.id);
        const symbols = [...new Set(positions.map((p) => p.ticker))];
        const prices = new Map();
        if (symbols.length) try {
            const yahoo = financeProvider || await getYahooFinance();
            const quotes = await yahoo.quote(symbols);
            for (const quote of (Array.isArray(quotes) ? quotes : [quotes])) {
                const normalized = normalizeQuote(quote.symbol, quote);
                if (normalized) {
                    normalized.estadoActualizacion = 'actualizada';
                    normalized.consultadoEn = new Date().toISOString();
                    prices.set(normalized.ticker, normalized);
                    marketCache.set(`quote:${normalized.ticker}`, normalized, normalized.consultadoEn);
                }
            }
        } catch { /* cartera histórica sigue disponible si falla el proveedor */ }
        for (const ticker of symbols) if (!prices.has(ticker)) {
            const alternate = await getSecondaryQuote(ticker);
            const cached = alternate || staleQuote(marketCache, ticker);
            if (cached && Number.isFinite(cached.precio)) prices.set(ticker, cached);
        }
        const grouped = new Map();
        for (const p of positions) {
            const side = p.side || 'buy';
            const row = grouped.get(p.ticker) || { ticker: p.ticker, shares: 0, cost: 0, realizedPnl: 0, currency: p.currency || null };
            if (side === 'sell') { row.shares -= p.shares; row.cost -= p.costBasisAtSale || 0; row.realizedPnl += p.realizedPnl || 0; }
            else { row.shares += p.shares; row.cost += p.shares * p.executionPrice; }
            grouped.set(p.ticker, row);
        }
        const holdings = [...grouped.values()].filter((h) => h.shares > 1e-8).map((h) => {
            const quote = prices.get(h.ticker);
            const avgCost = h.shares ? h.cost / h.shares : 0;
            return { ...h, averageCost: avgCost, precio: quote?.precio ?? null, fechaPrecio: quote?.fecha ?? null, fuente: quote?.fuente ?? null,
                marketValue: quote ? h.shares * quote.precio : null, unrealizedPnl: quote ? h.shares * quote.precio - h.cost : null,
                estadoPrecio: quote?.estadoActualizacion === 'desactualizada' ? 'desactualizada' : quote ? 'actualizada' : 'sin_datos' };
        });
        const totals = {};
        for (const h of holdings) if (h.marketValue != null && h.currency) totals[h.currency] = (totals[h.currency] || 0) + h.marketValue;
        for (const h of holdings) h.exposurePct = h.marketValue != null && totals[h.currency] ? h.marketValue / totals[h.currency] * 100 : null;
        return res.json({ positions, holdings, totalsByCurrency: totals, nota: 'Operaciones simuladas; valores de mercado consultados al proveedor y fechados por activo. No incluye comisiones, impuestos ni dividendos.' });
    });
    app.post('/api/portfolio/buy', requireAuth, async (req, res) => {
        const ticker = typeof req.body?.ticker === 'string' ? req.body.ticker.trim().toUpperCase() : '';
        const shares = Number(req.body?.shares);
        if (!/^[A-Z0-9.^=-]{1,15}$/.test(ticker) || !Number.isFinite(shares) || shares <= 0 || shares > 1_000_000) return res.status(400).json({ error: 'Indicá un símbolo y una cantidad de acciones válida.' });
        try {
            const yahoo = financeProvider || await getYahooFinance();
            const chart = await yahoo.chart(ticker, { period1: periodStart('1mo'), interval: '1d' });
            const quote = (chart?.quotes || []).filter((row) => Number.isFinite(row.close)).at(-1);
            if (!quote) return res.status(404).json({ error: 'No encontramos un último cierre para ese activo.' });
            const position = { id: crypto.randomUUID(), side: 'buy', ticker, shares, executionPrice: quote.close, currency: chart.meta?.currency || null, priceDate: quote.date instanceof Date ? quote.date.toISOString() : new Date(quote.date).toISOString(), createdAt: new Date().toISOString(), simulated: true };
            userStore.addPosition(req.user.id, position);
            return res.status(201).json({ position });
        } catch (error) {
            const failure = safeProviderFailure(error);
            return res.status(failure.status).json(failure.body);
        }
    });
    app.post('/api/portfolio/sell', requireAuth, async (req, res) => {
        const ticker = typeof req.body?.ticker === 'string' ? req.body.ticker.trim().toUpperCase() : '';
        const shares = Number(req.body?.shares);
        if (!/^[A-Z0-9.^=-]{1,15}$/.test(ticker) || !Number.isFinite(shares) || shares <= 0) return res.status(400).json({ error: 'Indicá un símbolo y una cantidad válida.' });
        const ledger = userStore.portfolio(req.user.id).filter((p) => p.ticker === ticker);
        const quantity = ledger.reduce((sum, p) => sum + ((p.side || 'buy') === 'sell' ? -p.shares : p.shares), 0);
        if (shares > quantity + 1e-8) return res.status(400).json({ error: `Tenés ${Math.max(0, quantity)} acciones simuladas de ${ticker}.` });
        try {
            const yahoo = financeProvider || await getYahooFinance();
            const chart = await yahoo.chart(ticker, { period1: periodStart('1mo'), interval: '1d' });
            const quote = (chart?.quotes || []).filter((row) => Number.isFinite(row.close)).at(-1);
            if (!quote) return res.status(404).json({ error: 'No encontramos un último cierre para ese activo.' });
            const avgCost = ledger.reduce((sum, p) => sum + ((p.side || 'buy') === 'sell' ? -(p.costBasisAtSale || 0) : p.shares * p.executionPrice), 0) / quantity;
            const position = { id: crypto.randomUUID(), side: 'sell', ticker, shares, executionPrice: quote.close, costBasisAtSale: shares * avgCost, realizedPnl: shares * (quote.close - avgCost), currency: chart.meta?.currency || null, priceDate: quote.date instanceof Date ? quote.date.toISOString() : new Date(quote.date).toISOString(), createdAt: new Date().toISOString(), simulated: true };
            userStore.addPosition(req.user.id, position);
            return res.status(201).json({ position });
        } catch (error) { const failure = safeProviderFailure(error); return res.status(failure.status).json(failure.body); }
    });
    app.delete('/api/portfolio/:id', requireAuth, (req, res) => {
        const positions = userStore.portfolio(req.user.id);
        const next = positions.filter((position) => position.id !== req.params.id);
        if (next.length === positions.length) return res.status(404).json({ error: 'No encontramos esa posición.' });
        userStore.update(req.user.id, { portfolio: next });
        return res.json({ positions: next });
    });
    app.get('/api/favorites', requireAuth, (req, res) => res.json({ favorites: userStore.favorites(req.user.id) }));
    app.post('/api/favorites', requireAuth, (req, res) => {
        const ticker = typeof req.body?.ticker === 'string' ? req.body.ticker.trim().toUpperCase() : '';
        if (!/^[A-Z0-9.^=-]{1,15}$/.test(ticker)) return res.status(400).json({ error: 'Ingresá un símbolo válido.' });
        const favorite = { ticker, nombre: typeof req.body?.nombre === 'string' ? req.body.nombre.slice(0, 120) : ticker, addedAt: new Date().toISOString() };
        return res.status(201).json({ favorites: userStore.saveFavorite(req.user.id, favorite) });
    });
    app.delete('/api/favorites/:ticker', requireAuth, (req, res) => res.json({ favorites: userStore.removeFavorite(req.user.id, req.params.ticker.toUpperCase()) }));
    app.get('/api/watchlist', requireAuth, async (req, res) => {
        const favorites = userStore.favorites(req.user.id);
        if (!favorites.length) return res.json({ assets: [], estadoActualizacion: 'actualizada', fuente: 'Yahoo Finance' });
        let byTicker = new Map();
        let primaryAvailable = true;
        const cacheEntries = [];
        try {
            const yahoo = financeProvider || await getYahooFinance();
            const quotes = await yahoo.quote(favorites.map((entry) => entry.ticker));
            const consultedAt = new Date().toISOString();
            for (const quote of quotes) {
                const asset = normalizeQuote(quote.symbol, quote);
                if (!asset) continue;
                asset.estadoActualizacion = 'actualizada';
                asset.consultadoEn = consultedAt;
                byTicker.set(asset.ticker, asset);
                cacheEntries.push({ key: `quote:${asset.ticker}`, value: asset, savedAt: consultedAt });
            }
        } catch {
            primaryAvailable = false;
        }
        marketCache.setMany(cacheEntries);
        const missing = favorites.filter((entry) => !byTicker.has(entry.ticker));
        const alternates = await Promise.all(missing.map(async (entry) => [entry.ticker, await getSecondaryQuote(entry.ticker)]));
        for (const [ticker, quote] of alternates) if (quote) byTicker.set(ticker, quote);
        const assets = favorites.map((favorite) => {
            const asset = byTicker.get(favorite.ticker) || staleQuote(marketCache, favorite.ticker);
            return asset ? { ...asset, nombre: favorite.nombre || asset.nombre, addedAt: favorite.addedAt } : { ticker: favorite.ticker, nombre: favorite.nombre || favorite.ticker, addedAt: favorite.addedAt, estadoActualizacion: 'sin_datos', avisoActualizacion: 'No se pudo actualizar y no hay un dato guardado disponible.' };
        });
        const hasWarnings = !primaryAvailable || assets.some((asset) => asset.estadoActualizacion !== 'actualizada');
        res.setHeader('Cache-Control', 'no-store');
        return res.json({ assets, fuente: 'Yahoo Finance', estadoActualizacion: hasWarnings ? 'parcial' : 'actualizada', avisoActualizacion: hasWarnings ? 'Algunos activos no se pudieron actualizar con la fuente principal; cada fila identifica si viene de una alternativa, de la caché o no tiene dato.' : null });
    });
    app.get('/api/saved-analyses', requireAuth, (req, res) => res.json({ analyses: userStore.savedAnalyses(req.user.id) }));
    app.post('/api/saved-analyses', requireAuth, (req, res) => {
        const { ticker, nombre, precioActual, moneda, fechaPrecio, senal, sentimientoPromedio, variacionPct, periodoVariacion } = req.body || {};
        if (typeof ticker !== 'string' || !/^[A-Z0-9.^=-]{1,15}$/.test(ticker) || !Number.isFinite(precioActual)) return res.status(400).json({ error: 'No hay un análisis válido para guardar.' });
        const analysis = { id: crypto.randomUUID(), ticker, nombre: String(nombre || ticker).slice(0, 120), precioActual, moneda: String(moneda || '').slice(0, 8), fechaPrecio: String(fechaPrecio || '').slice(0, 40), senal: String(senal || 'SIN DATOS').slice(0, 20), sentimientoPromedio: Number.isFinite(sentimientoPromedio) ? sentimientoPromedio : null, variacionPct: Number.isFinite(variacionPct) ? variacionPct : null, periodoVariacion: String(periodoVariacion || '').slice(0, 100), savedAt: new Date().toISOString() };
        return res.status(201).json({ analyses: userStore.saveAnalysis(req.user.id, analysis) });
    });
    app.delete('/api/saved-analyses/:id', requireAuth, (req, res) => res.json({ analyses: userStore.removeSavedAnalysis(req.user.id, req.params.id) }));
    app.get('/api/goals', requireAuth, (req, res) => res.json({ goals: req.user.goals || [] }));
    app.post('/api/goals', requireAuth, (req, res) => {
        const title = typeof req.body?.title === 'string' ? req.body.title.trim().slice(0, 100) : '';
        const target = Number(req.body?.target);
        const currency = typeof req.body?.currency === 'string' ? req.body.currency.trim().toUpperCase() : '';
        const targetDate = typeof req.body?.targetDate === 'string' ? req.body.targetDate : '';
        if (!title || !Number.isFinite(target) || target <= 0 || !/^[A-Z]{3}$/.test(currency) || (targetDate && !/^\d{4}-\d{2}-\d{2}$/.test(targetDate))) return res.status(400).json({ error: 'Completá nombre, monto positivo, moneda y fecha válida.' });
        const goals = [{ id: crypto.randomUUID(), title, target, currency, targetDate: targetDate || null, createdAt: new Date().toISOString() }, ...(req.user.goals || [])].slice(0, 50);
        userStore.update(req.user.id, { goals }); return res.status(201).json({ goals });
    });
    app.delete('/api/goals/:id', requireAuth, (req, res) => {
        const goals = (req.user.goals || []).filter((g) => g.id !== req.params.id);
        userStore.update(req.user.id, { goals }); return res.json({ goals });
    });
    app.get('/api/journal', requireAuth, (req, res) => res.json({ entries: req.user.journal || [] }));
    app.post('/api/journal', requireAuth, (req, res) => {
        const ticker = typeof req.body?.ticker === 'string' ? req.body.ticker.trim().toUpperCase() : '';
        const note = typeof req.body?.note === 'string' ? req.body.note.trim().slice(0, 3000) : '';
        const category = ['idea', 'research', 'decision', 'review'].includes(req.body?.category) ? req.body.category : 'research';
        if (!/^[A-Z0-9.^=-]{1,15}$/.test(ticker) || note.length < 1) return res.status(400).json({ error: 'Ingresá un símbolo y una nota.' });
        const entry = { id: crypto.randomUUID(), ticker, note, category, createdAt: new Date().toISOString(), snapshot: req.body?.snapshot && typeof req.body.snapshot === 'object' ? { precio: Number.isFinite(req.body.snapshot.precio) ? req.body.snapshot.precio : null, moneda: String(req.body.snapshot.moneda || '').slice(0, 8), fecha: String(req.body.snapshot.fecha || '').slice(0, 40) } : null };
        const journal = [entry, ...(req.user.journal || [])].slice(0, 500);
        userStore.update(req.user.id, { journal }); return res.status(201).json({ entries: journal });
    });
    app.delete('/api/journal/:id', requireAuth, (req, res) => {
        const journal = (req.user.journal || []).filter((entry) => entry.id !== req.params.id);
        userStore.update(req.user.id, { journal }); return res.json({ entries: journal });
    });
    app.put('/api/settings/whatsapp', requireAuth, (req, res) => {
        const phone = normalizePhoneNumber(req.body?.phone || '');
        const message = typeof req.body?.message === 'string' ? req.body.message.trim() : '';
        if (phone && !isValidPhoneNumber(phone)) return res.status(400).json({ error: 'Ingresá código de país y número, por ejemplo +5491123456789 o 5491123456789.' });
        if (message.length < 10 || message.length > 700) return res.status(400).json({ error: 'El mensaje debe tener entre 10 y 700 caracteres.' });
        const user = userStore.update(req.user.id, { phone, whatsappMessage: message });
        return res.json({ user: userStore.publicUser(user), whatsappLinkAvailable });
    });
    app.put('/api/settings/preferences', requireAuth, (req, res) => {
        const input = req.body?.preferences;
        const valid = input && ['normal', 'large'].includes(input.textSize)
            && typeof input.highContrast === 'boolean' && typeof input.reduceMotion === 'boolean'
            && ['dark', 'light'].includes(input.theme);
        if (!valid) return res.status(400).json({ error: 'Las preferencias de accesibilidad no son válidas.' });
        const user = userStore.update(req.user.id, { preferences: { textSize: input.textSize, highContrast: input.highContrast, reduceMotion: input.reduceMotion, theme: input.theme } });
        return res.json({ preferences: user.preferences });
    });

    app.get('/api/fundamentals', async (req, res) => {
        const ticker = typeof req.query.ticker === 'string' ? req.query.ticker.trim().toUpperCase() : '';
        if (!/^[A-Z0-9.^=-]{1,15}$/.test(ticker)) return res.status(400).json({ error: 'Ingresá un símbolo válido.' });
        try {
            const yahoo = financeProvider || await getYahooFinance();
            if (!yahoo.quoteSummary) return res.json({ ticker, estado: 'no_disponible', metricas: {}, fuente: 'Yahoo Finance', consultadoEn: new Date().toISOString() });
            const data = await yahoo.quoteSummary(ticker, { modules: ['assetProfile', 'financialData', 'defaultKeyStatistics', 'summaryDetail', 'price'] });
            const keys = { marketCap: ['Valorización bursátil', data.price?.marketCap ?? data.summaryDetail?.marketCap], trailingPE: ['P/E últimos 12 meses', data.summaryDetail?.trailingPE], dividendYield: ['Rendimiento por dividendo', data.summaryDetail?.dividendYield], revenueGrowth: ['Crecimiento de ingresos', data.financialData?.revenueGrowth], profitMargins: ['Margen neto', data.financialData?.profitMargins], operatingMargins: ['Margen operativo', data.financialData?.operatingMargins], returnOnEquity: ['Retorno sobre patrimonio', data.financialData?.returnOnEquity], debtToEquity: ['Deuda / patrimonio', data.financialData?.debtToEquity], freeCashflow: ['Flujo de caja libre', data.financialData?.freeCashflow], totalCash: ['Efectivo', data.financialData?.totalCash], totalDebt: ['Deuda total', data.financialData?.totalDebt] };
            const metricas = Object.fromEntries(Object.entries(keys).map(([key, [label, input]]) => [key, { etiqueta: label, valor: financeNumber(input), unidad: ['revenueGrowth','profitMargins','operatingMargins','returnOnEquity','dividendYield'].includes(key) ? 'ratio' : key === 'debtToEquity' ? 'ratio_x100' : key === 'trailingPE' ? 'veces' : 'moneda' }]));
            return res.json({ ticker, estado: Object.values(metricas).some((m) => m.valor != null) ? 'disponible' : 'sin_datos', sector: data.assetProfile?.sector || null, industria: data.assetProfile?.industry || null, moneda: data.price?.currency || data.financialData?.financialCurrency || null, metricas, fuente: 'Yahoo Finance · quoteSummary', consultadoEn: new Date().toISOString(), nota: 'Métricas reportadas por el proveedor; pueden estar desactualizadas, variar por tipo de activo y no constituyen una recomendación.' });
        } catch (error) { return res.json({ ticker, estado: 'error', metricas: {}, fuente: 'Yahoo Finance', error: 'No se pudieron consultar los fundamentos ahora.', consultadoEn: new Date().toISOString() }); }
    });
    app.get('/api/compare', async (req, res) => {
        const tickers = typeof req.query.tickers === 'string' ? [...new Set(req.query.tickers.split(',').map((t) => t.trim().toUpperCase()).filter(Boolean))] : [];
        if (!tickers.length || tickers.length > 4 || tickers.some((t) => !/^[A-Z0-9.^=-]{1,15}$/.test(t))) return res.status(400).json({ error: 'Ingresá entre 1 y 4 símbolos válidos.' });
        const yahoo = financeProvider || await getYahooFinance();
        const rows = await Promise.all(tickers.map(async (ticker) => {
            try {
                const [quote, summary] = await Promise.all([yahoo.quote(ticker), yahoo.quoteSummary?.(ticker, { modules: ['summaryDetail','financialData','price'] })]);
                return { ticker, nombre: quote?.shortName || quote?.longName || ticker, precio: normalizeQuote(ticker, quote)?.precio ?? null, moneda: quote?.currency || null, variacionPct: normalizeQuote(ticker, quote)?.variacionPct ?? null, marketCap: financeNumber(summary?.price?.marketCap ?? summary?.summaryDetail?.marketCap), trailingPE: financeNumber(summary?.summaryDetail?.trailingPE), revenueGrowth: financeNumber(summary?.financialData?.revenueGrowth), profitMargins: financeNumber(summary?.financialData?.profitMargins), estado: quote ? 'disponible' : 'sin_datos', fuente: 'Yahoo Finance' };
            } catch { return { ticker, estado: 'error', fuente: 'Yahoo Finance' }; }
        }));
        return res.json({ rows, consultadoEn: new Date().toISOString(), nota: 'Valores monetarios conservan la moneda de cada activo; no se convierten ni deben ordenarse entre monedas distintas.' });
    });

    app.get('/api/quote', async (req, res) => {
        const ticker = typeof req.query.ticker === 'string' ? req.query.ticker.trim().toUpperCase() : '';
        if (!/^[A-Z0-9.^=-]{1,15}$/.test(ticker)) return res.status(400).json({ error: 'Ingresá un símbolo válido.' });
        const client = req.ip || req.socket.remoteAddress || 'unknown';
        if (!consumeRateLimit(quoteAttempts, client, { limit: 60, windowMs: 60_000 })) return res.status(429).json({ error: 'Se alcanzó el límite de actualizaciones. Esperá un minuto.' });
        try {
            const yahoo = financeProvider || await getYahooFinance();
            if (typeof yahoo.quote !== 'function') throw new Error('La fuente principal no ofrece cotización para este activo.');
            const quote = await yahoo.quote(ticker);
            const data = normalizeQuote(ticker, quote);
            if (!data) throw new Error('La fuente principal no devolvió una cotización para este activo.');
            data.estadoActualizacion = 'actualizada';
            data.consultadoEn = new Date().toISOString();
            marketCache.set(`quote:${ticker}`, data, data.consultadoEn);
            res.setHeader('Cache-Control', 'no-store');
            return res.json(data);
        } catch (error) {
            const alternate = await getSecondaryQuote(ticker);
            if (alternate) {
                res.setHeader('Cache-Control', 'no-store');
                return res.json(alternate);
            }
            const cached = staleQuote(marketCache, ticker);
            if (cached) {
                res.setHeader('Cache-Control', 'no-store');
                return res.json(cached);
            }
            const failure = safeProviderFailure(error);
            return res.status(failure.status).json(failure.body);
        }
    });
    app.post('/api/whatsapp-alert', requireAuth, async (req, res) => {
        const { ticker, senal, precio, moneda, fecha, sentimiento, test } = req.body || {};
        if (!req.user.phone || !isValidPhoneNumber(req.user.phone)) return res.status(400).json({ ok: false, detalle: 'Configurá un teléfono internacional válido en tu perfil.' });
        const client = req.user.id;
        const now = Date.now();
        if (!consumeRateLimit(alertAttempts, client, { limit: 3, windowMs: 60_000, now })) return res.status(429).json({ ok: false, detalle: 'Alcanzaste el límite temporal de alertas. Intentá más tarde.' });
        const values = { ticker, senal, precio, moneda, fecha, sentimiento };
        const message = test === true
            ? 'Assetly Finance: mensaje de prueba. Si ves este texto en WhatsApp, el número está configurado correctamente.'
            : req.user.whatsappMessage.replace(/\{(ticker|senal|precio|moneda|fecha|sentimiento)\}/g, (_, key) => String(values[key] ?? '—'));
        const url = crearEnlaceWhatsapp(message, req.user.phone);
        return res.json({ ok: true, url, detalle: 'Mensaje preparado. Abrí WhatsApp y confirmá el envío.' });
    });

    app.get('/api/analyze', async (req, res) => {
        const client = req.ip || req.socket.remoteAddress || 'unknown';
        if (!consumeRateLimit(analysisAttempts, client, { limit: 30, windowMs: 60_000 })) {
            res.setHeader('Retry-After', '60');
            return res.status(429).json({ error: 'Se alcanzó el límite de consultas. Intentá de nuevo en un minuto.', code: 'RATE_LIMITED' });
        }
        const validation = validateAnalysisQuery(req.query);
        if (!validation.ok) return res.status(400).json({ error: validation.message, code: 'INVALID_INPUT' });

        try {
            const { ticker, periodo, intervalo, umbralCompra, umbralVenta } = validation.value;
            const yahooFinance = financeProvider || await getYahooFinance();
            return res.json(await fetchMarketAnalysis(yahooFinance, { ticker, periodo, intervalo, umbralCompra, umbralVenta }, { getSecondaryRawQuote: getSecondaryQuoteForAnalysis, getCachedRawQuote }));
        } catch (error) {
            const failure = safeProviderFailure(error);
            if (failure.status === 502) console.error(`[${failure.body.requestId}] Error consultando Yahoo Finance:`, error);
            return res.status(failure.status).json(failure.body);
        }
    });

    app.use((error, req, res, next) => {
        if (error?.type === 'entity.too.large') {
            return res.status(413).json({ error: 'El cuerpo de la solicitud supera el límite permitido.', code: 'PAYLOAD_TOO_LARGE' });
        }
        if (error instanceof SyntaxError && error.status === 400 && 'body' in error) {
            return res.status(400).json({ error: 'El cuerpo JSON no es válido.', code: 'INVALID_JSON' });
        }
        console.error('Error inesperado del servidor:', error);
        return res.status(500).json({ error: 'Ocurrió un error inesperado.', code: 'INTERNAL_ERROR' });
    });

    return app;
}

if (require.main === module) {
    const app = createApp();
    const port = Number(process.env.PORT) || 3000;
    app.listen(port, () => console.log(`Assetly Finance disponible en http://localhost:${port}`));
}

module.exports = { createApp, periodStart, fetchMarketAnalysis, safeProviderFailure, consumeRateLimit, constantTimeTokenMatch, officialExchangePage };
