'use strict';

const fs = require('fs');
const path = require('path');

class MarketCache {
    constructor(file = path.join(process.env.DATA_DIR || path.join(__dirname, '..', 'data'), 'market-cache.json'), maxEntries = 500) {
        this.file = file;
        this.maxEntries = maxEntries;
        this.entries = {};
        try {
            const stored = JSON.parse(fs.readFileSync(file, 'utf8'));
            if (stored && typeof stored === 'object' && !Array.isArray(stored)) this.entries = stored;
        } catch (error) {
            if (error.code !== 'ENOENT') console.warn('[cache] No se pudo leer la caché persistida. Se inicia vacía.');
        }
    }

    get(key, maxAgeMs = Infinity, now = Date.now()) {
        const entry = this.entries[key];
        if (!entry || !Number.isFinite(Date.parse(entry.savedAt))) return null;
        const age = now - Date.parse(entry.savedAt);
        if (age < 0 || age > maxAgeMs) return null;
        return { value: entry.value, savedAt: entry.savedAt, ageMs: age };
    }

    set(key, value, now = new Date().toISOString()) {
        return this.setMany([{ key, value, savedAt: now }])[key];
    }

    setMany(items) {
        const saved = {};
        for (const { key, value, savedAt = new Date().toISOString() } of items) {
            this.entries[key] = { savedAt, value };
            saved[key] = this.entries[key];
        }
        const keys = Object.keys(this.entries).sort((a, b) => Date.parse(this.entries[a].savedAt) - Date.parse(this.entries[b].savedAt));
        while (keys.length > this.maxEntries) delete this.entries[keys.shift()];
        if (!items.length) return saved;
        fs.mkdirSync(path.dirname(this.file), { recursive: true, mode: 0o700 });
        const temporaryFile = `${this.file}.${process.pid}.tmp`;
        fs.writeFileSync(temporaryFile, JSON.stringify(this.entries), { mode: 0o600 });
        fs.renameSync(temporaryFile, this.file);
        return saved;
    }
}

module.exports = { MarketCache };
