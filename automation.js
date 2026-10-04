// ═══════════════════════════════════════════
// AUTOMATION — подписка на события ST + применение результатов скана
// ═══════════════════════════════════════════
//
// Логика портирована с message-handler.js вдохновителя: история снапшотов
// по позициям, откат при удалении, stripThink перед сканом, исходник тегов
// в msg.extra, подчистка отрисованного DOM.
//
// ── Главное правило (переделано в 2.7, баг со стаканием дней на свайпах) ──
// Состояние ПОСЛЕ сообщения на позиции P = состояние ДО него + теги ЭТОГО
// варианта сообщения. Ровно один раз, сколько бы событий Таверна ни прислала.
//
// Как это обеспечивается:
//  • Теги, снятые с сообщения, хранятся в msg.extra вместе с номером свайпа,
//    к которому они относятся (lifeweaverTags + lifeweaverSwipe). Таверна при
//    новом свайпе может протащить extra от прошлого варианта — чужие теги по
//    номеру свайпа отсекаются и в скан больше не попадают.
//  • На сообщении стоит отметка «применено» (lifeweaverApplied: свайп +
//    подпись тегов). Она лежит в файле чата и переживает перезагрузку, поэтому
//    повторные события (MESSAGE_RECEIVED + GENERATION_ENDED, чужие тихие
//    генерации, F5) больше ничего не применяют второй раз.
//  • Если вариант сообщения сменился (свайп, реген, continue с новыми тегами),
//    состояние сначала откатывается к «до» — и берётся оно из сохранённой
//    истории позиций, а не из памяти вкладки. Снимок в памяти остался только
//    запасным вариантом.
//  • (2.8) В данных чата лежит журнал _lastApplied: какая позиция, какой
//    свайп и какие теги сейчас отражены в состоянии. Перелистнула к другому
//    свайпу — журнал не совпал, состояние пересчитывается под показанный
//    вариант. Отметка на самом сообщении теперь нужна только для чатов,
//    обработанных до появления журнала.

import { eventSource, event_types, saveSettingsDebounced } from '../../../../script.js';
import {
    getSettings, getChatData, getCurrentChatId,
    advanceTimeByDays, applyConception, applyLayClutch, applyBirth,
    applyMiscarriage, applyAbortion, setPregnancyKnown, revealOffspringSex, getActivePreset,
    getCharacterData, isBlocked, applyChildTraits, setTimeOfDay, setRpTime, autoArchiveGrownChildren, applyStatus,
    migrateLegacyClutch, getClutches, takeTest, doctorVisit, createUndoCheckpoint, takeMilestoneEvents,
    resolveWhoByName,
} from './state.js';
import { scanMessage, stripOurTags, hasOurTags, stripThink, describeScan, setWhoResolver } from './scanner.js';
import { updatePromptInjection } from './prompts.js';
import { showNotification, showBirthDialog, showGraduationDialog } from './notifications.js';
import { TEST_LABELS } from './health.js';
import { renderInfoblock } from './infoblock.js';

export const HISTORY_CAP = 25;
// Печатается в консоль при загрузке — видно, какая версия реально работает
// (браузер любит держать старый файл в кэше).
const AUTOMATION_BUILD = '2.8.1';

// ── Состояние обработки (живёт в памяти, не в настройках) ──
let _isRegeneration = false;
// Идёт ли сейчас основная генерация (не тихая чужая). Пока идёт — листание и
// контрольные проверки не трогают состояние: показанный вариант ещё пишется.
// Метка времени, а не флаг — чтобы не залипнуть, если Таверна не пришлёт конец.
let _mainGenSince = 0;
const MAIN_GEN_STALE_MS = 15 * 60 * 1000;
function mainGenActive() {
    return _mainGenSince > 0 && Date.now() - _mainGenSince < MAIN_GEN_STALE_MS;
}
// Запасной снимок «до последнего обработанного сообщения» — на случай, если
// в сохранённой истории нужной позиции почему-то нет.
let _preRegenSnapshot = null;
let _snapshotChatId = null;
let _snapshotPos = null;
// Позиции, по которым уже предупреждали «откатиться некуда» — тост не чаще
// одного раза на позицию, сколько ни свайпай.
const _warnedPositions = new Set();

// Быстрый хэш текста
function simpleHash(str) {
    let h = 0;
    for (let i = 0; i < str.length; i++) {
        h = ((h << 5) - h + str.charCodeAt(i)) | 0;
    }
    return h;
}

function getStContext() {
    return typeof SillyTavern?.getContext === 'function' ? SillyTavern.getContext() : null;
}

// ═══════════════════════════════════════════
// ТЕКСТ ДЛЯ СКАНА: проза + теги ЭТОГО варианта
// ═══════════════════════════════════════════

const COMMENT_RE = /<!--[\s\S]*?-->/g;

// Наши теги из текста — целыми HTML-комментариями, по порядку, без дублей
function ourTagComments(text) {
    const all = String(text || '').match(COMMENT_RE) || [];
    return [...new Set(all.filter(c => hasOurTags(c)).map(c => c.trim()))];
}

function swipeIdOf(msg) {
    return typeof msg?.swipe_id === 'number' ? msg.swipe_id : null;
}

// Видимый текст без наших тегов — так же, как его чистит stampMessage
function cleanText(text) {
    return stripOurTags(text || '').replace(/\n{3,}/g, '\n\n').trimEnd();
}

// Старый формат (до 2.7): в extra лежал только сырой текст, без номера свайпа.
// Верим ему, если видимый текст начинается с него же без тегов. Если он
// совпадает с ДРУГИМ свайпом этого сообщения — это исходник чужого варианта,
// протащенный Таверной, и в скан он не идёт. Если не совпадает ни с чем
// (текст поправило другое расширение) — улик против нет, верим.
function legacyRawBelongsHere(msg, raw) {
    const clean = cleanText(raw);
    const mes = msg.mes || '';
    const swipes = Array.isArray(msg.swipes) ? msg.swipes : [];
    const cur = swipeIdOf(msg);
    if (!clean) return swipes.length <= 1;
    if (mes.startsWith(clean)) return true;
    const otherMatches = swipes.some((s, i) => i !== cur && typeof s === 'string' && s.startsWith(clean));
    return !otherMatches;
}

// Наши данные, относящиеся ИМЕННО к показанному свайпу. Сначала смотрим
// msg.extra (Таверна при перелистывании подставляет туда extra свайпа), потом
// swipe_info этого свайпа — на случай, если подстановки не было.
// null — данных этого варианта нет (новый свайп или чат старой версии).
function variantExtraOf(msg) {
    const swipe = swipeIdOf(msg);
    const candidates = [msg?.extra];
    if (swipe !== null && Array.isArray(msg?.swipe_info)) candidates.push(msg.swipe_info[swipe]?.extra);
    for (const ex of candidates) {
        if (ex && Array.isArray(ex.lifeweaverTags) && (ex.lifeweaverSwipe ?? null) === swipe) return ex;
    }
    return null;
}

// Теги, снятые с этого же варианта сообщения при прошлом скане
function storedTagsOf(msg) {
    const ve = variantExtraOf(msg);
    if (ve) return ve.lifeweaverTags.slice();
    const ex = msg?.extra;
    if (ex && !Array.isArray(ex.lifeweaverTags) && typeof ex.lifeweaverRaw === 'string' && ex.lifeweaverRaw
        && legacyRawBelongsHere(msg, ex.lifeweaverRaw)) {
        return ourTagComments(stripThink(ex.lifeweaverRaw));
    }
    return [];
}

// Собирает текст для скана. Сохранённые теги идут ПЕРВЫМИ: у одиночных тегов
// вроде DAYS_PASSED побеждает первый, и continue, дописавший свежий
// «DAYS_PASSED:0», не перебьёт исходное число дней.
// Экспортируется — тем же способом читает историю ретроскан.
export function composeScanText(msg) {
    const visible = stripThink(msg?.mes || '');
    const tags = [...new Set([...storedTagsOf(msg), ...ourTagComments(visible)])];
    const prose = stripOurTags(visible);
    const text = tags.length ? `${prose}\n${tags.join('\n')}` : prose;
    return { text, tags, sig: simpleHash(tags.join('\n')) };
}

// Записывает на сообщение (и в его свайп): какие теги сняты, с какого
// варианта, что они применены. Убирает теги из видимого текста.
function stampMessage(msg, swipe, tags, sig) {
    if (!msg) return;
    msg.extra = msg.extra || {};
    const clean = cleanText(msg.mes);
    const fields = {
        lifeweaverTags: tags.slice(),
        lifeweaverSwipe: swipe,
        lifeweaverApplied: { swipe, sig },
    };
    // Сырой текст — для ретроскана и совместимости со старыми версиями
    const raw = tags.length ? `${clean}\n${tags.join('\n')}` : null;

    const write = (extra) => {
        Object.assign(extra, structuredClone(fields));
        if (raw) extra.lifeweaverRaw = raw;
        else delete extra.lifeweaverRaw; // иначе остался бы исходник чужого варианта
    };
    write(msg.extra);
    // Тот же набор — в swipe_info этого свайпа: при перелистывании Таверна
    // восстанавливает extra оттуда, и у каждого варианта будут свои теги.
    if (swipe !== null && Array.isArray(msg.swipe_info) && msg.swipe_info[swipe]) {
        const si = msg.swipe_info[swipe];
        if (!si.extra || typeof si.extra !== 'object') si.extra = {};
        write(si.extra);
    }

    if (clean !== msg.mes) {
        msg.mes = clean;
        if (Array.isArray(msg.swipes) && swipe !== null && msg.swipes[swipe] !== undefined) {
            msg.swipes[swipe] = clean;
        }
    }
}

const OUR_FIELDS = ['lifeweaverTags', 'lifeweaverSwipe', 'lifeweaverApplied', 'lifeweaverRaw'];

function scrubOurFields(extra) {
    if (!extra || typeof extra !== 'object') return;
    for (const k of OUR_FIELDS) delete extra[k];
}

function setVariantIndex(extra, i) {
    if (!extra || !Array.isArray(extra.lifeweaverTags)) return;
    extra.lifeweaverSwipe = i;
    if (extra.lifeweaverApplied) extra.lifeweaverApplied.swipe = i;
}

// После удаления свайпа: данные каждого варианта переезжают вместе с ним,
// а записанный в них номер — нет. Переписываем номера по новым местам и
// сдвигаем журнал «что применено».
function reindexAfterSwipeDeleted(data) {
    const ctx = getStContext();
    const chat = ctx?.chat;
    if (!chat?.length) return;
    const messageId = Number(data?.messageId ?? chat.length - 1);
    const removed = Number(data?.swipeId);
    if (messageId !== chat.length - 1 || !Number.isInteger(removed)) return;
    const m = chat[messageId];

    if (Array.isArray(m.swipe_info)) m.swipe_info.forEach((si, i) => setVariantIndex(si?.extra, i));
    // msg.extra пока ещё от показанного до удаления варианта
    const shown = m.extra?.lifeweaverSwipe;
    if (typeof shown === 'number') {
        if (shown === removed) scrubOurFields(m.extra);
        else if (shown > removed) setVariantIndex(m.extra, shown - 1);
    }

    const rec = getChatData()._lastApplied;
    if (rec && rec.pos === chat.length && typeof rec.swipe === 'number') {
        if (rec.swipe === removed) rec.swipe = -1;      // применённый вариант удалён — пересчитать
        else if (rec.swipe > removed) rec.swipe -= 1;
    }
    console.log(`[Lifeweaver] удалён свайп ${removed} — номера вариантов переписаны`);
}

// ═══════════════════════════════════════════
// ИСТОРИЯ СОСТОЯНИЙ ПО ПОЗИЦИЯМ
// ═══════════════════════════════════════════

// Снапшот per-chat состояния без самой истории (иначе она вложится в себя)
export function snapshotOfChatData() {
    const chat = getChatData();
    const copy = structuredClone(chat);
    // Ни история откатов, ни стек отмен внутрь снимка не попадают — иначе
    // каждый снимок тащил бы в себе все предыдущие, и состояние росло бы
    // лавиной с каждым сообщением.
    delete copy._history;
    delete copy._undo;
    return copy;
}

export function pushStateHistory(pos) {
    try {
        const chat = getChatData();
        if (!Array.isArray(chat._history)) chat._history = [];
        const snap = snapshotOfChatData();
        const existing = chat._history.find(h => h.pos === pos);
        if (existing) {
            existing.state = snap;
        } else {
            chat._history.push({ pos, state: snap });
            chat._history.sort((a, b) => a.pos - b.pos);
        }
        if (chat._history.length > HISTORY_CAP) {
            chat._history.splice(0, chat._history.length - HISTORY_CAP);
        }
    } catch (e) { /* ignore */ }
}

// Журнал: какой вариант какого сообщения сейчас отражён в состоянии
function setLastApplied(pos, swipe, sig) {
    getChatData()._lastApplied = { pos, swipe, sig };
}

function hasHistoryAt(pos) {
    const hist = getChatData()._history;
    return Array.isArray(hist) && hist.some(h => h.pos === pos);
}

// Полная замена состояния снимком; стек отмен и история переживают
function replaceChatState(state, keepHistory) {
    const chat = getChatData();
    const keptUndo = chat._undo;
    for (const k of Object.keys(chat)) delete chat[k];
    Object.assign(chat, structuredClone(state));
    if (keptUndo) chat._undo = keptUndo;
    chat._history = keepHistory;
}

// Откат к состоянию ДО сообщения на позиции pos.
// Источник 1 — сохранённая история (последняя запись раньше pos).
// Источник 2 — снимок в памяти, если он снят именно перед этой позицией.
// Возвращает описание для диагностики или null, если откатываться некуда.
function restoreStateBefore(pos, chatIdNow) {
    const chat = getChatData();
    const hist = Array.isArray(chat._history) ? chat._history : [];
    const before = hist.filter(h => h.pos < pos);
    const target = before.length ? before[before.length - 1] : null;
    if (target) {
        replaceChatState(target.state, before);
        return `к позиции ${target.pos} (сохранённая история)`;
    }
    if (_preRegenSnapshot && _snapshotChatId === chatIdNow && _snapshotPos === pos) {
        replaceChatState(_preRegenSnapshot, hist.filter(h => h.pos < pos));
        return 'к снимку в памяти';
    }
    return null;
}

// Откат к моменту, когда в чате было newLen сообщений (удаление сообщения).
export function rollbackToPosition(newLen) {
    try {
        const chat = getChatData();
        if (!Array.isArray(chat._history) || chat._history.length === 0) return false;

        const kept = chat._history.filter(h => h.pos <= newLen);
        const target = kept.length > 0 ? kept[kept.length - 1] : null;
        if (!target) {
            chat._history = kept;
            return false;
        }

        // Полная замена состояния (с удалением ключей, появившихся позже)
        replaceChatState(target.state, kept);

        _preRegenSnapshot = snapshotOfChatData();
        _snapshotChatId = getCurrentChatId();
        _snapshotPos = newLen + 1;

        saveSettingsDebounced();
        notifyStateChanged();
        setTimeout(renderInfoblock, 200);
        return true;
    } catch (e) {
        return false;
    }
}

export function markRegeneration() {
    _isRegeneration = true;
}

// Вызывать после любого РУЧНОГО изменения состояния из интерфейса.
// Правка записывается в историю на текущую позицию: следующее сообщение
// будет считаться уже от неё. Свайп того сообщения, после которого правили,
// правку не сохранит — откат идёт к состоянию ДО него (так договорились).
export function refreshRegenSnapshot() {
    try {
        const ctx = getStContext();
        const len = ctx?.chat?.length ?? 0;
        if (len > 0) pushStateHistory(len);
    } catch (e) { /* ignore */ }
}

export function clearRegenState() {
    _isRegeneration = false;
    _mainGenSince = 0;
    _preRegenSnapshot = null;
    _snapshotChatId = null;
    _snapshotPos = null;
}

function notifyStateChanged() {
    try {
        document.dispatchEvent(new CustomEvent('lifeweaver:state-changed'));
    } catch (e) { /* ignore */ }
}

// Применяет разобранный результат скана. Порядок значим: потеря беременности —
// раньше остальных событий этого персонажа (взаимоисключающе с кладкой/родами).
function applyScanResult(result, debug = null) {
    if (!result) return;
    const log = (msg) => { if (debug) debug.применено.push(msg); };

    if (result.daysPassed > 0) {
        advanceTimeByDays(result.daysPassed);
        log(`время +${result.daysPassed} дн.`);
        // Вехи развития, пройденные за этот отрезок.
        // При большом скипе их набирается десяток — по тосту на каждую
        // подвешивало страницу, поэтому от трёх и больше сводим в одно.
        const milestones = takeMilestoneEvents();
        for (const ev of milestones) log(`веха: ${ev.name} — ${ev.label}`);
        if (milestones.length >= 3) {
            const byChild = {};
            for (const ev of milestones) (byChild[ev.name] ||= []).push(ev.label);
            const summary = Object.entries(byChild)
                .map(([n, list]) => `${n}: ${list.length} ${list.length < 5 ? 'вехи' : 'вех'} (последняя — ${list[list.length - 1]})`)
                .join('; ');
            notify(`<i class="fa-solid fa-star"></i> Дети выросли — ${summary}`, 'success');
        } else {
            for (const ev of milestones) {
                notify(`<i class="fa-solid fa-star"></i> ${ev.name}: ${ev.label}`, 'success');
            }
        }

        const grown = autoArchiveGrownChildren();
        if (grown.length) {
            log(`в архив по возрасту: ${grown.length}`);
            try {
                showGraduationDialog(grown, () => notifyStateChanged());
            } catch (e) { /* ignore */ }
        }
    }
    // Живая динамика от модели — до остальных событий, чтобы роды и кладка
    // уже видели актуальные данные сцены.
    if (result.status) {
        const n = applyStatus(result.status);
        if (n > 0) log(`динамика от модели: ${n} полей`);
    }
    if (result.timeOfDay) {
        if (result.timeOfDay.rpTime) {
            setRpTime(result.timeOfDay.rpTime);
            log(`время: ${result.timeOfDay.rpTime}`);
        } else if (result.timeOfDay.bucket) {
            setTimeOfDay(result.timeOfDay.bucket);
            log(`время суток: ${result.timeOfDay.bucket}`);
        }
    }
    let pendingBirth = null;

    for (const who of ['user', 'char']) {
        const isChar = who === 'char';
        const miscarriageTag = isChar ? result.charMiscarriage : result.miscarriage;
        const abortionTag = isChar ? result.charAbortion : result.abortion;
        const conceptionTag = isChar ? result.charConception : result.conception;
        const layTag = isChar ? result.charLayClutch : result.layClutch;
        const birthTag = isChar ? result.charBirth : result.birth;
        const knownTag = isChar ? result.charKnown : result.known;

        // Прерывание — взаимоисключающе с кладкой/родами, обрабатывается первым
        // Потеря по тегу модели — тоже разрушительное действие: если она
        // ошиблась, игрок должен иметь возможность откатить одной кнопкой.
        if (abortionTag) {
            createUndoCheckpoint('Прерывание беременности (по тегу)');
            if (applyAbortion(who)) notify('<i class="fa-solid fa-heart-crack"></i> Беременность прервана', 'warning');
            continue;
        }
        if (miscarriageTag) {
            createUndoCheckpoint('Потеря беременности (по тегу)');
            if (applyMiscarriage(who)) notify('<i class="fa-solid fa-heart-crack"></i> Беременность потеряна', 'warning');
            continue;
        }
        if (conceptionTag) {
            const res = applyConception(who);
            if (res === true) {
                const hidden = getSettings().hiddenPregnancy;
                log(`${who}: зачатие применено`);
                notify(hidden
                    ? '<i class="fa-solid fa-user-secret"></i> Зачатие произошло — но он пока не знает'
                    : '<i class="fa-solid fa-check"></i> Зачатие произошло!', 'success');
            } else if (res && typeof res === 'object') {
                // Бросок не прошёл — это нормальный исход, а не сбой.
                // Показываем цифры, чтобы было видно, что механика работает.
                const detail = res.reason
                    ? `сработала защита (${res.reason})`
                    : `${res.roll} из ${res.chance}%`;
                log(`${who}: зачатия не произошло — ${detail}`);
                notify(`<i class="fa-solid fa-dice"></i> Зачатия не произошло · ${detail}`, 'info');
            } else {
                const c = getCharacterData(who);
                const why = !c.canCarry ? 'не отмечен носителем'
                    : c.pregnancy?.isPregnant ? 'уже беременен'
                    : isBlocked('conception', who) ? 'блок после недавней потери'
                    : 'неизвестно';
                log(`${who}: ЗАЧАТИЕ ОТКЛОНЕНО — ${why}`);
            }
        }
        // Раскрытие пола — до родов, чтобы дети создались с уже открытым полом
        const sexTag = isChar ? result.charSexRevealed : result.sexRevealed;
        if (sexTag) {
            revealOffspringSex(who, result.revealedSexes);
            log(`${who}: пол раскрыт`);
        }
        if (layTag) {
            if (applyLayClutch(who)) {
                log(`${who}: кладка применена`);
                notify('<i class="fa-solid fa-egg"></i> Кладка отложена — идёт инкубация, тело носителя свободно', 'success');
            } else {
                const c = getCharacterData(who);
                const why = !c.pregnancy?.isPregnant ? 'беременности нет' : 'вселенная без двух фаз';
                log(`${who}: КЛАДКА ОТКЛОНЕНА — ${why}`);
            }
        }
        if (birthTag) {
            const traits = isChar ? result.charBabyTraits : result.babyTraits;
            const created = applyBirth(who, traits);
            if (created && created.length) {
                pendingBirth = created;
                log(`${who}: роды применены, создано детей: ${created.length}`);
            } else {
                const c = getCharacterData(who);
                const hasClutch = getClutches().some(cl => cl.parentWho === who);
                const why = (!c.pregnancy?.isPregnant && !hasClutch) ? 'нет ни беременности, ни кладки'
                    : isBlocked('birth', who) ? 'БЛОК после недавней потери — снимется через несколько сообщений'
                    : 'неизвестно';
                log(`${who}: РОДЫ ОТКЛОНЕНЫ — ${why}`);
                notify(`<i class="fa-solid fa-triangle-exclamation"></i> Тег родов пришёл, но не применён: ${why}`, 'warning');
            }
        }
        if (knownTag) setPregnancyKnown(who, true);

        // Тест на беременность в сцене
        const testTag = isChar ? result.charTest : result.test;
        if (testTag) {
            const r = takeTest(who);
            log(`${who}: тест — ${TEST_LABELS[r] || r}`);
            notify(`<i class="fa-solid fa-vial"></i> Тест: ${TEST_LABELS[r] || r}`, r === 'negative' ? 'info' : 'success');
        }

        // Визит к врачу/целителю: лечим тело и все кладки этого носителя
        const doctorTag = isChar ? result.charDoctor : result.doctor;
        if (doctorTag) {
            let healed = 0, failed = 0;
            const body = doctorVisit(who);
            healed += body.healed; failed += body.failed;
            for (const c of getClutches().filter(cl => cl.parentWho === who)) {
                const r = doctorVisit(c.id);
                healed += r.healed; failed += r.failed;
            }
            if (healed || failed) {
                log(`${who}: лечение — вылечено ${healed}, осталось ${failed}`);
                notify(`<i class="fa-solid fa-stethoscope"></i> Вылечено: ${healed}${failed ? `, осталось: ${failed}` : ''}`, failed ? 'info' : 'success');
            }
        }
    }

    // Дозаполнение черт детей, описанных моделью позже (поэтапное вылупление)
    if (result.childTraits) {
        const filled = applyChildTraits(result.childTraits);
        if (filled > 0) log(`дозаполнены черты детей: ${filled} пол${filled === 1 ? 'е' : 'ей'}`);
    }

    // Диалог рождения — после применения всех событий
    if (pendingBirth) {
        try {
            showBirthDialog(pendingBirth, getActivePreset(), (names) => {
                if (Array.isArray(names)) {
                    names.forEach((n, i) => {
                        if (n && pendingBirth[i]) pendingBirth[i].name = n;
                    });
                    saveSettingsDebounced();
                }
                // ВАЖНО: диалог асинхронный — снапшот для отката уже был записан
                // в runScan, ДО того как игрок вписал имена. Без этой строки любой
                // откат (удаление сообщения, свайп, реген) возвращал детей без имён,
                // хотя черты оставались на месте.
                refreshRegenSnapshot();
                notifyStateChanged();
            });
        } catch (e) { /* ignore */ }
    }
}

function notify(html, type) {
    try {
        if (getSettings().showNotifications) showNotification(html, type);
    } catch (e) { /* ignore */ }
}

function stripTagsFromDom(index) {
    try {
        const el = document.querySelector(`.mes[mesid="${index}"] .mes_text`);
        if (el && hasOurTags(el.innerHTML)) {
            el.innerHTML = stripOurTags(el.innerHTML);
        }
    } catch (e) { /* ignore */ }
}

// ── Диагностика: что произошло на последнем скане (для панели и консоли) ──
let _lastDebug = null;

export function getLastScanDebug() {
    return _lastDebug;
}

function logDebug(entry) {
    _lastDebug = entry;
    console.log('[Lifeweaver] СКАН:', entry);
}

// Сохранить отметку и чат без применения тегов
function persistStamp(ctx, msg, idx, swipe, tags, sig) {
    stampMessage(msg, swipe, tags, sig);
    saveSettingsDebounced();
    try { ctx.saveChat?.(); } catch (e) { /* ignore */ }
    setTimeout(() => stripTagsFromDom(idx), 250);
}

function runScan(trigger = '?') {
    try {
        const settings = getSettings();
        if (!settings.isEnabled) {
            console.log('[Lifeweaver] скан пропущен: расширение выключено');
            return;
        }

        const ctx = getStContext();
        if (!ctx?.chat?.length) return;

        const idx = ctx.chat.length - 1;
        const lastMessage = ctx.chat[idx];
        if (!lastMessage || !lastMessage.mes) return;

        // Свайп ещё не существует (генерация нового варианта только началась
        // или её остановили) либо на его месте заглушка Таверны «...» —
        // сканировать нечего. Флаг регена не трогаем: он нужен настоящему скану.
        if (!lastMessage.is_user) {
            const outOfRange = Array.isArray(lastMessage.swipes) && typeof lastMessage.swipe_id === 'number'
                && lastMessage.swipe_id >= lastMessage.swipes.length;
            if (outOfRange || lastMessage.mes === '...') {
                console.log(`[Lifeweaver] скан пропущен: свайп ещё генерируется (триггер: ${trigger})`);
                return;
            }
        }

        migrateLegacyClutch(); // на случай чатов со старым форматом инкубации

        const positionId = ctx.chat.length;
        const isRegen = _isRegeneration && !lastMessage.is_user;
        _isRegeneration = false;

        const swipe = swipeIdOf(lastMessage);
        const { text, tags, sig } = composeScanText(lastMessage);
        const ve = variantExtraOf(lastMessage);
        const markerMatches = !!ve?.lifeweaverApplied && ve.lifeweaverApplied.sig === sig;
        const rec = getChatData()._lastApplied;
        const recIsHere = !!rec && rec.pos === positionId;
        const chatIdNow = getCurrentChatId();

        // 1. Состояние уже отражает ровно этот вариант — повтор события
        if (recIsHere && (rec.swipe ?? null) === swipe && rec.sig === sig) {
            console.log(`[Lifeweaver] скан пропущен: позиция ${positionId}, свайп ${swipe} уже применён (триггер: ${trigger})`);
            return;
        }

        // 2. Журнала по этой позиции нет, но сообщение уже обрабатывали
        //    (отметка на свайпе или запись в истории) — чат от прошлой версии.
        //    Повторно не применяем, иначе дни сложились бы: только записываем.
        if (!isRegen && !recIsHere && (markerMatches || (!ve && hasHistoryAt(positionId)))) {
            setLastApplied(positionId, swipe, sig);
            persistStamp(ctx, lastMessage, idx, swipe, tags, sig);
            console.log(`[Lifeweaver] позиция ${positionId} уже была обработана раньше — записана без повторного применения (триггер: ${trigger})`);
            return;
        }

        // 3. Свайп из чата старой версии: его теги не сохранились, и что в нём
        //    было — неизвестно. Пересчитывать «в ноль» нельзя (потеряли бы его
        //    дни), поэтому состояние не трогаем.
        if (!isRegen && recIsHere && !ve && tags.length === 0) {
            console.log(`[Lifeweaver] свайп ${swipe} на позиции ${positionId} из старой версии, теги не сохранились — состояние не трогаю (триггер: ${trigger})`);
            return;
        }

        // 4. Вариант сменился (новый свайп, перелистывание, continue с новыми
        //    тегами) — сначала откат к состоянию ДО этого сообщения
        const isReplacement = isRegen || recIsHere || hasHistoryAt(positionId);
        let rollback;
        if (isReplacement) {
            rollback = restoreStateBefore(positionId, chatIdNow);
            if (rollback) {
                console.log(`[Lifeweaver] замена варианта: откат ${rollback}`);
            } else {
                rollback = 'НЕКУДА — применено поверх текущего';
                const key = `${chatIdNow}|${positionId}`;
                if (!_warnedPositions.has(key)) {
                    _warnedPositions.add(key);
                    notify('<i class="fa-solid fa-triangle-exclamation"></i> Не нашёл состояние до этого ответа — дни могли сложиться. Проверь «День истории» и цикл.', 'warning');
                }
                console.warn('[Lifeweaver] замена варианта, но откатиться некуда — состояние «до» не найдено');
            }
        }

        // Запасной снимок «до» — на случай, если история подведёт
        _preRegenSnapshot = snapshotOfChatData();
        _snapshotChatId = chatIdNow;
        _snapshotPos = positionId;

        // ── Диагностика ДО применения ──
        const described = describeScan(text);
        const result = scanMessage(text);
        const debugEntry = {
            триггер: trigger,
            чат: chatIdNow || '(не определён!)',
            позиция: positionId,
            свайп: swipe,
            режим: !isReplacement ? 'новое сообщение'
                : trigger === 'MESSAGE_SWIPED' ? 'перелистывание свайпа' : 'замена варианта',
            откат: rollback,
            откуда: lastMessage.is_user ? 'сообщение игрока' : 'ответ модели',
            комментариевВТексте: described.commentsFound,
            распознаноТегов: described.recognizedTags,
            адресатНеОпознан: result?.unresolved?.length ? result.unresolved : undefined,
            всеКомментарии: described.allComments,
            хвостТекста: text.slice(-400),
            событий: result ? Object.entries(result).filter(([k, v]) => v === true).map(([k]) => k) : [],
            кладки: getClutches().map(c => `${c.offspringCount} шт., ${c.weeks}/${c.totalWeeks} нед. (от ${c.parentWho})`),
            беременности: ['user', 'char'].map(w => {
                const p = getCharacterData(w).pregnancy;
                return p?.isPregnant ? `${w}: ${p.weeks} нед., stage=${p.stage}, ${p.offspringCount} шт.` : `${w}: нет`;
            }),
            днейПрошло: result?.daysPassed || 0,
            применено: [],
        };

        if (result?.unresolved?.length) {
            console.warn('[Lifeweaver] адресат тега не опознан:', result.unresolved);
            notify(`<i class="fa-solid fa-question"></i> Не понял, к кому относится: ${result.unresolved.join(', ')}`, 'warning');
        }
        if (result) {
            applyScanResult(result, debugEntry);
        }
        // Промпт и панель освежаем и после пустого варианта: откат мог
        // изменить состояние, даже если применять было нечего.
        if (result || isReplacement) {
            updatePromptInjection();
            notifyStateChanged();
        }
        logDebug(debugEntry);

        setLastApplied(positionId, swipe, sig);
        pushStateHistory(positionId);
        stampMessage(lastMessage, swipe, tags, sig);
        saveSettingsDebounced();
        try { ctx.saveChat?.(); } catch (e) { /* ignore */ }
        setTimeout(() => stripTagsFromDom(idx), 250);
        // ST дорисовывает сообщение не мгновенно; двойной проход надёжнее —
        // второй переживает собственную перерисовку Таверны.
        setTimeout(renderInfoblock, 300);
        setTimeout(renderInfoblock, 900);
    } catch (e) {
        console.error('[Lifeweaver] runScan error:', e);
    }
}

export function initAutomation() {
    try {
        console.log(`[Lifeweaver] автоматика ${AUTOMATION_BUILD} загружена`);
        // Сканер сам не знает имён персонажей — отдаём ему сопоставление
        setWhoResolver(resolveWhoByName);
        if (event_types.MESSAGE_RECEIVED) {
            eventSource.on(event_types.MESSAGE_RECEIVED, (i, type) => {
                if (type === 'quiet') return;
                runScan('MESSAGE_RECEIVED');
            });
        }
        if (event_types.MESSAGE_SENT) {
            eventSource.on(event_types.MESSAGE_SENT, (i, type) => {
                if (type === 'quiet') return;
                runScan('MESSAGE_SENT');
            });
        }

        // Реген/свайп с генерацией определяем по явному типу генерации.
        // MESSAGE_SWIPED сюда НЕ ставит флаг: он стреляет и при простом
        // перелистывании, флаг повисал и потом срабатывал на чужой тихой
        // генерации. Перелистывание обрабатывается отдельно, ниже.
        if (event_types.GENERATION_STARTED) {
            eventSource.on(event_types.GENERATION_STARTED, (genType, params, dryRun) => {
                if (dryRun || genType === 'quiet') return;
                _mainGenSince = Date.now();
                if (genType === 'regenerate' || genType === 'swipe') markRegeneration();
                // Новый свайп: Таверна оставляет в extra данные ПРЕДЫДУЩЕГО
                // варианта (их копия уже лежит в его swipe_info) и потом
                // копирует их в swipe_info нового. Снимаем наши поля, чтобы
                // чужие теги не приклеились к новому варианту.
                if (genType === 'swipe') scrubOurFields(getStContext()?.chat?.at(-1)?.extra);
            });
        }

        // Пересчитать состояние под показанный вариант, если он не тот, что
        // применён. Безопасно звать сколько угодно раз: совпало — ничего не
        // происходит. Пока идёт основная генерация, не лезем.
        const reconcile = (trigger, delays) => {
            for (const ms of delays) {
                setTimeout(() => {
                    try {
                        if (mainGenActive()) return;
                        const m = getStContext()?.chat?.at(-1);
                        if (!m || m.is_user) return;
                        runScan(trigger);
                    } catch (e) { /* ignore */ }
                }, ms);
            }
        };

        // Перелистывание к готовому свайпу. Две попытки: сразу и после
        // анимации — на случай версии Таверны, где текст меняется позже.
        if (event_types.MESSAGE_SWIPED) {
            eventSource.on(event_types.MESSAGE_SWIPED, () => reconcile('MESSAGE_SWIPED', [60, 700]));
        }

        // Удаление свайпа: номера свайпов после удалённого сдвигаются на один,
        // а у нас в данных записан номер. Переписываем, потом сверяемся.
        if (event_types.MESSAGE_SWIPE_DELETED) {
            eventSource.on(event_types.MESSAGE_SWIPE_DELETED, (data) => {
                try { reindexAfterSwipeDeleted(data); } catch (e) { /* ignore */ }
                reconcile('MESSAGE_SWIPED', [60, 700]);
            });
        }

        // GENERATION_ENDED — хук для стриминговых свайпов/continue
        if (event_types.GENERATION_ENDED) {
            eventSource.on(event_types.GENERATION_ENDED, () => {
                _mainGenSince = 0;
                runScan('GENERATION_ENDED');
            });
        }

        // Стоп. Если остановленный свайп пуст, Таверна молча возвращает
        // прежний вариант — без единого события, примерно через секунду
        // (сначала мигает счётчиком). Поэтому сверяемся сами, с запасом.
        if (event_types.GENERATION_STOPPED) {
            eventSource.on(event_types.GENERATION_STOPPED, () => {
                _mainGenSince = 0;
                reconcile('ПОСЛЕ СТОПА', [1500, 4000]);
            });
        }

        // Удаление сообщения — откат к снапшоту предыдущей позиции.
        // ST эмитит MESSAGE_DELETED с НОВОЙ длиной чата (после удаления).
        if (event_types.MESSAGE_DELETED) {
            eventSource.on(event_types.MESSAGE_DELETED, (newLength) => {
                const ctx = getStContext();
                const len = typeof newLength === 'number' ? newLength : (ctx?.chat?.length ?? 0);
                rollbackToPosition(len);
                updatePromptInjection();
            });
        }

        // Инфоблок живёт в DOM, поэтому его надо возвращать после любой
        // перерисовки ленты — свайпы, удаление, подгрузка истории.
        for (const evt of ['MESSAGE_SWIPED', 'MESSAGE_DELETED', 'MESSAGE_UPDATED', 'CHARACTER_MESSAGE_RENDERED', 'USER_MESSAGE_RENDERED', 'MORE_MESSAGES_LOADED']) {
            if (event_types[evt]) {
                eventSource.on(event_types[evt], () => setTimeout(renderInfoblock, 200));
            }
        }
    } catch (e) {
        console.error('[Lifeweaver] initAutomation error:', e);
    }
}
