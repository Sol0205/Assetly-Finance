'use strict';

const $ = (id) => document.getElementById(id);
const rootStyle = getComputedStyle(document.documentElement);
const colors = {
    buy: rootStyle.getPropertyValue('--positive').trim(),
    sell: rootStyle.getPropertyValue('--negative').trim(),
    hold: rootStyle.getPropertyValue('--warning').trim(),
    muted: rootStyle.getPropertyValue('--muted').trim(),
    grid: rootStyle.getPropertyValue('--line').trim()
};

let priceChart = null;
let lastQuery = null;
let lastAnalysis = null;
let currentUser = null;
let registerMode = false;
let favoriteTickers = new Set();
let watchlistEntries = [];
let searchDebounce = null;
let searchResults = [];

$('analysisForm').addEventListener('submit', (event) => {
    event.preventDefault();
    runAnalysis();
});
$('clearSearchButton').addEventListener('click', () => {
    clearTimeout(searchDebounce);
    $('ticker').value = '';
    $('ticker').setCustomValidity('');
    $('symbolSearchPanel').classList.add('hidden');
    $('symbolSearchResults').replaceChildren();
    $('symbolSearchStatus').textContent = '';
    searchResults = [];
    lastAnalysis = null;
    lastQuery = null;
    if (priceChart) { priceChart.destroy(); priceChart = null; }
    $('refreshInfo').textContent = 'Esperando análisis';
    setState('empty');
    $('ticker').focus();
    loadMarketHighlights();
});
$('ticker').addEventListener('input', () => {
    clearTimeout(searchDebounce);
    const query = $('ticker').value.trim();
    if (!query) { $('symbolSearchPanel').classList.add('hidden'); return; }
    searchDebounce = window.setTimeout(() => searchSymbols(query), 300);
});
$('symbolTypeFilter').addEventListener('change', () => renderSymbolSearchResults(searchResults));
$('watchlistFilter').addEventListener('input', () => renderSavedList('favoritesList', watchlistEntries, 'favorite'));
$('watchlistSort').addEventListener('change', () => renderSavedList('favoritesList', watchlistEntries, 'favorite'));
$('downloadAnalysisButton').addEventListener('click', () => { if (lastAnalysis) downloadAnalysisCsv(lastAnalysis); });
$('exportPersonalDataButton').addEventListener('click', exportPersonalData);

$('scenarioRun').addEventListener('click', renderScenario);
$('compareForm').addEventListener('submit', async (event) => { event.preventDefault(); const box = $('compareResults'); box.replaceChildren(); $('compareNote').textContent = 'Consultando símbolos…'; try { const data = await api(`/api/compare?tickers=${encodeURIComponent($('compareTickers').value)}`); $('compareNote').textContent = data.nota; for (const item of data.rows) { const row = document.createElement('div'); row.className = 'portfolio-row'; const text = document.createElement('span'); text.textContent = item.estado === 'disponible' ? `${item.ticker} · ${item.nombre} · ${formatMoney(item.precio, item.moneda)} · variación ${item.variacionPct == null ? '—' : `${item.variacionPct.toFixed(2)}%`} · capitalización ${item.marketCap == null ? '—' : formatMoney(item.marketCap, item.moneda)} · P/E ${item.trailingPE ?? '—'} · crecimiento ingresos ${item.revenueGrowth == null ? '—' : `${(item.revenueGrowth * 100).toFixed(1)}%`}` : `${item.ticker} · datos ${item.estado}`; row.append(text); box.append(row); } } catch (error) { $('compareNote').textContent = error.message; } });
$('goalForm').addEventListener('submit', async (event) => { event.preventDefault(); try { await api('/api/goals', { method: 'POST', body: JSON.stringify({ title: $('goalTitle').value, target: Number($('goalTarget').value), currency: $('goalCurrency').value, targetDate: $('goalDate').value }) }); event.target.reset(); await loadPortfolio(); } catch (error) { $('settingsStatus').textContent = error.message; } });
$('journalForm').addEventListener('submit', async (event) => { event.preventDefault(); try { const snapshot = lastAnalysis && lastAnalysis.ticker === $('journalTicker').value.trim().toUpperCase() ? { precio: lastAnalysis.precioActual, moneda: lastAnalysis.moneda, fecha: lastAnalysis.fechaPrecio } : null; await api('/api/journal', { method: 'POST', body: JSON.stringify({ ticker: $('journalTicker').value, category: $('journalCategory').value, note: $('journalNote').value, snapshot }) }); $('journalNote').value = ''; await loadJournal(); } catch (error) { $('settingsStatus').textContent = error.message; } });

$('retryButton').addEventListener('click', () => runAnalysis(lastQuery || undefined));
$('umbralCompra').addEventListener('input', (event) => {
    $('umbralCompraVal').value = Number(event.target.value).toFixed(2);
    $('umbralCompraVal').textContent = Number(event.target.value).toFixed(2);
});
$('umbralVenta').addEventListener('input', (event) => {
    $('umbralVentaVal').value = Number(event.target.value).toFixed(2);
    $('umbralVentaVal').textContent = Number(event.target.value).toFixed(2);
});

async function api(path, options = {}) {
    const response = await fetch(path, { ...options, headers: { Accept: 'application/json', ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...(options.headers || {}) } });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || data.detalle || 'No se pudo completar la operación.');
    return data;
}

async function searchSymbols(query) {
    $('symbolSearchPanel').classList.remove('hidden');
    $('symbolSearchStatus').textContent = 'Buscando símbolos…';
    try {
        const result = await api(`/api/search-symbols?q=${encodeURIComponent(query)}`);
        if ($('ticker').value.trim() !== query) return;
        searchResults = result.symbols || [];
        $('symbolSearchStatus').textContent = `${searchResults.length} resultados · Fuente: ${result.fuente}`;
        renderSymbolSearchResults(searchResults);
    } catch (error) {
        if ($('ticker').value.trim() !== query) return;
        searchResults = [];
        $('symbolSearchStatus').textContent = `Búsqueda no disponible: ${error.message}`;
        renderSymbolSearchResults([]);
    }
}

function renderSymbolSearchResults(results) {
    const list = $('symbolSearchResults');
    list.replaceChildren();
    const filter = $('symbolTypeFilter').value;
    const filtered = results.filter((item) => filter === 'all' || item.tipo === filter);
    if (!filtered.length) {
        const empty = document.createElement('p'); empty.className = 'portfolio-empty';
        empty.textContent = results.length ? 'No hay resultados para ese tipo de activo.' : 'No encontramos símbolos. Podés ingresar uno manualmente.';
        list.append(empty);
        return;
    }
    for (const item of filtered) {
        const button = document.createElement('button'); button.type = 'button'; button.className = 'symbol-search-result';
        const identity = document.createElement('span');
        const ticker = document.createElement('strong'); ticker.textContent = item.ticker;
        const name = document.createElement('small'); name.textContent = item.nombre;
        identity.append(ticker, name);
        const meta = document.createElement('span'); meta.textContent = `${item.tipo}${item.exchange ? ` · ${item.exchange}` : ''}`;
        button.append(identity, meta);
        button.addEventListener('click', () => { $('ticker').value = item.ticker; $('symbolSearchPanel').classList.add('hidden'); $('ejecutar').focus(); });
        list.append(button);
    }
}

const defaultPreferences = { textSize: 'normal', highContrast: false, reduceMotion: false, theme: 'dark' };
function loadLocalPreferences() {
    try { return { ...defaultPreferences, ...JSON.parse(localStorage.getItem('ai-finance-preferences') || '{}') }; }
    catch { return { ...defaultPreferences }; }
}
function applyPreferences(preferences) {
    const safe = { ...defaultPreferences, ...(preferences || {}) };
    document.documentElement.dataset.textSize = safe.textSize === 'large' ? 'large' : 'normal';
    document.documentElement.dataset.contrast = safe.highContrast ? 'high' : 'normal';
    document.documentElement.dataset.reduceMotion = String(Boolean(safe.reduceMotion));
    document.documentElement.dataset.theme = safe.theme === 'light' ? 'light' : 'dark';
    $('preferenceTextSize').value = document.documentElement.dataset.textSize;
    $('preferenceHighContrast').checked = Boolean(safe.highContrast);
    $('preferenceReduceMotion').checked = Boolean(safe.reduceMotion);
    $('preferenceTheme').value = document.documentElement.dataset.theme;
}

$('preferencesForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const preferences = { textSize: $('preferenceTextSize').value, highContrast: $('preferenceHighContrast').checked, reduceMotion: $('preferenceReduceMotion').checked, theme: $('preferenceTheme').value };
    localStorage.setItem('ai-finance-preferences', JSON.stringify(preferences));
    applyPreferences(preferences);
    $('preferencesStatus').textContent = 'Preferencias guardadas en este navegador.';
    if (currentUser) {
        try { await api('/api/settings/preferences', { method: 'PUT', body: JSON.stringify({ preferences }) }); $('preferencesStatus').textContent = 'Preferencias guardadas y sincronizadas con tu cuenta.'; }
        catch (error) { $('preferencesStatus').textContent = `Guardadas localmente; no se pudieron sincronizar: ${error.message}`; }
    }
});

async function loadMarketHighlights() {
    try {
        const result = await api('/api/market-highlights', { cache: 'no-store' });
        renderMarketHighlights(result.assets || []);
        $('highlightsUpdated').textContent = result.estadoActualizacion === 'actualizada' ? `Actualizado ${formatDate(result.actualizadoEn, true)}` : 'Hay datos alternativos o guardados';
        $('highlightsUpdated').title = result.avisoActualizacion || '';
    } catch {
        $('highlightsUpdated').textContent = 'Cotizaciones no disponibles';
        $('highlightCards').innerHTML = '<p class="portfolio-empty">No pudimos cargar las cotizaciones destacadas. Podés buscar un símbolo igualmente.</p>';
    }
}

function renderMarketHighlights(assets) {
    const cards = $('highlightCards');
    cards.replaceChildren();
    for (const asset of assets) {
        const card = document.createElement('button');
        card.type = 'button';
        card.className = 'highlight-card';
        card.setAttribute('aria-label', `Analizar ${asset.nombre || asset.ticker}, símbolo ${asset.ticker}`);
        const top = document.createElement('div'); top.className = 'highlight-card-top';
        const ticker = document.createElement('span'); ticker.className = 'highlight-symbol'; ticker.textContent = asset.ticker;
        const icon = document.createElement('span'); icon.className = 'highlight-symbol'; icon.textContent = '↗'; top.append(ticker, icon);
        const name = document.createElement('div'); name.className = 'highlight-name'; name.textContent = asset.nombre || asset.ticker;
        const price = document.createElement('div'); price.className = 'highlight-price'; price.textContent = formatMoney(asset.precio, asset.moneda);
        const bottom = document.createElement('div'); bottom.className = 'highlight-card-bottom';
        const market = document.createElement('span');
        market.textContent = asset.estadoActualizacion === 'desactualizada' ? 'Guardado · no actualizado'
            : asset.estadoActualizacion === 'proveedor_alternativo' ? 'Proveedor alternativo'
                : asset.estadoActualizacion === 'sin_datos' ? 'Sin dato' : asset.tipo === 'lastClose' || asset.estadoMercado === 'CLOSED' ? 'Último dato' : 'Mercado abierto';
        const change = document.createElement('span');
        if (Number.isFinite(asset.variacionPct)) {
            change.textContent = `${asset.variacionPct > 0 ? '+' : ''}${asset.variacionPct.toFixed(2)}%`;
            change.className = `highlight-change ${asset.variacionPct >= 0 ? 'positive-text' : 'negative-text'}`;
        } else change.textContent = '—';
        bottom.append(market, change);
        const time = document.createElement('div'); time.className = 'highlight-time';
        time.textContent = `${formatDate(asset.fecha, true)}${asset.fuente ? ` · ${asset.fuente}` : ''}${Number(asset.retrasoMinutos) > 0 ? ` · demora ${asset.retrasoMinutos} min` : ''}`;
        card.append(top, name, price, bottom, time);
        card.addEventListener('click', () => { $('ticker').value = asset.ticker; runAnalysis(); });
        cards.append(card);
    }
}

function setAuthDialog(mode) {
    registerMode = mode === 'register';
    $('authTitle').textContent = registerMode ? 'Crear cuenta' : 'Iniciar sesión';
    $('authHelp').textContent = registerMode ? 'Creá una cuenta para guardar tu cartera virtual y tus alertas.' : 'Ingresá para acceder a la cartera y a las alertas.';
    $('authSubmit').textContent = registerMode ? 'Crear cuenta' : 'Iniciar sesión';
    $('authToggle').textContent = registerMode ? 'Ya tengo una cuenta' : 'Crear una cuenta';
    $('authPassword').autocomplete = registerMode ? 'new-password' : 'current-password';
    $('authStatus').textContent = '';
}

async function refreshAccount() {
    const { user } = await api('/api/auth/me');
    currentUser = user;
    $('accountButton').textContent = user ? user.email : 'Iniciar sesión';
    $('personalPanel').classList.toggle('hidden', !user);
    $('settingsLoginPrompt').classList.toggle('hidden', Boolean(user));
    $('savedLoginPrompt').classList.toggle('hidden', Boolean(user));
    $('savedContent').classList.toggle('hidden', !user);
    applyPreferences(user?.preferences || loadLocalPreferences());
    $('buyButton').classList.toggle('hidden', !lastAnalysis);
    $('favoriteButton').classList.toggle('hidden', !lastAnalysis);
    $('saveAnalysisButton').classList.toggle('hidden', !lastAnalysis);
    if (user) {
        $('whatsappPhone').value = user.phone || '';
        $('whatsappMessage').value = user.whatsappMessage || '';
        $('whatsappStatus').textContent = 'Se abrirá WhatsApp con el mensaje preparado; vas a confirmar el envío desde la app.';
        await loadPortfolio();
        await refreshSavedLists();
    }
}

function showAuth(mode = 'login') {
    setAuthDialog(mode);
    $('authDialog').showModal();
}

function setView(view) {
    $('overviewView').classList.toggle('hidden', view !== 'overview');
    $('savedView').classList.toggle('hidden', view !== 'saved');
    $('settingsView').classList.toggle('hidden', view !== 'settings');
    $('breadcrumbPage').textContent = view === 'saved' ? 'Favoritos y guardados' : view === 'settings' ? 'Ajustes de usuario' : 'Market overview';
    const hash = window.location.hash || '#overview';
    document.querySelectorAll('.nav-item').forEach((link) => link.classList.toggle('active', link.hash === hash));
    if (view === 'saved' && currentUser) refreshSavedLists();
}

function handleLocation() {
    const hash = window.location.hash;
    const view = hash === '#saved' ? 'saved' : hash === '#settings' ? 'settings' : 'overview';
    setView(view);
    if (view === 'overview' && (hash === '#price-section' || hash === '#news-section')) requestAnimationFrame(() => document.querySelector(hash)?.scrollIntoView({ behavior: 'smooth' }));
}

async function refreshSavedLists() {
    if (!currentUser) return;
    try {
        const [watchlist, analyses] = await Promise.all([api('/api/watchlist'), api('/api/saved-analyses')]);
        watchlistEntries = watchlist.assets || [];
        favoriteTickers = new Set(watchlistEntries.map((entry) => entry.ticker));
        $('watchlistStatus').textContent = watchlist.avisoActualizacion || '';
        renderSavedList('favoritesList', watchlistEntries, 'favorite');
        renderSavedList('savedAnalysesList', analyses.analyses, 'analysis');
        updateFavoriteButton();
    } catch (error) { $('savedContent').dataset.error = error.message; }
}

function renderSavedList(elementId, entries, type) {
    const list = $(elementId);
    list.replaceChildren();
    let visibleEntries = entries;
    if (type === 'favorite') {
        const query = $('watchlistFilter')?.value.trim().toLowerCase() || '';
        visibleEntries = entries.filter((entry) => `${entry.nombre} ${entry.ticker}`.toLowerCase().includes(query));
        const sort = $('watchlistSort')?.value || 'symbol';
        visibleEntries = [...visibleEntries].sort((a, b) => sort === 'change-desc'
            ? (b.variacionPct ?? -Infinity) - (a.variacionPct ?? -Infinity)
            : sort === 'change-asc' ? (a.variacionPct ?? Infinity) - (b.variacionPct ?? Infinity)
                : a.ticker.localeCompare(b.ticker));
        $('watchlistCount').textContent = `${entries.length} ${entries.length === 1 ? 'activo' : 'activos'}`;
    }
    if (!visibleEntries.length) {
        const empty = document.createElement('p');
        empty.className = 'portfolio-empty';
        empty.textContent = type === 'favorite' ? entries.length ? 'No hay activos que coincidan con el filtro.' : 'Todavía no agregaste favoritos. Analizá un activo y guardalo con ☆.' : 'Todavía no guardaste análisis.';
        list.append(empty);
        return;
    }
    for (const entry of visibleEntries) {
        const row = document.createElement('div'); row.className = 'saved-row';
        const details = document.createElement('div'); details.className = 'saved-details';
        const title = document.createElement('strong'); title.textContent = `${entry.nombre || entry.ticker} · ${entry.ticker}`; details.append(title);
        const meta = document.createElement('small');
        meta.textContent = type === 'analysis' ? `${formatMoney(entry.precioActual, entry.moneda)} · ${entry.senal} · Guardado ${formatDate(entry.savedAt)}`
            : Number.isFinite(entry.precio) ? `${formatMoney(entry.precio, entry.moneda)} · ${Number.isFinite(entry.variacionPct) ? `${entry.variacionPct > 0 ? '+' : ''}${entry.variacionPct.toFixed(2)}% vs. cierre previo` : 'variación no disponible'}` : entry.avisoActualizacion || 'Cotización no disponible';
        details.append(meta);
        if (type === 'favorite') {
            const status = document.createElement('small');
            status.className = entry.estadoActualizacion === 'desactualizada' || entry.estadoActualizacion === 'sin_datos' ? 'watchlist-stale' : 'watchlist-fresh';
            const quoteTime = entry.fecha ? formatDate(entry.fecha, true) : 'sin hora informada';
            status.textContent = `${entry.estadoActualizacion === 'desactualizada' ? 'Dato guardado · sin actualizar' : entry.estadoActualizacion === 'sin_datos' ? 'Sin cotización' : entry.estadoActualizacion === 'proveedor_alternativo' ? 'Proveedor alternativo validado' : 'Dato del proveedor'} · ${quoteTime}${entry.fuente ? ` · ${entry.fuente}` : ''}${Number(entry.retrasoMinutos) > 0 ? ` · demora ${entry.retrasoMinutos} min` : ''}`;
            details.append(status);
        }
        const actions = document.createElement('div'); actions.className = 'saved-actions';
        const open = document.createElement('button'); open.type = 'button'; open.className = 'text-button'; open.textContent = type === 'favorite' ? 'Analizar' : 'Volver a analizar';
        open.addEventListener('click', () => { $('ticker').value = entry.ticker; window.location.hash = 'overview'; runAnalysis(); });
        const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'text-button'; remove.textContent = 'Quitar';
        remove.addEventListener('click', async () => {
            await api(type === 'favorite' ? `/api/favorites/${encodeURIComponent(entry.ticker)}` : `/api/saved-analyses/${encodeURIComponent(entry.id)}`, { method: 'DELETE' });
            await refreshSavedLists();
        });
        actions.append(open, remove); row.append(details, actions); list.append(row);
    }
}

function updateFavoriteButton() {
    if (!lastAnalysis) return;
    const saved = favoriteTickers.has(lastAnalysis.ticker);
    $('favoriteButton').textContent = saved ? '★ En favoritos' : '☆ Guardar favorito';
}

async function loadPortfolio() {
    const { positions, holdings, totalsByCurrency } = await api('/api/portfolio');
    const list = $('portfolioList'); list.replaceChildren();
    if (!holdings.length) { const empty = document.createElement('p'); empty.className = 'portfolio-empty'; empty.textContent = 'Sin tenencias abiertas. Analizá un activo y registrá una compra simulada para empezar.'; list.append(empty); }
    for (const holding of holdings) {
        const row = document.createElement('div'); row.className = 'portfolio-row';
        const quoteState = holding.estadoPrecio === 'desactualizada' ? 'último dato guardado · no actualizado' : 'precio consultado';
        const label = document.createElement('span'); label.textContent = `${holding.ticker} · ${holding.shares.toFixed(4)} acc. · costo prom. ${formatMoney(holding.averageCost, holding.currency)} · valor ${formatMoney(holding.marketValue, holding.currency)} · ${holding.estadoPrecio !== 'sin_datos' ? `${quoteState} ${formatDate(holding.fechaPrecio)}${holding.fuente ? ` · ${holding.fuente}` : ''} · P/L no realizado ${formatMoney(holding.unrealizedPnl, holding.currency)}` : 'precio no disponible'} · realizado ${formatMoney(holding.realizedPnl, holding.currency)} · concentración ${holding.exposurePct == null ? '—' : `${holding.exposurePct.toFixed(1)}%`}`;
        const sell = document.createElement('button'); sell.className = 'text-button'; sell.type = 'button'; sell.textContent = 'Vender'; sell.addEventListener('click', async () => { const amount = Number(window.prompt(`Cantidad a vender de ${holding.ticker} (máximo ${holding.shares})`)); if (!Number.isFinite(amount) || amount <= 0) return; try { await api('/api/portfolio/sell', { method: 'POST', body: JSON.stringify({ ticker: holding.ticker, shares: amount }) }); await loadPortfolio(); } catch (error) { $('settingsStatus').textContent = error.message; } });
        row.append(label, sell); list.append(row);
    }
    for (const [currency, value] of Object.entries(totalsByCurrency || {})) { const total = document.createElement('p'); total.className = 'panel-hint'; total.textContent = `Exposición total ${currency}: ${formatMoney(value, currency)} (solo tenencias con cotización disponible).`; list.prepend(total); }
    const history = document.createElement('details'); history.className = 'settings-details'; const summary = document.createElement('summary'); summary.textContent = 'Historial de operaciones'; history.append(summary);
    for (const p of [...positions].reverse()) { const line = document.createElement('p'); line.className = 'panel-hint'; line.textContent = `${(p.side || 'buy') === 'sell' ? 'Venta simulada' : 'Compra simulada'} · ${p.ticker} · ${p.shares} acc. a ${formatMoney(p.executionPrice, p.currency)}${p.side === 'sell' ? ` · P/L realizado ${formatMoney(p.realizedPnl, p.currency)}` : ''} · ${formatDate(p.createdAt)} · cierre de ${formatDate(p.priceDate)}`; history.append(line); } list.append(history);
    await loadGoals(holdings); await loadJournal();
}
async function loadGoals(holdings = []) {
    const list = $('goalsList'); list.replaceChildren(); const { goals } = await api('/api/goals');
    if (!goals.length) { const empty = document.createElement('p'); empty.className = 'portfolio-empty'; empty.textContent = 'Todavía no hay objetivos.'; list.append(empty); }
    for (const goal of goals) { const invested = holdings.filter((h) => h.currency === goal.currency && h.marketValue != null).reduce((s, h) => s + h.marketValue, 0); const row = document.createElement('div'); row.className = 'portfolio-row'; const text = document.createElement('span'); text.textContent = `${goal.title} · valor de tenencias ${formatMoney(invested, goal.currency)} de ${formatMoney(goal.target, goal.currency)} · ${Math.min(100, invested / goal.target * 100).toFixed(1)}%${goal.targetDate ? ` · fecha ${goal.targetDate}` : ''} · sin conversión de moneda`; const del = document.createElement('button'); del.className = 'text-button'; del.textContent = 'Quitar'; del.addEventListener('click', async () => { await api(`/api/goals/${encodeURIComponent(goal.id)}`, { method: 'DELETE' }); await loadPortfolio(); }); row.append(text, del); list.append(row); }
}
async function loadJournal() { const list = $('journalList'); list.replaceChildren(); const { entries } = await api('/api/journal'); if (!entries.length) { const empty = document.createElement('p'); empty.className = 'portfolio-empty'; empty.textContent = 'Tu diario está vacío.'; list.append(empty); } for (const entry of entries) { const row = document.createElement('div'); row.className = 'portfolio-row'; const text = document.createElement('span'); text.textContent = `${entry.ticker} · ${entry.category} · ${formatDate(entry.createdAt, true)}${entry.snapshot?.precio != null ? ` · precio observado ${formatMoney(entry.snapshot.precio, entry.snapshot.moneda)} (${formatDate(entry.snapshot.fecha)})` : ''} · ${entry.note}`; const del = document.createElement('button'); del.className = 'text-button'; del.textContent = 'Quitar'; del.addEventListener('click', async () => { await api(`/api/journal/${encodeURIComponent(entry.id)}`, { method: 'DELETE' }); await loadJournal(); }); row.append(text, del); list.append(row); } }

$('accountButton').addEventListener('click', () => {
    if (currentUser) { window.location.hash = 'settings'; return; }
    showAuth('login');
});
$('savedLoginButton').addEventListener('click', () => showAuth('login'));
$('settingsLoginButton').addEventListener('click', () => showAuth('login'));
$('closeAuth').addEventListener('click', () => $('authDialog').close());
$('authToggle').addEventListener('click', () => setAuthDialog(registerMode ? 'login' : 'register'));
$('authForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    $('authStatus').textContent = 'Procesando…';
    try {
        await api(`/api/auth/${registerMode ? 'register' : 'login'}`, { method: 'POST', body: JSON.stringify({ email: $('authEmail').value, password: $('authPassword').value }) });
        $('authDialog').close();
        $('authPassword').value = '';
        await refreshAccount();
    } catch (error) { $('authStatus').textContent = error.message; }
});
$('logoutButton').addEventListener('click', async () => {
    await api('/api/auth/logout', { method: 'POST' });
    currentUser = null;
    await refreshAccount();
});
$('whatsappSettingsForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    $('settingsStatus').textContent = 'Guardando…';
    try {
        const result = await api('/api/settings/whatsapp', { method: 'PUT', body: JSON.stringify({ phone: $('whatsappPhone').value, message: $('whatsappMessage').value }) });
        currentUser = result.user;
        $('whatsappPhone').value = result.user.phone || '';
        $('whatsappLink').classList.add('hidden');
        $('settingsStatus').textContent = 'Preferencias guardadas.';
    } catch (error) { $('settingsStatus').textContent = error.message; }
});
$('buyButton').addEventListener('click', async () => {
    if (!currentUser) { showAuth('login'); return; }
    $('buyTickerLabel').textContent = lastAnalysis.ticker;
    $('buyStatus').textContent = '';
    $('buyDialog').showModal();
});
$('favoriteButton').addEventListener('click', async () => {
    if (!currentUser) { showAuth('login'); return; }
    try {
        if (favoriteTickers.has(lastAnalysis.ticker)) await api(`/api/favorites/${encodeURIComponent(lastAnalysis.ticker)}`, { method: 'DELETE' });
        else await api('/api/favorites', { method: 'POST', body: JSON.stringify({ ticker: lastAnalysis.ticker, nombre: lastAnalysis.nombre }) });
        await refreshSavedLists();
    } catch (error) { $('settingsStatus').textContent = error.message; }
});
$('saveAnalysisButton').addEventListener('click', async () => {
    if (!currentUser) { showAuth('login'); return; }
    const data = lastAnalysis;
    try {
        await api('/api/saved-analyses', { method: 'POST', body: JSON.stringify({ ticker: data.ticker, nombre: data.nombre, precioActual: data.precioActual, moneda: data.moneda, fechaPrecio: data.fechaPrecio, senal: data.orientacionEducativa?.resultado || 'DATOS INSUFICIENTES', sentimientoPromedio: data.sentimientoPromedio, variacionPct: data.variacionPct, periodoVariacion: data.periodoVariacion }) });
        $('saveAnalysisButton').textContent = 'Análisis guardado ✓';
        window.setTimeout(() => { $('saveAnalysisButton').textContent = 'Guardar análisis'; }, 2400);
        await refreshSavedLists();
    } catch (error) { $('settingsStatus').textContent = error.message; }
});
$('closeBuy').addEventListener('click', () => $('buyDialog').close());
$('buyForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    try {
        await api('/api/portfolio/buy', { method: 'POST', body: JSON.stringify({ ticker: lastAnalysis.ticker, shares: Number($('buyShares').value) }) });
        $('buyDialog').close();
        await refreshAccount();
        $('settingsStatus').textContent = 'Compra simulada guardada al último cierre disponible.';
    } catch (error) { $('buyStatus').textContent = error.message; }
});
$('sendAlertButton').addEventListener('click', async () => {
    if (!lastAnalysis) { $('settingsStatus').textContent = 'Analizá un activo antes de preparar la alerta.'; return; }
    try {
        const settings = await api('/api/settings/whatsapp', { method: 'PUT', body: JSON.stringify({ phone: $('whatsappPhone').value, message: $('whatsappMessage').value }) });
        currentUser = settings.user;
        $('whatsappPhone').value = settings.user.phone || '';
        const data = lastAnalysis;
        const result = await api('/api/whatsapp-alert', { method: 'POST', body: JSON.stringify({ ticker: data.ticker, senal: data.orientacionEducativa?.resultado || 'DATOS INSUFICIENTES', precio: data.precioActual, moneda: data.moneda || '', fecha: data.fechaPrecio || '', sentimiento: Number.isFinite(data.sentimientoPromedio) ? data.sentimientoPromedio.toFixed(3) : 'sin datos' }) });
        $('whatsappLink').href = result.url;
        $('whatsappLink').textContent = 'Abrir WhatsApp con el mensaje de alerta ↗';
        $('whatsappLink').classList.remove('hidden');
        $('settingsStatus').textContent = `${result.detalle} Se usó tu plantilla guardada, con los datos del análisis.`;
    } catch (error) { $('settingsStatus').textContent = error.message; }
});
$('whatsappTestButton').addEventListener('click', async () => {
    try {
        const settings = await api('/api/settings/whatsapp', { method: 'PUT', body: JSON.stringify({ phone: $('whatsappPhone').value, message: $('whatsappMessage').value }) });
        currentUser = settings.user;
        $('whatsappPhone').value = settings.user.phone || '';
        const result = await api('/api/whatsapp-alert', { method: 'POST', body: JSON.stringify({ test: true }) });
        $('whatsappLink').href = result.url;
        $('whatsappLink').textContent = 'Abrir WhatsApp con el mensaje de prueba ↗';
        $('whatsappLink').classList.remove('hidden');
        $('settingsStatus').textContent = 'Esto es solo una prueba de apertura de WhatsApp. Para enviar el análisis, usá “Preparar mensaje de alerta”.';
    } catch (error) { $('settingsStatus').textContent = error.message; }
});

function setState(state, message = '') {
    for (const id of ['emptyState', 'loadingState', 'errorState', 'content', 'marketHighlights']) $(id).classList.add('hidden');
    if (state === 'empty') { $('emptyState').classList.remove('hidden'); $('marketHighlights').classList.remove('hidden'); }
    if (state === 'loading') $('loadingState').classList.remove('hidden');
    if (state === 'error') {
        $('errorMessage').textContent = message;
        $('errorState').classList.remove('hidden');
    }
    if (state === 'content') $('content').classList.remove('hidden');
}

async function runAnalysis(override) {
    const params = override || {
        ticker: $('ticker').value.trim().toUpperCase(),
        periodo: $('periodo').value,
        intervalo: $('intervalo').value,
        umbralCompra: $('umbralCompra').value,
        umbralVenta: $('umbralVenta').value
    };
    if (!params.ticker) {
        $('ticker').focus();
        $('ticker').setCustomValidity('Ingresá el símbolo de un activo.');
        return;
    }
    $('ticker').setCustomValidity('');
    lastQuery = { ...params };
    $('ticker').value = params.ticker;
    $('periodo').value = params.periodo;
    $('intervalo').value = params.intervalo;
    $('umbralCompra').value = params.umbralCompra;
    $('umbralVenta').value = params.umbralVenta;
    $('umbralCompraVal').textContent = Number(params.umbralCompra).toFixed(2);
    $('umbralVentaVal').textContent = Number(params.umbralVenta).toFixed(2);

    setState('loading');
    $('ejecutar').disabled = true;
    $('ejecutar').querySelector('span:first-child').textContent = 'Analizando…';
    const query = new URLSearchParams(params);

    try {
        const response = await fetch(`/api/analyze?${query}`, { headers: { Accept: 'application/json' } });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'No se pudo completar el análisis.');
        renderAnalysis(data, params);
        lastAnalysis = data;
        $('buyButton').classList.remove('hidden');
        $('favoriteButton').classList.remove('hidden');
        $('saveAnalysisButton').classList.remove('hidden');
        updateFavoriteButton();
        setState('content');
        window.location.hash = 'overview';
    } catch (error) {
        setState('error', error.message === 'Failed to fetch'
            ? 'No se pudo conectar con el servidor. Verificá que la app esté iniciada y volvé a intentar.'
            : error.message);
    } finally {
        $('ejecutar').disabled = false;
        $('ejecutar').querySelector('span:first-child').textContent = 'Analizar activo';
    }
}

function formatMoney(value, currency) {
    if (!Number.isFinite(value)) return '—';
    if (!currency) return `${value.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} <sin moneda>`;
    try {
        return new Intl.NumberFormat('es-AR', { style: 'currency', currency, maximumFractionDigits: 2 }).format(value);
    } catch {
        return `${value.toLocaleString('es-AR', { maximumFractionDigits: 2 })} ${currency}`;
    }
}

function formatDate(value, withTime = false) {
    if (!value || !Number.isFinite(Date.parse(value))) return 'Fecha no informada';
    return new Intl.DateTimeFormat('es-AR', {
        dateStyle: 'medium',
        ...(withTime ? { timeStyle: 'short' } : {}),
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone
    }).format(new Date(value));
}

function renderPeriodSummary(summary, currency) {
    if (!summary) {
        $('periodSummaryText').textContent = 'No hay suficientes cierres válidos para resumir este periodo.';
        $('periodSummaryRange').textContent = 'Sin muestra';
        $('periodSummaryHigh').textContent = 'Máximo: —';
        $('periodSummaryLow').textContent = 'Mínimo: —';
        $('periodSummaryCount').textContent = 'Muestra: —';
        return;
    }
    const change = Number(summary.variacionPct);
    const direction = change > 0 ? 'subió' : change < 0 ? 'bajó' : 'se mantuvo sin variación neta';
    $('periodSummaryRange').textContent = `${formatDate(summary.desde)} – ${formatDate(summary.hasta)}`;
    $('periodSummaryText').textContent = `Entre el primer y el último cierre del periodo, ${direction} ${Math.abs(change).toFixed(2)}% (${formatMoney(summary.precioInicial, currency)} a ${formatMoney(summary.precioFinal, currency)}). Es variación de precio; no incluye dividendos.`;
    $('periodSummaryHigh').textContent = `Máximo de cierre: ${formatMoney(summary.maximo.precio, currency)} · ${formatDate(summary.maximo.fecha)}`;
    $('periodSummaryLow').textContent = `Mínimo de cierre: ${formatMoney(summary.minimo.precio, currency)} · ${formatDate(summary.minimo.fecha)}`;
    $('periodSummaryCount').textContent = `Muestra: ${summary.observaciones} cierres`;
}

function renderEvents(events, status) {
    const list = $('eventsList');
    list.replaceChildren();
    $('eventsStatus').textContent = status === 'error' ? 'Fuente no disponible' : status === 'sin_eventos' ? 'Sin próximos eventos' : events?.length ? `${events.length} eventos` : 'Sin datos';
    if (status === 'error') {
        const empty = document.createElement('p'); empty.className = 'portfolio-empty'; empty.textContent = 'No se pudo consultar el calendario. El resto del análisis sigue disponible.'; list.append(empty); return;
    }
    if (!events?.length) {
        const empty = document.createElement('p'); empty.className = 'portfolio-empty'; empty.textContent = 'El proveedor no reporta próximos resultados o fechas de dividendos para este activo.'; list.append(empty); return;
    }
    for (const event of events) {
        const row = document.createElement('div'); row.className = 'event-row';
        const body = document.createElement('div');
        const title = document.createElement('strong'); title.textContent = `${event.titulo}${event.estimado ? ' · estimado' : ''}`;
        const source = document.createElement('small'); source.textContent = `Fuente: ${event.fuente || 'no informada'}`;
        const date = document.createElement('time'); date.dateTime = event.fecha; date.textContent = formatDate(event.fecha);
        body.append(title, source); row.append(body, date); list.append(row);
    }
}

function renderVariationContext(context) {
    const list = $('variationNewsList');
    list.replaceChildren();
    const items = context?.noticias || [];
    $('variationNewsCount').textContent = `${items.length} ${items.length === 1 ? 'titular' : 'titulares'}`;
    const interval = context?.desde || context?.hasta ? `Intervalo revisado: ${formatDate(context.desde, true)} – ${formatDate(context.hasta, true)}. ` : '';
    $('variationContextNote').textContent = `${interval}${context?.nota || 'La coincidencia temporal no demuestra causalidad.'}`;
    if (!items.length) {
        const empty = document.createElement('p'); empty.className = 'portfolio-empty';
        empty.textContent = 'No hay titulares con medio y enlace compatibles dentro del intervalo temporal de esta variación.';
        list.append(empty); return;
    }
    for (const item of items) {
        const row = document.createElement('div'); row.className = 'variation-news-row';
        const copy = document.createElement('div');
        const title = document.createElement('strong'); title.textContent = item.titulo;
        const meta = document.createElement('small'); meta.textContent = `${item.fuente || 'Fuente no informada'}${item.paginaFuente ? ` · ${item.paginaFuente}` : ''} · ${formatDate(item.fecha, true)} · VADER ${Number(item.score).toFixed(3)}`;
        copy.append(title, meta);
        if (item.url) {
            const link = document.createElement('a'); link.href = item.url; link.target = '_blank'; link.rel = 'noopener noreferrer'; link.className = 'news-link'; link.textContent = 'Abrir fuente ↗';
            row.append(copy, link);
        } else row.append(copy);
        list.append(row);
    }
}

function downloadFile(filename, contents, mimeType) {
    const url = URL.createObjectURL(new Blob([contents], { type: mimeType }));
    const link = document.createElement('a'); link.href = url; link.download = filename; link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function csvCell(value) {
    let safe = value == null ? '' : String(value);
    if (typeof value !== 'number' && /^[=+\-@\t\r]/.test(safe)) safe = `'${safe}`;
    return `"${safe.replace(/"/g, '""')}"`;
}

function downloadAnalysisCsv(data) {
    const rows = [['seccion', 'campo', 'valor', 'fuente', 'puntuacion', 'url']];
    const add = (section, key, value) => rows.push([section, key, value]);
    for (const [key, value] of Object.entries({ ticker: data.ticker, nombre: data.nombre, periodo_seleccionado: data.periodoSeleccionado, intervalo: data.intervaloSeleccionado, moneda: data.moneda, mercado: data.exchange, precio: data.precioActual, fecha_precio: data.fechaPrecio, fuente_precio: data.fuenteCotizacion, estado_precio: data.estadoActualizacion || data.estadoCotizacion, variacion_pct: data.variacionPct, comparacion_variacion: data.periodoVariacion, sentimiento_titulares: data.sentimientoPromedio, estado_noticias: data.estadoNoticias, titulares_validos: data.cantidadNoticias, orientacion_educativa: data.orientacionEducativa?.resultado, puntaje_orientacion: data.orientacionEducativa?.puntaje, metodologia_orientacion: data.orientacionEducativa?.metodologia, bolsa_oficial: data.fuentesOficiales?.mercado?.url, periodo_desde: data.resumenPeriodo?.desde, periodo_hasta: data.resumenPeriodo?.hasta, variacion_periodo_pct: data.resumenPeriodo?.variacionPct, maximo_cierre: data.resumenPeriodo?.maximo?.precio, minimo_cierre: data.resumenPeriodo?.minimo?.precio, contexto_variacion_desde: data.contextoVariacion?.desde, contexto_variacion_hasta: data.contextoVariacion?.hasta })) add('resumen', key, value);
    for (const quote of data.precios || []) add('cierres_historicos', quote.fecha, quote.close);
    for (const article of data.detalleNoticias || []) {
        add('noticias', article.fecha, article.titulo);
        const row = rows.length - 1;
        rows[row].push(article.fuente || '', article.score, article.url || '');
    }
    for (const event of data.calendarioEventos || []) add('eventos', event.fecha, `${event.titulo}${event.estimado ? ' (estimado)' : ''} · ${event.fuente || ''}`);
    const csv = rows.map((row) => row.map(csvCell).join(',')).join('\r\n');
    downloadFile(`Assetly-Finance-${data.ticker}-${new Date().toISOString().slice(0, 10)}.csv`, `\uFEFF${csv}`, 'text/csv;charset=utf-8');
}

function renderScenario() {
    const change = Number($('scenarioChange').value);
    const result = $('scenarioResult');
    if (!lastAnalysis || !Number.isFinite(lastAnalysis.precioActual) || !Number.isFinite(change) || change < -90 || change > 300) { result.textContent = 'Analizá un activo e ingresá un cambio entre -90% y +300%.'; return; }
    const hypotheticalPrice = lastAnalysis.precioActual * (1 + change / 100);
    result.textContent = `Si ${lastAnalysis.ticker} variara hipotéticamente ${change > 0 ? '+' : ''}${change}%, el precio calculado sería ${formatMoney(hypotheticalPrice, lastAnalysis.moneda)} frente al último dato ${formatMoney(lastAnalysis.precioActual, lastAnalysis.moneda)} (${formatDate(lastAnalysis.fechaPrecio)}). Es una operación aritmética, no una predicción.`;
}

async function loadFundamentals(ticker) {
    const list = $('fundamentalsList'); list.replaceChildren(); $('fundamentalsStatus').textContent = 'Consultando';
    try {
        const data = await api(`/api/fundamentals?ticker=${encodeURIComponent(ticker)}`);
        $('fundamentalsStatus').textContent = data.estado === 'disponible' ? `${data.fuente} · ${formatDate(data.consultadoEn, true)}` : data.estado;
        $('fundamentalsMeta').textContent = [data.sector, data.industria, data.moneda, data.nota].filter(Boolean).join(' · ') || 'No hay perfil o métricas reportadas para este símbolo.';
        for (const metric of Object.values(data.metricas || {})) { const cell = document.createElement('div'); const name = document.createElement('span'); name.textContent = metric.etiqueta; const value = document.createElement('strong'); value.textContent = metric.valor == null ? 'No disponible' : metric.unidad === 'ratio' ? `${(metric.valor * 100).toFixed(2)}%` : metric.unidad === 'ratio_x100' ? `${(metric.valor / 100).toFixed(2)}× (fuente / 100)` : metric.unidad === 'veces' ? `${metric.valor.toFixed(2)}×` : formatMoney(metric.valor, data.moneda); cell.append(name, value); list.append(cell); }
        if (!list.childElementCount) $('fundamentalsMeta').textContent = data.error || 'El proveedor no reporta métricas en este momento.';
    } catch (error) { $('fundamentalsStatus').textContent = 'No disponible'; $('fundamentalsMeta').textContent = error.message; }
}

async function exportPersonalData() {
    $('exportStatus').textContent = 'Preparando exportación…';
    try {
        const [favorites, analyses, portfolio, goals, journal] = await Promise.all([api('/api/favorites'), api('/api/saved-analyses'), api('/api/portfolio'), api('/api/goals'), api('/api/journal')]);
        const document = { exportadoEn: new Date().toISOString(), usuario: currentUser?.email || null, preferencias: currentUser?.preferences || loadLocalPreferences(), favoritos: favorites.favorites || [], analisisGuardados: analyses.analyses || [], carteraVirtual: portfolio.positions || [], tenenciasCalculadas: portfolio.holdings || [], objetivos: goals.goals || [], diario: journal.entries || [] };
        downloadFile(`Assetly-Finance-mis-datos-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(document, null, 2), 'application/json;charset=utf-8');
        $('exportStatus').textContent = 'Exportación JSON descargada.';
    } catch (error) { $('exportStatus').textContent = `No se pudo exportar: ${error.message}`; }
}

function renderAnalysis(data, params) {
    const ticker = data.ticker || params.ticker;
    $('assetName').textContent = data.nombre || ticker;
    $('assetTicker').textContent = ticker;
    $('assetMonogram').textContent = ticker.replace(/[^A-Z0-9]/g, '').slice(0, 2) || 'AF';
    $('assetExchange').textContent = [data.exchange, data.moneda ? `Moneda ${data.moneda}` : 'Moneda no informada'].filter(Boolean).join(' · ');
    renderQuotePrice(data);

    const variation = Number.isFinite(data.variacionPct) ? data.variacionPct : null;
    $('metricVariacion').textContent = variation == null ? '—' : `${variation > 0 ? '+' : ''}${variation.toFixed(2)}%`;
    $('metricVariacion').className = variation == null ? 'metric-value' : `metric-value ${variation >= 0 ? 'positive-text' : 'negative-text'}`;
    $('variationContext').textContent = data.periodoVariacion || 'No hay cierre anterior para comparar';

    const hasSentiment = data.estadoSentimiento === 'disponible' && Number.isFinite(data.sentimientoPromedio);
    $('metricSentimiento').textContent = hasSentiment ? data.sentimientoPromedio.toFixed(3) : '—';
    $('sentimentContext').textContent = hasSentiment ? 'Promedio de sentimiento VADER' : 'Sin noticias válidas';
    $('metricNoticias').textContent = String(data.cantidadNoticias || 0);
    $('signalValue').textContent = !hasSentiment ? 'Sin muestra' : data.senal === 'COMPRA' ? 'Tono positivo' : data.senal === 'VENTA' ? 'Tono negativo' : 'Dentro del rango';
    $('signalCard').dataset.signal = data.senal;
    $('signalIndicator').style.backgroundColor = data.color || colors.muted;
    $('signalContext').textContent = hasSentiment
        ? `VADER resume el texto; no indica una operación. Umbrales +${Number(data.umbralCompra).toFixed(2)} / ${Number(data.umbralVenta).toFixed(2)}.`
        : 'No se evalúa el tono sin titulares válidos.';
    $('thresholdReadout').textContent = `Tono positivo ≥ ${Number(data.umbralCompra).toFixed(2)} · Negativo ≤ ${Number(data.umbralVenta).toFixed(2)}`;
    $('refreshInfo').textContent = `Consultado ${formatDate(data.generadoEn, true)}`;
    $('chartTicker').textContent = ticker;
    $('chartPeriod').textContent = `${periodLabel(params.periodo)} · ${params.intervalo === '1h' ? 'cada hora' : 'diario'}`;
    $('chartTimezone').textContent = data.zonaHoraria ? `Mercado: ${data.zonaHoraria}` : 'Fechas en tu zona horaria';
    renderSentiment(data, hasSentiment);
    renderNews(data.detalleNoticias || [], data.estadoNoticias);
    renderPeriodSummary(data.resumenPeriodo, data.moneda);
    renderEvents(data.calendarioEventos, data.estadoCalendario);
    renderVariationContext(data.contextoVariacion);
    renderDataQuality(data);
    renderAssessment(data.orientacionEducativa, data.fuentesOficiales);
    renderChart(data.precios || [], ticker, data.moneda);
    loadFundamentals(ticker);
    $('scenarioResult').textContent = 'Elegí un porcentaje y calculá el escenario hipotético.';
    $('downloadAnalysisButton').classList.remove('hidden');
}

function renderDataQuality(data) {
    const stale = data.estadoActualizacion === 'desactualizada' || data.estadoCotizacion === 'solo_cierre_historico';
    $('qualityQuoteStatus').textContent = data.estadoActualizacion === 'desactualizada'
        ? 'No actualizado · último dato guardado'
        : data.estadoActualizacion === 'proveedor_alternativo' ? 'Actualizado · proveedor alternativo'
        : data.estadoCotizacion === 'solo_cierre_historico' ? 'No se obtuvo cotización actual · último cierre histórico' : data.tipoPrecio === 'lastClose' ? 'Último cierre disponible' : 'Cotización consultada al proveedor';
    $('qualityQuoteSource').textContent = data.fuenteCotizacion || 'Yahoo Finance · serie histórica';
    $('qualityQuoteDate').textContent = formatDate(data.fechaPrecio, true);
    $('qualityMarket').textContent = `${data.moneda || 'Moneda no informada'} · ${data.exchange || 'Mercado no informado'}`;
    $('qualityDelay').textContent = Number(data.retrasoMinutos) > 0 ? `${data.retrasoMinutos} minutos (reportada por la fuente)` : 'No informada por la fuente';
    $('qualityVariation').textContent = data.periodoVariacion || 'No hay dato anterior para comparar';
    $('qualityNews').textContent = data.estadoNoticias === 'error' ? 'Fuente no disponible · sentimiento omitido'
        : data.cantidadNoticias > 0 ? `${data.cantidadNoticias} titulares con enlace y medio identificable` : 'Sin noticias válidas · sentimiento omitido';
    const sample = data.calidadMuestra;
    $('qualitySample').textContent = sample ? `${sample.observaciones} cierres · ${formatDate(sample.primerCierre)} a ${formatDate(sample.ultimoCierre)} · mayor intervalo ${sample.mayorIntervaloDias == null ? '—' : `${sample.mayorIntervaloDias.toFixed(1)} días`}. ${sample.nota}` : 'Sin datos de muestra';
    $('quoteWarning').textContent = data.avisoActualizacion || data.avisoCotizacion || (stale ? 'No se pudo actualizar; se muestra un dato histórico con su fecha original.' : '');
    $('quoteWarning').classList.toggle('hidden', !$('quoteWarning').textContent);
}

function renderQuotePrice(data) {
    $('metricPrecio').textContent = formatMoney(data.precioActual, data.moneda);
    const date = formatDate(data.fechaPrecio, true);
    const state = String(data.estadoMercado || '').toUpperCase();
    if (data.estadoActualizacion === 'desactualizada') {
        $('quoteBadge').textContent = 'Último dato guardado · no actualizado';
        $('priceDate').textContent = `Dato del ${date}${data.fuenteCotizacion ? ` · ${data.fuenteCotizacion}` : ''}`;
    } else if (!data.tipoPrecio || data.tipoPrecio === 'lastClose') {
        $('quoteBadge').textContent = data.estadoCotizacion === 'solo_cierre_historico' ? 'No se pudo actualizar · último cierre histórico' : 'Último cierre disponible';
        $('priceDate').textContent = `Último cierre · ${date}${data.zonaHoraria ? ` · ${data.zonaHoraria}` : ''}`;
    } else {
        const labels = { preMarket: 'Premercado', postMarket: 'Posmercado', regularMarket: 'Mercado regular', extendedMarket: 'Horario extendido' };
        const marketLabel = state === 'CLOSED' ? 'Mercado cerrado · último dato'
            : state === 'PRE' && data.tipoPrecio === 'regularMarket' ? 'Premercado · último dato regular'
                : state === 'POST' && data.tipoPrecio === 'regularMarket' ? 'Posmercado · último dato regular'
                    : labels[data.tipoPrecio] || 'Cotización del proveedor';
        const currentLabel = data.estadoActualizacion === 'proveedor_alternativo' ? `Proveedor alternativo · ${marketLabel}` : marketLabel;
        $('quoteBadge').textContent = Number(data.retrasoMinutos) > 0 ? `${currentLabel} · retraso ${data.retrasoMinutos} min` : currentLabel;
        $('priceDate').textContent = `Dato del proveedor · ${date}${data.fuenteCotizacion ? ` · ${data.fuenteCotizacion}` : ''}`;
    }
    $('quoteUpdated').textContent = data.estadoActualizacion === 'desactualizada' ? `Sin actualizar · último registro guardado ${formatDate(data.cacheGuardadaEn, true)}` : data.estadoActualizacion === 'proveedor_alternativo' ? 'Yahoo Finance no respondió; dato alternativo validado.' : data.tipoPrecio && data.tipoPrecio !== 'lastClose' ? 'Se actualiza automáticamente cada 30 segundos mientras esta vista está abierta.' : '';
    renderDataQuality(data);
}

async function updateLiveQuote() {
    if (!lastAnalysis || document.hidden) return;
    try {
        const quote = await api(`/api/quote?ticker=${encodeURIComponent(lastAnalysis.ticker)}`, { cache: 'no-store' });
        lastAnalysis.precioActual = quote.precio;
        lastAnalysis.fechaPrecio = quote.fecha;
        lastAnalysis.tipoPrecio = quote.tipo;
        lastAnalysis.estadoMercado = quote.estadoMercado;
        lastAnalysis.estadoActualizacion = quote.estadoActualizacion;
        lastAnalysis.exchange = quote.exchange || lastAnalysis.exchange;
        lastAnalysis.moneda = quote.moneda || lastAnalysis.moneda;
        lastAnalysis.retrasoMinutos = quote.retrasoMinutos;
        lastAnalysis.fuenteCotizacion = quote.fuente;
        lastAnalysis.avisoActualizacion = quote.avisoActualizacion;
        lastAnalysis.cacheGuardadaEn = quote.cacheGuardadaEn;
        if (Number.isFinite(quote.variacionPct)) lastAnalysis.variacionPct = quote.variacionPct;
        renderQuotePrice(lastAnalysis);
        if (Number.isFinite(quote.variacionPct)) {
            $('metricVariacion').textContent = `${quote.variacionPct > 0 ? '+' : ''}${quote.variacionPct.toFixed(2)}%`;
            $('metricVariacion').className = `metric-value ${quote.variacionPct >= 0 ? 'positive-text' : 'negative-text'}`;
            $('variationContext').textContent = 'vs. cierre previo de la sesión';
        }
    } catch {
        lastAnalysis.estadoActualizacion = 'desactualizada';
        lastAnalysis.avisoActualizacion = 'No se pudo actualizar la cotización. Se conserva el dato anterior, que no debe interpretarse como actual.';
        renderQuotePrice(lastAnalysis);
    }
}

function renderSentiment(data, hasSentiment) {
    const value = hasSentiment ? data.sentimientoPromedio : null;
    $('scoreValue').textContent = value == null ? '—' : value.toFixed(3);
    $('sentimentLabel').textContent = !hasSentiment ? 'Sin datos' : data.senal === 'COMPRA' ? 'Tono positivo' : data.senal === 'VENTA' ? 'Tono negativo' : 'Dentro del rango';
    $('sentimentDescription').textContent = !hasSentiment
        ? data.estadoNoticias === 'error'
            ? 'No se pudo consultar la fuente de noticias en esta actualización. El sistema omite la señal de sentimiento.'
            : 'No llegaron titulares válidos. Sin una muestra de noticias, el sistema no calcula sentimiento ni genera una señal.'
        : `${data.cantidadNoticias} titular${data.cantidadNoticias === 1 ? '' : 'es'} puntuado${data.cantidadNoticias === 1 ? '' : 's'} con VADER. La señal refleja el tono textual promedio y no una predicción de rendimiento.`;
    const marker = $('scoreMarker');
    marker.style.left = `${value == null ? 50 : Math.max(0, Math.min(100, ((value + 1) / 2) * 100))}%`;
    const tone = !hasSentiment ? colors.muted : value > Number(data.umbralCompra) ? colors.buy : value < Number(data.umbralVenta) ? colors.sell : colors.hold;
    $('scoreRing').style.setProperty('--score-color', tone);
    $('scoreRing').classList.toggle('no-score', !hasSentiment);
}

function renderAssessment(assessment, sources) {
    const result = $('assessmentResult');
    const outcome = assessment?.resultado || 'DATOS INSUFICIENTES';
    result.textContent = outcome;
    result.dataset.state = outcome.startsWith('COMPRAR') ? 'favorable' : outcome.startsWith('VENDER') ? 'desfavorable' : outcome.startsWith('MANTENER') ? 'mixto' : 'sin_datos';
    $('assessmentDisclaimer').textContent = assessment?.aviso || 'Orientación educativa automática; no constituye asesoramiento financiero.';
    $('assessmentMethod').textContent = assessment?.metodologia || 'No hay metodología disponible para esta consulta.';
    const components = $('assessmentComponents'); components.replaceChildren();
    for (const item of assessment?.componentes || []) {
        const box = document.createElement('article'); box.className = 'assessment-component';
        const title = document.createElement('strong'); title.textContent = `${item.nombre} · ${item.estado.replaceAll('_', ' ')}`;
        const detail = document.createElement('span'); detail.textContent = item.detalle;
        box.append(title, detail); components.append(box);
    }
    const links = $('assessmentSources'); links.replaceChildren();
    const quote = sources?.cotizacion;
    const quoteInfo = document.createElement('span'); quoteInfo.textContent = `${quote?.nombre || 'Yahoo Finance'} · precio consultado ${formatDate(quote?.fecha, true)}`; quoteInfo.className = 'panel-hint'; links.append(quoteInfo);
    const exchange = sources?.mercado;
    if (exchange?.url) { const link = document.createElement('a'); link.href = exchange.url; link.target = '_blank'; link.rel = 'noopener noreferrer'; link.textContent = `${exchange.nombre} ↗`; links.append(link); }
    else { const unavailable = document.createElement('span'); unavailable.textContent = 'No identificamos la bolsa oficial para este símbolo.'; unavailable.className = 'panel-hint'; links.append(unavailable); }
    const seen = new Set();
    for (const news of sources?.noticias || []) {
        if (!news.url || seen.has(news.url)) continue;
        seen.add(news.url); const link = document.createElement('a'); link.href = news.url; link.target = '_blank'; link.rel = 'noopener noreferrer'; link.textContent = `${news.medio || 'Medio'} · ${news.pagina || 'publicación'} ↗`; links.append(link);
    }
}

function renderNews(news, newsStatus) {
    const list = $('newsList');
    list.replaceChildren();
    $('newsCountLabel').textContent = `${news.length} titular${news.length === 1 ? '' : 'es'}`;
    const positive = news.filter((item) => item.score > 0.05).length;
    const negative = news.filter((item) => item.score < -0.05).length;
    const neutral = news.length - positive - negative;
    const dates = news.map((item) => Date.parse(item.fecha || '')).filter(Number.isFinite).sort((a, b) => a - b);
    const publishers = new Set(news.map((item) => item.fuente).filter(Boolean));
    $('newsContextSummary').textContent = news.length
        ? `Muestra reciente: ${positive} titulares de tono positivo, ${neutral} neutral${neutral === 1 ? '' : 'es'} y ${negative} negativo${negative === 1 ? '' : 's'} según VADER; ${publishers.size} medio${publishers.size === 1 ? '' : 's'} identificable${publishers.size === 1 ? '' : 's'}${dates.length ? ` · publicados entre ${formatDate(dates[0])} y ${formatDate(dates[dates.length - 1])}` : ''}. El tono textual no indica por sí mismo el impacto en el precio.`
        : newsStatus === 'error' ? 'No hay contexto de noticias porque la consulta de la fuente falló.' : 'No hay titulares válidos para resumir; esto no equivale a sentimiento neutral.';
    $('noNews').classList.toggle('hidden', news.length !== 0);
    list.classList.toggle('hidden', news.length === 0);
    $('noNewsTitle').textContent = newsStatus === 'error'
        ? 'No se pudo consultar la fuente de noticias'
        : 'No hay noticias relevantes para analizar';
    $('noNewsText').textContent = newsStatus === 'error'
        ? 'Falló la consulta de noticias. El análisis de precio está disponible, pero no se calcula una señal de sentimiento.'
        : 'No aparecieron titulares recientes que mencionen el activo con texto disponible. La señal no se calcula sin datos.';

    for (const article of news) {
        const row = document.createElement('article');
        row.className = 'news-row';
        const score = document.createElement('span');
        score.className = `news-score ${article.score > 0.05 ? 'positive' : article.score < -0.05 ? 'negative' : 'neutral'}`;
        score.textContent = Number(article.score).toFixed(2);
        score.setAttribute('aria-label', `Puntuación ${Number(article.score).toFixed(2)}`);
        const body = document.createElement('div');
        body.className = 'news-body';
        const title = document.createElement('p');
        title.className = 'news-title';
        title.textContent = article.titulo;
        const meta = document.createElement('div');
        meta.className = 'news-meta';
        const source = document.createElement('span');
        source.textContent = `${article.fuente || 'Fuente editorial no informada'}${article.paginaFuente ? ` · ${article.paginaFuente}` : ' · enlace del medio validado'}`;
        meta.append(source);
        if (article.fecha) {
            const date = document.createElement('span');
            date.textContent = formatDate(article.fecha, true);
            meta.append(date);
        }
        body.append(title, meta);
        if (article.url) {
            const link = document.createElement('a');
            link.href = article.url;
            link.target = '_blank';
            link.rel = 'noopener noreferrer';
            link.className = 'news-link';
            link.textContent = article.paginaFuente ? 'Abrir artículo atribuido ↗' : 'Abrir publicación ↗';
            link.setAttribute('aria-label', `Abrir publicación enlazada de la noticia: ${article.titulo}`);
            row.append(score, body, link);
        } else {
            row.append(score, body);
        }
        list.append(row);
    }
}

function renderChart(points, ticker, currency) {
    const canvas = $('priceChart');
    const fallback = $('chartFallback');
    if (priceChart) {
        priceChart.destroy();
        priceChart = null;
    }
    if (!window.Chart || points.length < 2) {
        canvas.classList.add('hidden');
        fallback.classList.remove('hidden');
        fallback.textContent = points.length ? 'Se necesita más de una cotización para graficar este periodo.' : 'No hay cotizaciones disponibles para graficar.';
        return;
    }
    canvas.classList.remove('hidden');
    fallback.classList.add('hidden');
    const labels = points.map((point) => new Intl.DateTimeFormat('es-AR', { month: 'short', day: 'numeric' }).format(new Date(point.fecha)));
    const gradient = canvas.getContext('2d').createLinearGradient(0, 0, 0, 280);
    gradient.addColorStop(0, 'rgba(100, 149, 255, 0.20)');
    gradient.addColorStop(1, 'rgba(100, 149, 255, 0)');
    priceChart = new window.Chart(canvas.getContext('2d'), {
        type: 'line',
        data: { labels, datasets: [{
            label: `${ticker}${currency ? ` · ${currency}` : ''}`,
            data: points.map((point) => point.close),
            borderColor: '#82a7ff', backgroundColor: gradient, borderWidth: 2,
            pointRadius: 0, pointHitRadius: 10, tension: 0.28, fill: true
        }] },
        options: {
            responsive: true, maintainAspectRatio: false, interaction: { intersect: false, mode: 'index' },
            plugins: {
                legend: { display: false },
                tooltip: { backgroundColor: '#161d27', borderColor: '#293342', borderWidth: 1, titleColor: '#f3f5f8', bodyColor: '#a9b3c2', padding: 12,
                    callbacks: { label: (context) => formatMoney(context.parsed.y, currency) } }
            },
            scales: {
                x: { grid: { display: false }, border: { display: false }, ticks: { color: colors.muted, maxTicksLimit: 7, maxRotation: 0 } },
                y: { position: 'right', grid: { color: colors.grid }, border: { display: false }, ticks: { color: colors.muted, maxTicksLimit: 5, callback: (value) => currency ? formatMoney(value, currency) : Number(value).toFixed(2) } }
            }
        }
    });
}

function periodLabel(period) {
    return ({ '1mo': '1 mes', '3mo': '3 meses', '6mo': '6 meses', '1y': '1 año' })[period] || period;
}

setState('empty');
applyPreferences(loadLocalPreferences());
loadMarketHighlights();
handleLocation();
window.addEventListener('hashchange', handleLocation);
api('/api/config').then(refreshAccount).catch(() => {});
window.setInterval(updateLiveQuote, 30_000);
window.setInterval(() => { if (!$('marketHighlights').classList.contains('hidden')) loadMarketHighlights(); }, 30_000);
