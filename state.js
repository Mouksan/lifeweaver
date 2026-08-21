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
import { extensionName, defaultSettings, defaultChatData, defaultCharacterData, defaultPregnancyData, getPreset, getTotalWeeks, rollOffspringCount, CONTRACEPTION_TYPES, buildCustomPreset } from './config.js';

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

export function getActivePreset() {
    const universeId = getActiveUniverse();
    if (universeId === 'custom') {
        const cp = getSettings().customPreset;
        if (cp && cp.isConfigured) return buildCustomPreset(cp);
        return getPreset('mpreg'); // защитный фолбэк — сюда не должны попасть, если UI не даёт выбрать невключённый кастом
    }
    return getPreset(universeId);
}

export function startPregnancy(who) {
    const preset = getActivePreset();
    const range = preset.offspringRange || { min: 1, max: 1 };
    const count = rollOffspringCount(range);
    const character = getCharacterData(who);
    character.pregnancy = { isPregnant: true, weeks: 0, stage: 'formation', offspringCount: count };
}

export function endPregnancy(who) {
    getCharacterData(who).pregnancy = cloneDefault(defaultPregnancyData);
}

export function setPregnancyWeeks(who, weeks) {
    const preset = getActivePreset();
    const character = getCharacterData(who);
    const pregnancy = character.pregnancy;
    if (!pregnancy?.isPregnant) return;

    const maxWeeks = currentStageMaxWeeks(preset, pregnancy);
    pregnancy.weeks = Math.max(0, Math.min(maxWeeks, parseInt(weeks) || 0));
}

// Максимум недель ДЛЯ ТЕКУЩЕЙ ФАЗЫ (а не суммарно) — у staged это либо
// длительность формирования, либо длительность кладки/инкубации, у live — общий срок.
export function currentStageMaxWeeks(preset, pregnancy) {
    if (preset.gestationType === 'staged') {
        return pregnancy.stage === 'clutch' ? preset.stages.second.weeks : preset.stages.first.weeks;
    }
    return getTotalWeeks(preset, getSettings().pregnancyDuration);
}

// Кладка/нерест — явное событие завершения первой фазы (формирования).
// Само по себе НЕ переходит в роды: обнуляет счётчик и начинает отсчёт
// инкубации отдельно, только после того как игрок сам это подтвердил.
export function advanceToClutch(who) {
    const preset = getActivePreset();
    if (preset.gestationType !== 'staged') return;
    const character = getCharacterData(who);
    const pregnancy = character.pregnancy;
    if (!pregnancy?.isPregnant || pregnancy.stage !== 'formation') return;
    if (pregnancy.weeks < preset.stages.first.weeks) return;
    pregnancy.stage = 'clutch';
    pregnancy.weeks = 0;
}

export function setOffspringCount(who, count) {
    const preset = getActivePreset();
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
    const preset = getActivePreset();
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

export function restoreChild(id) {
    const grown = getGrownChildren();
    const idx = grown.findIndex(c => c.id === id);
    if (idx === -1) return;
    const [child] = grown.splice(idx, 1);
    getChildren().push(child);
}

export function deleteChild(id) {
    const chat = getChatData();
    if (Array.isArray(chat.children)) chat.children = chat.children.filter(c => c.id !== id);
    if (Array.isArray(chat.grownChildren)) chat.grownChildren = chat.grownChildren.filter(c => c.id !== id);
}

// ── Настройки ──
export function setContraception(who, typeId) {
    const valid = CONTRACEPTION_TYPES[typeId] ? typeId : 'none';
    getCharacterData(who).contraception = valid;
}

export function setShowNotifications(value) {
    getSettings().showNotifications = !!value;
}

export function setHiddenPregnancy(value) {
    getSettings().hiddenPregnancy = !!value;
}

// Общий сеттер для числовых глобальных настроек (длины циклов, длительность
// беременности) — используется одинаково для всех пяти полей в разделе "Настройки".
export function setNumericSetting(key, value, min = 1) {
    const s = getSettings();
    const n = Math.max(min, parseInt(value) || s[key] || min);
    s[key] = n;
    return n;
}

// ── Кастомная вселенная (5-й слот) ──
export function getCustomPresetDraft() {
    return cloneDefault(getSettings().customPreset);
}

// Сохраняет черновик из формы конструктора как активный кастомный пресет.
// Валидация чисел (min 1 и т.п.) — внутри buildCustomPreset при чтении,
// тут просто нормализуем структуру перед записью.
export function saveCustomPreset(draft) {
    const s = getSettings();
    s.customPreset = {
        isConfigured: true,
        label: (draft.label || 'Кастом').trim() || 'Кастом',
        sublabel: (draft.sublabel || '').trim(),
        color: draft.color || '#5a5850',
        cycleSystem: draft.cycleSystem === 'abo' ? 'abo' : 'none',
        gestationType: draft.gestationType === 'staged' ? 'staged' : 'live',
        pregnancyDuration: Math.max(1, parseInt(draft.pregnancyDuration) || 40),
        stages: {
            first: {
                label: (draft.stages?.first?.label || 'Формирование').trim() || 'Формирование',
                weeks: Math.max(1, parseInt(draft.stages?.first?.weeks) || 20),
            },
            second: {
                label: (draft.stages?.second?.label || 'Кладка и инкубация').trim() || 'Кладка и инкубация',
                weeks: Math.max(1, parseInt(draft.stages?.second?.weeks) || 20),
            },
        },
        offspringRange: {
            min: Math.max(1, parseInt(draft.offspringRange?.min) || 1),
            max: Math.max(1, parseInt(draft.offspringRange?.max) || 1, parseInt(draft.offspringRange?.min) || 1),
        },
        offspringLabel: (draft.offspringLabel || 'Детей').trim() || 'Детей',
    };
}

export function disableCustomPreset() {
    const s = getSettings();
    if (s.customPreset) s.customPreset.isConfigured = false;
    if (getActiveUniverse() === 'custom') setActiveUniverse('mpreg');
}

// ═══════════════════════════════════════════
// АВТОМАТИКА — продвижение времени и применение событий от сканера.
// Всё ниже переиспользует уже существующие ручные функции (startPregnancy,
// advanceToClutch, completeBirth, endPregnancy, setCycleDay, setPregnancyWeeks) —
// автоматика просто вызывает их за игрока с дополнительными защитными проверками.
// ═══════════════════════════════════════════

export function getRpDay() {
    return getChatData().rpDay || 0;
}

// Ручная коррекция счётчика дней — на случай, если автоматика накрутила
// лишнего (старые чаты до дедупа, эксперименты со скипами).
export function setRpDay(value) {
    const chat = getChatData();
    chat.rpDay = Math.max(0, parseInt(value) || 0);
    return chat.rpDay;
}

export function setPregnancyKnown(who, value) {
    const character = getCharacterData(who);
    if (character.pregnancy) character.pregnancy.pregnancyKnown = !!value;
}

// Продвигает день цикла (течка/гон) носителя на N дней. У беты в нашей
// модели цикла нет вообще — двигать нечего.
function advanceCycleDayByDays(who, days) {
    if (days <= 0) return;
    const character = getCharacterData(who);
    if (character.designation === 'beta') return;
    const cfg = getCycleSettings();
    const maxDay = character.designation === 'alpha' ? cfg.rutCycleLength : cfg.heatCycleLength;
    const newDay = ((character.cycleDay - 1 + days) % maxDay) + 1;
    setCycleDay(who, newDay);
}

// Продвигает беременность носителя на N дней. Копит остаток < 7 дней в
// pregnancy._dayRemainder, чтобы не терять точность между вызовами —
// неделя добавляется только когда накопилось 7+ дней.
function advancePregnancyByDays(who, days) {
    if (days <= 0) return;
    const character = getCharacterData(who);
    const pregnancy = character.pregnancy;
    if (!pregnancy?.isPregnant) return;

    const totalDays = (pregnancy._dayRemainder || 0) + days;
    const addWeeks = Math.floor(totalDays / 7);
    pregnancy._dayRemainder = totalDays % 7;
    if (addWeeks > 0) {
        setPregnancyWeeks(who, pregnancy.weeks + addWeeks); // переиспользует существующий клэмп по текущей фазе
    }
}

// Взросление детей — общий счётчик на чат (дети общие на семью), копится
// так же, как в pregnancy._dayRemainder, только на уровне chatData.
function advanceChildrenAgeByDays(days) {
    if (days <= 0) return;
    const children = getChildren();
    if (children.length === 0) return;
    const chat = getChatData();
    const totalDays = (chat._ageDayRemainder || 0) + days;
    const addWeeks = Math.floor(totalDays / 7);
    chat._ageDayRemainder = totalDays % 7;
    if (addWeeks > 0) {
        for (const child of children) child.ageWeeks = (child.ageWeeks || 0) + addWeeks;
    }
}

// Точка входа: сколько дней прошло в истории за этот ответ — двигает разом
// день чата, циклы обоих персонажей, их беременности и возраст детей.
export function advanceTimeByDays(days) {
    if (!days || days <= 0) return;
    const chat = getChatData();
    chat.rpDay = (chat.rpDay || 0) + days;
    advanceCycleDayByDays('user', days);
    advanceCycleDayByDays('char', days);
    advancePregnancyByDays('user', days);
    advancePregnancyByDays('char', days);
    advanceChildrenAgeByDays(days);
}

// ── Применение событий сканера — с защитными проверками поверх ручных функций ──

// Зачатие: только если персонаж явно отмечен носителем и ещё не беременен.
// Тег без этого флага молча игнорируется — это и есть смысл явного флага
// "может забеременеть", он действует одинаково что для ручной кнопки, что для автоматики.
export function applyConception(who) {
    const character = getCharacterData(who);
    if (!character.canCarry) return false;
    if (character.pregnancy?.isPregnant) return false;
    // После недавней потери зачатие заблокировано на несколько сообщений —
    // иначе модель «воскрешает» беременность из старого контекста.
    if (isBlocked('conception', who)) return false;
    startPregnancy(who);
    return true;
}

// Кладка/нерест: только для staged-вселенных и только из фазы формирования.
// Срок НЕ проверяем (как вдохновитель с родами) — кладка может случиться
// раньше по сюжету, а главное: событие и достижение срока приходят в одном
// сообщении, так что жёсткая проверка отбрасывала бы легитимный тег.
export function applyLayClutch(who) {
    const preset = getActivePreset();
    if (preset.gestationType !== 'staged') return false;
    const character = getCharacterData(who);
    const pregnancy = character.pregnancy;
    if (!pregnancy?.isPregnant || pregnancy.stage !== 'formation') return false;
    pregnancy.stage = 'clutch';
    pregnancy.weeks = 0;
    pregnancy._dayRemainder = 0;
    return true;
}

// Роды/вылупление: доверяем нарративу — если модель говорит, что потомство
// вышло, значит вышло, независимо от срока (преждевременные роды, ускоренное
// РП, ручная беременность на нестандартном сроке). Философия вдохновителя:
// расширение должно ловить роды независимо от срока.
export function applyBirth(who) {
    const character = getCharacterData(who);
    const pregnancy = character.pregnancy;
    if (!pregnancy?.isPregnant) return null;
    if (isBlocked('birth', who)) return null;
    return completeBirth(who);
}

// ── Прерывание беременности (выкидыш / аборт / ручной сброс) ──
// Портировано у вдохновителя вместе с анти-воскрешением: после потери модель
// имеет свойство «вернуть» беременность из старого контекста («ты же была на
// 16 неделе…»), поэтому теги зачатия и родов игнорируются несколько сообщений.
const CONCEPTION_BLOCK_MESSAGES = 6;
const BIRTH_BLOCK_MESSAGES = 10;

function currentChatLength() {
    try {
        const ctx = typeof SillyTavern?.getContext === 'function' ? SillyTavern.getContext() : null;
        return ctx?.chat?.length || 0;
    } catch (e) {
        return 0;
    }
}

export function isBlocked(kind, who) {
    const chat = getChatData();
    const map = kind === 'birth' ? chat._birthBlockedUntil : chat._conceptionBlockedUntil;
    if (!map) return false;
    return currentChatLength() <= (map[who] || 0);
}

// reason: 'miscarriage' | 'abortion' | 'manual'
export function terminatePregnancy(who, reason = 'manual') {
    const character = getCharacterData(who);
    const pregnancy = character.pregnancy;
    if (!pregnancy?.isPregnant) return false;

    const chat = getChatData();
    const preset = getActivePreset();

    // Запоминаем, что именно потеряли — для UI и промпта
    if (!chat.lastLoss) chat.lastLoss = { user: null, char: null };
    chat.lastLoss[who] = {
        reason,
        stage: preset.gestationType === 'staged' ? pregnancy.stage : 'live',
        weeks: pregnancy.weeks,
        offspringCount: pregnancy.offspringCount,
        offspringLabel: preset.offspringLabel,
        rpDay: chat.rpDay || 0,
    };

    character.pregnancy = cloneDefault(defaultPregnancyData);

    // Анти-воскрешение
    const len = currentChatLength();
    if (!chat._conceptionBlockedUntil) chat._conceptionBlockedUntil = { user: 0, char: 0 };
    if (!chat._birthBlockedUntil) chat._birthBlockedUntil = { user: 0, char: 0 };
    chat._conceptionBlockedUntil[who] = len + CONCEPTION_BLOCK_MESSAGES;
    chat._birthBlockedUntil[who] = len + BIRTH_BLOCK_MESSAGES;

    return true;
}

export function getLastLoss(who) {
    return getChatData().lastLoss?.[who] || null;
}

export function clearLastLoss(who) {
    const chat = getChatData();
    if (chat.lastLoss) chat.lastLoss[who] = null;
}

export function applyMiscarriage(who) {
    return terminatePregnancy(who, 'miscarriage');
}

export function applyAbortion(who) {
    return terminatePregnancy(who, 'abortion');
}
