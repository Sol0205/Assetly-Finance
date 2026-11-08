'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DEFAULT_MESSAGE = 'Assetly Finance · {ticker}: lectura educativa {senal}. Último cierre: {precio} {moneda} ({fecha}). Sentimiento de titulares: {sentimiento}. No es asesoramiento financiero.';
const LEGACY_DEFAULT_MESSAGE = 'AI Finance · {ticker}: señal educativa {senal}. Último cierre: {precio} {moneda} ({fecha}). Sentimiento: {sentimiento}. No es asesoramiento financiero.';
const DEFAULT_PREFERENCES = { textSize: 'normal', highContrast: false, reduceMotion: false, theme: 'dark' };

class UserStore {
    constructor(file = path.join(process.env.DATA_DIR || path.join(__dirname, '..', 'data'), 'users.json')) {
        this.file = file;
        this.data = { users: [] };
        try {
            const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
            if (Array.isArray(parsed.users)) {
                this.data = parsed;
                let migrated = false;
                for (const user of this.data.users) {
                    user.favorites ||= [];
                    user.savedAnalyses ||= [];
                    user.goals ||= [];
                    user.journal ||= [];
                    user.preferences ||= { ...DEFAULT_PREFERENCES };
                    if (user.whatsappMessage === LEGACY_DEFAULT_MESSAGE) { user.whatsappMessage = DEFAULT_MESSAGE; migrated = true; }
                }
                if (migrated) this.persist();
            }
        } catch (error) {
            if (error.code !== 'ENOENT') throw error;
        }
    }

    persist() {
        fs.mkdirSync(path.dirname(this.file), { recursive: true, mode: 0o700 });
        const temp = `${this.file}.${process.pid}.tmp`;
        fs.writeFileSync(temp, JSON.stringify(this.data, null, 2), { mode: 0o600 });
        fs.renameSync(temp, this.file);
    }

    publicUser(user) {
        return { id: user.id, email: user.email, phone: user.phone, whatsappMessage: user.whatsappMessage, preferences: user.preferences || { ...DEFAULT_PREFERENCES }, createdAt: user.createdAt };
    }

    create({ email, password, defaultPhone = '' }) {
        const normalized = email.trim().toLowerCase();
        if (this.data.users.some((user) => user.email === normalized)) return { error: 'Ese correo ya tiene una cuenta.' };
        const salt = crypto.randomBytes(16);
        const hash = crypto.scryptSync(password, salt, 64);
        const user = { id: crypto.randomUUID(), email: normalized, salt: salt.toString('hex'), passwordHash: hash.toString('hex'), phone: defaultPhone, whatsappMessage: DEFAULT_MESSAGE, preferences: { ...DEFAULT_PREFERENCES }, portfolio: [], favorites: [], savedAnalyses: [], goals: [], journal: [], createdAt: new Date().toISOString() };
        this.data.users.push(user);
        this.persist();
        return { user: this.publicUser(user) };
    }

    authenticate(email, password) {
        const user = this.data.users.find((entry) => entry.email === email.trim().toLowerCase());
        if (!user) return null;
        const hash = crypto.scryptSync(password, Buffer.from(user.salt, 'hex'), 64);
        return crypto.timingSafeEqual(hash, Buffer.from(user.passwordHash, 'hex')) ? this.publicUser(user) : null;
    }

    get(id) { return this.data.users.find((user) => user.id === id) || null; }
    update(id, changes) {
        const user = this.get(id);
        if (!user) return null;
        Object.assign(user, changes);
        this.persist();
        return this.publicUser(user);
    }
    portfolio(id) { return this.get(id)?.portfolio || []; }
    addPosition(id, position) {
        const user = this.get(id);
        if (!user) return null;
        user.portfolio.push(position);
        this.persist();
        return user.portfolio;
    }
    favorites(id) { return this.get(id)?.favorites || []; }
    saveFavorite(id, favorite) {
        const user = this.get(id);
        if (!user) return null;
        if (!user.favorites.some((entry) => entry.ticker === favorite.ticker)) user.favorites.unshift(favorite);
        user.favorites = user.favorites.slice(0, 100);
        this.persist();
        return user.favorites;
    }
    removeFavorite(id, ticker) {
        const user = this.get(id);
        if (!user) return null;
        user.favorites = user.favorites.filter((entry) => entry.ticker !== ticker);
        this.persist();
        return user.favorites;
    }
    savedAnalyses(id) { return this.get(id)?.savedAnalyses || []; }
    saveAnalysis(id, analysis) {
        const user = this.get(id);
        if (!user) return null;
        user.savedAnalyses.unshift(analysis);
        user.savedAnalyses = user.savedAnalyses.slice(0, 100);
        this.persist();
        return user.savedAnalyses;
    }
    removeSavedAnalysis(id, analysisId) {
        const user = this.get(id);
        if (!user) return null;
        user.savedAnalyses = user.savedAnalyses.filter((entry) => entry.id !== analysisId);
        this.persist();
        return user.savedAnalyses;
    }
}

module.exports = { UserStore, DEFAULT_MESSAGE, DEFAULT_PREFERENCES };
