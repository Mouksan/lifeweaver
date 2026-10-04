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
         applyChildTraits, setTimeOfDay, setRpTime, createUndoCheckpoint, applyStatus,
         clearResurrectionBlocks, getClutches, setCycleDay, setCycleStart } from './state.js';
import { scanMessage } from './scanner.js';
import { composeScanText, snapshotOfChatData, clearRegenState, HISTORY_CAP,
         recordedRollsOf, stampVariant, variantSeedBase } from './automation.js';
import { seededRandom } from './health.js';

// Текст сообщения для скана — тем же способом, что и живой скан: проза плюс
// теги ИМЕННО показанного варианта. Раньше брался сырой исходник из extra,
// а он мог остаться от другого свайпа — и ретроскан читал чужие теги.
function scanTextOf(msg) {
    return composeScanText(msg).text;
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
            if (scanMessage(scanTextOf(msg))) tagged++;
        }
        return { total: chat.length, tagged };
    } catch (e) {
        return { total: 0, tagged: 0 };
    }
}

// Полный проход. Возвращает статистику по найденному.
// options.cycleStart = { user?: число, char?: число } — день цикла на начало
// чата. Без него цикл продолжился бы от ТЕКУЩЕГО дня, и все дни истории
// легли бы сверху второй раз.
//
// Зачатие: если исход броска для варианта сообщения записан — воспроизводим.
// Если нет (сообщения до 2.9) — бросаем кубик, посеянный от чата, номера
// сообщения и свайпа: результат может не совпасть с живым, зато одинаков при
// каждом ретроскане. Такие переброски перечисляются в stats.rerolled, а их
// исход записывается на сообщение — дальше он воспроизводится.
export function scanFullHistory(options = {}) {
    const stats = { processed: 0, days: 0, conceptions: 0, clutches: 0, births: 0, losses: 0, tests: 0, traits: 0, rerolled: [] };
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
            // Стартовый день цикла: от него пойдут дни истории
            // Не передан явно — берём запомненный старт чата (если есть)
            const start = options.cycleStart?.[who] ?? c.cycleStartDay;
            if (Number.isInteger(start) && c.designation !== 'beta') {
                setCycleStart(who, start);
                setCycleDay(who, start);
            }
        }
        const toStamp = [];

        // История позиций пересобирается по ходу прохода: старая описывает
        // состояние ДО ретроскана, и свайп откатил бы к нему — то есть
        // вернул бы всё, что ретроскан исправил. Пишем только хвост чата:
        // свайпнуть можно лишь последнее сообщение, глубже история не нужна.
        const recorded = [];
        const recordFrom = Math.max(0, chat.length - HISTORY_CAP - 1);
        // Заодно ведём журнал «какой вариант сообщения сейчас применён» —
        // иначе первый же скан после ретроскана счёл бы сообщение незнакомым.
        const recordPosition = (i) => {
            const m = chat[i];
            chatData._lastApplied = {
                pos: i + 1,
                swipe: typeof m?.swipe_id === 'number' ? m.swipe_id : null,
                sig: composeScanText(m).sig,
            };
            if (i >= recordFrom) recorded.push({ pos: i + 1, state: snapshotOfChatData() });
        };

        for (let i = 0; i < chat.length; i++) {
            const msg = chat[i];
            if (!msg?.mes || msg.is_system) { recordPosition(i); continue; }
            const result = scanMessage(scanTextOf(msg));
            if (!result) { recordPosition(i); continue; }
            stats.processed++;

            if (result.daysPassed > 0) {
                advanceTimeByDays(result.daysPassed);
                stats.days += result.daysPassed;
            }
            if (result.status) applyStatus(result.status);
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
                    const recorded = recordedRollsOf(msg)[who] || null;
                    const seedBase = variantSeedBase(msg, i);
                    let outcome = null;
                    const res = applyConception(who, {
                        forced: recorded,
                        rnd: seededRandom(`${seedBase}|${who}|conception`),
                        // Тем же зерном, что живой скан: те же малыши
                        detailRnd: seededRandom(`${seedBase}|${who}|details`),
                        onRoll: (o) => { outcome = o; },
                    });
                    if (res === true) stats.conceptions++;
                    if (!recorded && outcome) {
                        stats.rerolled.push({ mes: i, who, ...outcome });
                        toStamp.push({ msg, who, outcome });
                    }
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
            recordPosition(i);
        }

        // Возвращаем сохранённое — и в итоговое состояние, и в каждую
        // записанную позицию истории, чтобы они не расходились.
        const restoreKept = (target) => {
            target.universe = savedUniverse;
            for (const who of ['user', 'char']) {
                const c = target.characters?.[who];
                if (!c) continue;
                c.looks = structuredClone(savedLooks[who]);
                Object.assign(c, structuredClone(savedSettingsPerChar[who]));
            }
            // Выросшие дети не пересоздаются тегами — возвращаем как были
            target.grownChildren = structuredClone(savedGrown);
            // Если проход не нашёл ни одних родов, вернём детей, что были до него:
            // скорее всего они добавлены руками, и терять их нельзя.
            if (stats.births === 0 && savedManualChildren.length > 0) {
                target.children = structuredClone(savedManualChildren);
            }
        };
        restoreKept(chatData);
        for (const r of recorded) restoreKept(r.state);
        if (savedUndo) chatData._undo = savedUndo;
        chatData._history = recorded.slice(-HISTORY_CAP);
        // Переброшенные исходы записываем на сообщения — следующий ретроскан
        // и пересчёт при листании их воспроизведут, а не бросят снова
        for (const { msg, who, outcome } of toStamp) {
            stampVariant(msg, { ...recordedRollsOf(msg), [who]: outcome });
        }
        if (toStamp.length) {
            try { ctx.saveChat?.(); } catch (e) { /* ignore */ }
        }
    } finally {
        s.showNotifications = oldNotify;
        // Снимки в памяти описывают состояние до ретроскана — выбрасываем
        clearRegenState();
    }

    return stats;
}
