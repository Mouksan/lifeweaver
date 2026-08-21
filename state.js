// ═══════════════════════════════════════════
// STATE — доступ к настройкам и per-chat данным
// ═══════════════════════════════════════════
//
// Упрощённая версия под Этап 1. Полную устойчивую логику с алиасами
// chatId (как в референсе) вернём на Этапе 2, когда появятся реальные
// данные, которые жалко потерять при смене имени чата. Пока просто
// доказываем, что каждый чат хранит свои данные отдельно и это переживает
// перезагрузку.

import { extension_settings } from '../../../extensions.js';
import { extensionName, defaultSettings, defaultChatData, defaultCharacterData, defaultPregnancyData, getPreset, getTotalWeeks, rollOffspringCount } from './config.js';

function cloneDefault(value) {
    return (value && typeof value === 'object') ? structuredClone(value) : value;
}

function ensureDefaults(target, defaults) {
    if (!target || typeof target !== 'object') return target;
    for (const key in defaults) {
        if (target[key] === undefined) target[key] = cloneDefault(defaults[key]);
    }
    return target;
}

export function getSettings() {
    if (!extension_settings[extensionName]) {
        extension_settings[extensionName] = cloneDefault(defaultSettings);
    }
    ensureDefaults(extension_settings[extensionName], defaultSettings);
    return extension_settings[extensionName];
}

// ── Определение id текущего чата ──
let _cachedChatId = null;

export function resetChatIdCache() {
    _cachedChatId = null;
}

function computeChatId() {
    try {
        const ctx = typeof SillyTavern?.getContext === 'function' ? SillyTavern.getContext() : null;
        if (!ctx) return null;

        const meta = ctx.chatMetadata || ctx.chat_metadata;
        const integrity = meta?.integrity;
        if ((typeof integrity === 'string' && integrity.length > 0) || typeof integrity === 'number') {
            return `uuid:${String(integrity)}`;
        }

        const directId = ctx.chatId;
        if ((typeof directId === 'string' && directId.trim().length > 0) || typeof directId === 'number') {
            return String(directId).trim();
        }
    } catch (e) { /* игнорируем — вернём null ниже */ }
    return null;
}

export function getCurrentChatId() {
    if (_cachedChatId) return _cachedChatId;
    const resolved = computeChatId();
    if (resolved) _cachedChatId = resolved;
    return resolved;
}

// ── Fallback, если chatId ещё не определён (чат не выбран) ──
// Изменения в нём НЕ переезжают в постоянное хранилище — это временная затычка.
let _fallback = null;

function getFallback() {
    if (!_fallback) _fallback = cloneDefault(defaultChatData);
    return _fallback;
}

export function getChatData() {
    const s = getSettings();
    const chatId = getCurrentChatId();

    if (!s.chatData) s.chatData = {};
    if (!chatId) return getFallback();

    if (!s.chatData[chatId]) {
        s.chatData[chatId] = cloneDefault(defaultChatData);
    }
    ensureDefaults(s.chatData[chatId], defaultChatData);
    return s.chatData[chatId];
}

// ── Активная вселенная — per-chat (один бот может трекаться по-разному в разных чатах) ──
export function getActiveUniverse() {
    return getChatData().universe || 'mpreg';
}

export function setActiveUniverse(universeId) {
    getChatData().universe = universeId;
}

// ── Данные персонажа (who: 'user' | 'char') ──
export function getCharacterData(who) {
    const chat = getChatData();
    if (!chat.characters) chat.characters = {};
    if (!chat.characters[who]) {
        chat.characters[who] = cloneDefault(
            who === 'char' ? { designation: 'alpha', cycleDay: 1 } : { designation: 'omega', cycleDay: 1 },
        );
    }
    ensureDefaults(chat.characters[who], defaultCharacterData);
    return chat.characters[who];
}

export function setDesignation(who, designation) {
    getCharacterData(who).designation = designation;
}

export function getCycleSettings() {
    const s = getSettings();
    return {
        heatCycleLength: Math.max(7, parseInt(s.heatCycleLength) || 42),
        heatDuration: Math.max(1, parseInt(s.heatDuration) || 5),
        rutCycleLength: Math.max(7, parseInt(s.rutCycleLength) || 70),
        rutDuration: Math.max(1, parseInt(s.rutDuration) || 3),
    };
}

export function setCycleDay(who, day) {
    const cfg = getCycleSettings();
    const character = getCharacterData(who);
    const maxDay = character.designation === 'alpha' ? cfg.rutCycleLength : cfg.heatCycleLength;
    character.cycleDay = Math.max(1, Math.min(maxDay, parseInt(day) || 1));
}

// Отображаемое имя персонажа для UI
export function carrierDisplayName(who) {
    try {
        const ctx = SillyTavern.getContext();
        return who === 'char' ? (ctx.name2 || 'Партнёр') : (ctx.name1 || 'Ты');
    } catch (e) {
        return who === 'char' ? 'Партнёр' : 'Ты';
    }
}

// ── Беременность/вынашивание ──
export function setCanCarry(who, value) {
    getCharacterData(who).canCarry = !!value;
}

function activePreset() {
    return getPreset(getActiveUniverse());
}

export function startPregnancy(who) {
    const preset = activePreset();
    const range = preset.offspringRange || { min: 1, max: 1 };
    const count = rollOffspringCount(range);
    const character = getCharacterData(who);
    character.pregnancy = { isPregnant: true, weeks: 0, stage: 'formation', offspringCount: count };
}

export function endPregnancy(who) {
    getCharacterData(who).pregnancy = cloneDefault(defaultPregnancyData);
}

export function setPregnancyWeeks(who, weeks) {
    const preset = activePreset();
    const character = getCharacterData(who);
    if (!character.pregnancy?.isPregnant) return;
    const total = getTotalWeeks(preset, getSettings().pregnancyDuration);
    const w = Math.max(0, Math.min(total, parseInt(weeks) || 0));
    character.pregnancy.weeks = w;
    if (preset.gestationType === 'staged') {
        character.pregnancy.stage = w >= preset.stages.first.weeks ? 'clutch' : 'formation';
    }
}

export function setOffspringCount(who, count) {
    const preset = activePreset();
    const range = preset.offspringRange || { min: 1, max: 1 };
    const character = getCharacterData(who);
    if (!character.pregnancy) return;
    const n = Math.max(range.min, Math.min(range.max, parseInt(count) || range.min));
    character.pregnancy.offspringCount = n;
}

// ── Дети (общий список на семью, не привязан к конкретному носителю) ──
export function getChildren() {
    const chat = getChatData();
    if (!Array.isArray(chat.children)) chat.children = [];
    return chat.children;
}

export function getGrownChildren() {
    const chat = getChatData();
    if (!Array.isArray(chat.grownChildren)) chat.grownChildren = [];
    return chat.grownChildren;
}

function makeChildId() {
    return `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

// Роды/кладка: переносит текущую беременность носителя `who` в список детей
// как N отдельных записей (N = offspringCount), затем сбрасывает беременность.
export function completeBirth(who) {
    const preset = activePreset();
    const character = getCharacterData(who);
    const pregnancy = character.pregnancy;
    if (!pregnancy?.isPregnant) return [];

    const children = getChildren();
    const created = [];
    for (let i = 0; i < pregnancy.offspringCount; i++) {
        const child = {
            id: makeChildId(),
            name: '',
            ageWeeks: 0,
            parentWho: who,
            universe: preset.id,
            notes: '',
        };
        children.push(child);
        created.push(child);
    }

    character.pregnancy = cloneDefault(defaultPregnancyData);
    return created;
}

export function updateChildField(id, field, value) {
    const child = getChildren().find(c => c.id === id);
    if (child) child[field] = value;
}

export function archiveChild(id) {
    const children = getChildren();
    const idx = children.findIndex(c => c.id === id);
    if (idx === -1) return;
    const [child] = children.splice(idx, 1);
    getGrownChildren().push(child);
}

export function deleteChild(id) {
    const chat = getChatData();
    if (Array.isArray(chat.children)) chat.children = chat.children.filter(c => c.id !== id);
    if (Array.isArray(chat.grownChildren)) chat.grownChildren = chat.grownChildren.filter(c => c.id !== id);
}
