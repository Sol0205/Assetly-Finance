'use strict';

class TwelveDataProvider {
    constructor({ apiKey = process.env.TWELVE_DATA_API_KEY, fetchImpl = globalThis.fetch } = {}) {
        this.apiKey = apiKey;
        this.fetch = fetchImpl;
    }

    get configured() { return Boolean(this.apiKey && this.fetch); }

    async quote(ticker) {
        if (!this.configured) throw new Error('Twelve Data no está configurado.');
        const params = new URLSearchParams({ symbol: ticker, apikey: this.apiKey });
        const response = await this.fetch(`https://api.twelvedata.com/quote?${params}`, { signal: AbortSignal.timeout(7000) });
        if (!response.ok) throw new Error(`Twelve Data devolvió HTTP ${response.status}.`);
        const result = await response.json();
        if (result.status === 'error' || !result.symbol) throw new Error('Twelve Data no devolvió una cotización válida.');
        const numeric = (value) => value !== undefined && value !== null && value !== '' && Number.isFinite(Number(value)) ? Number(value) : null;
        // Twelve Data's `datetime` is exchange local and `timestamp` may refer
        // to the candle open. Use last_quote_at (last minute candle) for the
        // quote instant; if it's missing, reject instead of guessing.
        const timestamp = Number(result.last_quote_at);
        const date = Number.isFinite(timestamp) && timestamp > 0
            ? new Date(timestamp * 1000)
            : null;
        if (!date || !Number.isFinite(date.getTime())) throw new Error('Twelve Data no informó una hora válida para la cotización.');
        const isOpen = result.is_market_open === true || result.is_market_open === 'true';
        return {
            symbol: String(result.symbol).toUpperCase(),
            shortName: result.name || result.symbol,
            fullExchangeName: result.exchange || null,
            currency: result.currency || null,
            regularMarketPrice: numeric(result.close),
            regularMarketTime: date,
            regularMarketPreviousClose: numeric(result.previous_close),
            regularMarketChangePercent: numeric(result.percent_change),
            marketState: isOpen ? 'REGULAR' : 'CLOSED',
            quoteSourceName: 'Twelve Data',
            exchangeDataDelayedBy: null,
            quoteType: result.type || null
        };
    }
}

function normalizeMarketName(value) {
    const market = String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    if (market.includes('nasdaq')) return 'nasdaq';
    if (market.includes('newyorkstockexchange') || market === 'nyse') return 'nyse';
    if (market.includes('nysearca') || market === 'arca' || market === 'pcx') return 'arca';
    if (market.includes('buenosaires') || market === 'byma' || market === 'bue') return 'byma';
    return market;
}

function isComparableSecondaryQuote(ticker, quote, previousQuote = null, now = Date.now()) {
    if (!quote || String(quote.symbol || '').toUpperCase() !== ticker.toUpperCase()) return false;
    if (!Number.isFinite(quote.regularMarketPrice) || !quote.currency || !quote.fullExchangeName || !(quote.regularMarketTime instanceof Date)) return false;
    if (!['REGULAR', 'CLOSED'].includes(quote.marketState)) return false;
    const quoteAge = now - quote.regularMarketTime.getTime();
    if (quoteAge < -60_000 || quoteAge > 7 * 24 * 60 * 60_000) return false;
    if (quote.marketState === 'REGULAR' && quoteAge > 30 * 60_000) return false;
    if (previousQuote) {
        if (previousQuote.currency && quote.currency !== previousQuote.currency) return false;
        if (previousQuote.exchange && normalizeMarketName(quote.fullExchangeName) !== normalizeMarketName(previousQuote.exchange)) return false;
        const previousAge = now - Date.parse(previousQuote.savedAt || previousQuote.consultadoEn || '');
        if (previousAge >= 0 && previousAge < 30 * 60_000) {
            if (previousQuote.estadoMercado && quote.marketState !== previousQuote.estadoMercado) return false;
            if (previousQuote.tipo && quote.marketState === 'REGULAR' && previousQuote.tipo !== 'regularMarket') return false;
            const previousTime = Date.parse(previousQuote.fecha || '');
            if (Number.isFinite(previousTime) && Math.abs(previousTime - quote.regularMarketTime.getTime()) > 30 * 60_000) return false;
        }
    }
    return true;
}

module.exports = { TwelveDataProvider, isComparableSecondaryQuote, normalizeMarketName };
