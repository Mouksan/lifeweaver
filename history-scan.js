// ═══════════════════════════════════════════
// HISTORY-SCAN — ретроспективный проход по всей истории чата
// ═══════════════════════════════════════════
//
// Портировано со scanFullHistory вдохновителя. Их предосторожности, которые
// берём целиком, потому что каждая закрывает реальную дыру:
//   • точка отмены ПЕРЕД сканом — операция разрушительная;
//   • уведомления глушатся на время прохода, иначе прилетит два десятка
//     тостов подряд;
//   • блоки анти-воскрешения снимаются: они рассчитаны на живую переписку,
//     а при проходе по истории только мешают;
//   • состояние сбрасывается, но то, что теги НЕ восстановят (выросшие дети,
//     дети, добавленные руками, внешность родителей), сохраняется и
//     возвращается на место.
//
// Наше: за один проход собираются и время (DAYS_PASSED), и все события —
// зачатие, кладка, вылупление, потери, тесты, черты детей. Порядок сообщений
// и есть порядок событий, поэтому состояние на выходе соответствует финалу
// истории.

import { getSettings, getChatData, getChildren, getGrownChildren, getCharacterData,
         advanceTimeByDays, applyConception, applyLayClutch, applyBirth,
         applyMiscarriage, applyAbortion, setPregnancyKnown, revealOffspringSex,
         applyChildTraits, setTimeOfDay, setRpTime, createUndoCheckpoint,
         clearResurrectionBlocks, getClutches } from './state.js';
import { scanMessage, stripThink } from './scanner.js';

function rawTextOf(msg) {
    return (msg?.extra && msg.extra.lifeweaverRaw) || msg?.mes || '';
}

// Оценка: сколько сообщений содержит наши теги. Нужна, чтобы честно
// предупредить, если сканировать по сути нечего.
export function estimateHistory() {
    try {
        const ctx = typeof SillyTavern?.getContext === 'function' ? SillyTavern.getContext() : null;
        const chat = ctx?.chat || [];
        let tagged = 0;
        for (const msg of chat) {
            if (!msg?.mes || msg.is_system) continue;
            if (scanMessage(stripThink(rawTextOf(msg)))) tagged++;
        }
        return { total: chat.length, tagged };
    } catch (e) {
        return { total: 0, tagged: 0 };
    }
}

// Полный проход. Возвращает статистику по найденному.
export function scanFullHistory() {
    const stats = { processed: 0, days: 0, conceptions: 0, clutches: 0, births: 0, losses: 0, tests: 0, traits: 0 };
    const ctx = typeof SillyTavern?.getContext === 'function' ? SillyTavern.getContext() : null;
    const chat = ctx?.chat || [];
    if (chat.length === 0) return stats;

    const s = getSettings();
    createUndoCheckpoint('Пересканирование истории чата');

    // Сохраняем то, что теги восстановить не смогут
    const chatData = getChatData();
    const savedGrown = structuredClone(getGrownChildren());
    // Дети, добавленные руками (без родов в этом чате) — у них нет тега,
    // из которого они бы возродились.
    const savedManualChildren = structuredClone(getChildren());
    const savedLooks = {
        user: structuredClone(getCharacterData('user').looks || {}),
        char: structuredClone(getCharacterData('char').looks || {}),
    };
    const savedSettingsPerChar = {};
    for (const who of ['user', 'char']) {
        const c = getCharacterData(who);
        savedSettingsPerChar[who] = {
            designation: c.designation,
            canCarry: c.canCarry,
            contraception: c.contraception,
        };
    }
    const savedUniverse = chatData.universe;
    const savedUndo = chatData._undo;

    // Глушим уведомления и снимаем блоки на время прохода
    const oldNotify = s.showNotifications;
    s.showNotifications = false;
    clearResurrectionBlocks('user');
    clearResurrectionBlocks('char');

    try {
        // Сброс отслеживаемого состояния (настройки персонажей сохраняем)
        chatData.rpDay = 0;
        chatData._ageDayRemainder = 0;
        chatData.clutches = [];
        chatData.children = [];
        chatData.lastLoss = { user: null, char: null };
        for (const who of ['user', 'char']) {
            const c = getCharacterData(who);
            c.pregnancy = {
                isPregnant: false, weeks: 0, stage: 'formation', offspringCount: 1,
                pregnancyKnown: false, offspringSex: [], sexRevealed: false,
                _dayRemainder: 0, _plannedComplications: [], complications: [],
                healthStatus: 'normal', lastTestResult: null, lastTestRpDay: null,
            };
            c.postpartum = null;
        }

        for (const msg of chat) {
            if (!msg?.mes || msg.is_system) continue;
            const result = scanMessage(stripThink(rawTextOf(msg)));
            if (!result) continue;
            stats.processed++;

            if (result.daysPassed > 0) {
                advanceTimeByDays(result.daysPassed);
                stats.days += result.daysPassed;
            }
            if (result.timeOfDay) {
                if (result.timeOfDay.rpTime) setRpTime(result.timeOfDay.rpTime);
                else if (result.timeOfDay.bucket) setTimeOfDay(result.timeOfDay.bucket);
            }

            for (const who of ['user', 'char']) {
                const isChar = who === 'char';
                if (isChar ? result.charAbortion : result.abortion) {
                    if (applyAbortion(who)) stats.losses++;
                    continue;
                }
                if (isChar ? result.charMiscarriage : result.miscarriage) {
                    if (applyMiscarriage(who)) stats.losses++;
                    continue;
                }
                if (isChar ? result.charConception : result.conception) {
                    if (applyConception(who)) stats.conceptions++;
                }
                if (isChar ? result.charSexRevealed : result.sexRevealed) {
                    revealOffspringSex(who, result.revealedSexes);
                }
                if (isChar ? result.charLayClutch : result.layClutch) {
                    if (applyLayClutch(who)) stats.clutches++;
                }
                if (isChar ? result.charBirth : result.birth) {
                    const traits = isChar ? result.charBabyTraits : result.babyTraits;
                    const created = applyBirth(who, traits);
                    if (created && created.length) stats.births += created.length;
                }
                if (isChar ? result.charKnown : result.known) setPregnancyKnown(who, true);
                if (isChar ? result.charTest : result.test) stats.tests++;
            }

            if (result.childTraits) {
                stats.traits += applyChildTraits(result.childTraits) > 0 ? 1 : 0;
            }

            // Блоки анти-воскрешения могли выставиться внутри прохода после
            // потери — при чтении истории они не нужны, снимаем сразу.
            clearResurrectionBlocks('user');
            clearResurrectionBlocks('char');
        }

        // Возвращаем сохранённое
        chatData.universe = savedUniverse;
        if (savedUndo) chatData._undo = savedUndo;
        for (const who of ['user', 'char']) {
            const c = getCharacterData(who);
            c.looks = savedLooks[who];
            Object.assign(c, savedSettingsPerChar[who]);
        }
        // Выросшие дети не пересоздаются тегами — возвращаем как были
        chatData.grownChildren = savedGrown;
        // Если проход не нашёл ни одних родов, вернём детей, что были до него:
        // скорее всего они добавлены руками, и терять их нельзя.
        if (stats.births === 0 && savedManualChildren.length > 0) {
            chatData.children = savedManualChildren;
        }
    } finally {
        s.showNotifications = oldNotify;
    }

    return stats;
}
