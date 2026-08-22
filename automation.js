// ═══════════════════════════════════════════
// AUTOMATION — подписка на события ST + применение результатов скана
// ═══════════════════════════════════════════
//
// Логика портирована с message-handler.js вдохновителя. Не изобретаем своё:
// у них это уже прошло проверку боем. Взято один в один по смыслу:
//
//  • ДЕДУП ПО ХЭШУ: та же позиция в чате + тот же текст → скип. Иначе один
//    ответ обрабатывается дважды (MESSAGE_RECEIVED + дорисовка/стриминг),
//    и DAYS_PASSED накручивается по второму разу.
//  • ИСТОРИЯ СНАПШОТОВ: перед обработкой каждого сообщения сохраняем полное
//    состояние чата под номером позиции. Удалили сообщение → откатываемся
//    к снапшоту предыдущей позиции.
//  • РЕГЕН/СВАЙП: перед обработкой держим снапшот "до". Свайп на другой
//    вариант ответа = сначала восстановить состояние до старого варианта,
//    потом применить теги нового. Иначе дни/события суммируются с обоих.
//  • stripThink перед сканом (репетиция тега в думалке ≠ событие).
//  • Сохранение исходника в msg.extra перед вырезанием тегов.
//  • Явная подчистка отрисованного DOM.
//
// Отличие только одно, наше: события двухстадийного вынашивания (LAY_CLUTCH)
// и универсальные теги вместо привязанных к одной вселенной.

import { eventSource, event_types, saveSettingsDebounced } from '../../../../script.js';
import {
    getSettings, getChatData, getCurrentChatId,
    advanceTimeByDays, applyConception, applyLayClutch, applyBirth,
    applyMiscarriage, applyAbortion, setPregnancyKnown, revealOffspringSex, getActivePreset,
    getCharacterData, isBlocked, applyChildTraits, setTimeOfDay, autoArchiveGrownChildren,
} from './state.js';
import { scanMessage, stripOurTags, hasOurTags, stripThink, describeScan } from './scanner.js';
import { updatePromptInjection } from './prompts.js';
import { showNotification, showBirthDialog } from './notifications.js';

const HISTORY_CAP = 25;

// ── Состояние обработки (живёт в памяти, не в настройках) ──
let _isRegeneration = false;
let _preRegenSnapshot = null;
let _snapshotChatId = null;
let _lastScannedPosition = null;
let _lastScannedHash = null;
let _lastScannedHashStripped = null;

// Быстрый хэш текста — для дедупа сканов
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

// Снапшот per-chat состояния без самой истории (иначе она вложится в себя)
function snapshotOfChatData() {
    const chat = getChatData();
    const copy = structuredClone(chat);
    delete copy._history;
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

// Откат к моменту, когда в чате было newLen сообщений.
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
        for (const k of Object.keys(chat)) delete chat[k];
        Object.assign(chat, structuredClone(target.state));
        chat._history = kept;

        _preRegenSnapshot = snapshotOfChatData();
        _snapshotChatId = getCurrentChatId();
        // Позиция скана протухла — следующий ответ должен обработаться заново
        _lastScannedPosition = null;
        _lastScannedHash = null;
        _lastScannedHashStripped = null;

        saveSettingsDebounced();
        notifyStateChanged();
        return true;
    } catch (e) {
        return false;
    }
}

export function markRegeneration() {
    _isRegeneration = true;
}

// Вызывать после любого РУЧНОГО изменения состояния из интерфейса — иначе
// свайп/реген откатит ручные правки к состоянию до последнего скана.
export function refreshRegenSnapshot() {
    try {
        _preRegenSnapshot = snapshotOfChatData();
        _snapshotChatId = getCurrentChatId();
        const ctx = getStContext();
        const len = ctx?.chat?.length ?? 0;
        if (len > 0) pushStateHistory(len);
    } catch (e) { /* ignore */ }
}

export function clearRegenState() {
    _isRegeneration = false;
    _preRegenSnapshot = null;
    _snapshotChatId = null;
    _lastScannedPosition = null;
    _lastScannedHash = null;
    _lastScannedHashStripped = null;
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
        const grown = autoArchiveGrownChildren();
        if (grown.length) {
            log(`в архив по возрасту: ${grown.length}`);
            notify(`<i class="fa-solid fa-graduation-cap"></i> ${grown.map(c => c.name || 'Ребёнок').join(', ')} — вырос(ли), перенесён(ы) в архив`, 'info');
        }
    }
    if (result.timeOfDay) {
        setTimeOfDay(result.timeOfDay);
        log(`время суток: ${result.timeOfDay}`);
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
        if (abortionTag) {
            if (applyAbortion(who)) notify('<i class="fa-solid fa-heart-crack"></i> Беременность прервана', 'warning');
            continue;
        }
        if (miscarriageTag) {
            if (applyMiscarriage(who)) notify('<i class="fa-solid fa-heart-crack"></i> Беременность потеряна', 'warning');
            continue;
        }
        if (conceptionTag) {
            if (applyConception(who)) {
                const hidden = getSettings().hiddenPregnancy;
                log(`${who}: зачатие применено`);
                notify(hidden
                    ? '<i class="fa-solid fa-user-secret"></i> Зачатие произошло — но он пока не знает'
                    : '<i class="fa-solid fa-check"></i> Зачатие произошло!', 'success');
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
                notify('<i class="fa-solid fa-egg"></i> Кладка отложена — началась инкубация', 'success');
            } else {
                const c = getCharacterData(who);
                const why = !c.pregnancy?.isPregnant ? 'беременности нет'
                    : c.pregnancy.stage !== 'formation' ? 'уже в фазе инкубации'
                    : 'вселенная без двух фаз';
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
                const why = !c.pregnancy?.isPregnant ? 'беременности нет'
                    : isBlocked('birth', who) ? 'БЛОК после недавней потери — снимется через несколько сообщений'
                    : 'неизвестно';
                log(`${who}: РОДЫ ОТКЛОНЕНЫ — ${why}`);
                notify(`<i class="fa-solid fa-triangle-exclamation"></i> Тег родов пришёл, но не применён: ${why}`, 'warning');
            }
        }
        if (knownTag) setPregnancyKnown(who, true);
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

// Убирает наши теги из msg.mes после скана, сохранив исходник в msg.extra.
function cleanMessageTags(msg) {
    if (!msg || !hasOurTags(msg.mes)) return;
    const raw = msg.mes;
    const clean = stripOurTags(raw).replace(/\n{3,}/g, '\n\n').trimEnd();
    if (clean === raw) return;
    msg.extra = msg.extra || {};
    msg.extra.lifeweaverRaw = raw;
    msg.mes = clean;
    if (Array.isArray(msg.swipes) && typeof msg.swipe_id === 'number' && msg.swipes[msg.swipe_id] !== undefined) {
        msg.swipes[msg.swipe_id] = clean;
    }
}

// Текст для скана: сначала сохранённый исходник (теги уже вырезаны из msg.mes),
// иначе видимый текст.
function rawTextOf(msg) {
    if (!msg) return '';
    return (msg.extra && msg.extra.lifeweaverRaw) || msg.mes || '';
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

        const positionId = ctx.chat.length;
        const isRegen = _isRegeneration && !lastMessage.is_user;
        _isRegeneration = false;

        const text = stripThink(rawTextOf(lastMessage));
        const textHash = simpleHash(text);

        if (!isRegen && _lastScannedPosition === positionId &&
            (textHash === _lastScannedHash || textHash === _lastScannedHashStripped)) {
            console.log(`[Lifeweaver] скан пропущен (дедуп, повтор той же позиции ${positionId}), триггер: ${trigger}`);
            return;
        }

        const chatIdNow = getCurrentChatId();

        if (isRegen && _preRegenSnapshot) {
            if (_snapshotChatId === chatIdNow) {
                const chat = getChatData();
                for (const k of Object.keys(chat)) delete chat[k];
                Object.assign(chat, structuredClone(_preRegenSnapshot));
                saveSettingsDebounced();
                console.log('[Lifeweaver] реген: состояние откачено к варианту "до"');
            }
            _preRegenSnapshot = null;
        }

        _preRegenSnapshot = snapshotOfChatData();
        _snapshotChatId = chatIdNow;

        _lastScannedPosition = positionId;
        _lastScannedHash = textHash;
        _lastScannedHashStripped = simpleHash(stripOurTags(text));

        // ── Диагностика ДО применения ──
        const described = describeScan(text);
        const result = scanMessage(text);
        const debugEntry = {
            триггер: trigger,
            позиция: positionId,
            откуда: lastMessage.is_user ? 'сообщение игрока' : 'ответ модели',
            комментариевВТексте: described.commentsFound,
            распознаноТегов: described.recognizedTags,
            всеКомментарии: described.allComments,
            хвостТекста: text.slice(-400),
            событий: result ? Object.entries(result).filter(([k, v]) => v === true).map(([k]) => k) : [],
            днейПрошло: result?.daysPassed || 0,
            применено: [],
        };

        if (result) {
            applyScanResult(result, debugEntry);
            updatePromptInjection();
            notifyStateChanged();
        }
        logDebug(debugEntry);

        pushStateHistory(positionId);
        cleanMessageTags(lastMessage);
        saveSettingsDebounced();
        try { ctx.saveChat?.(); } catch (e) { /* ignore */ }
        setTimeout(() => stripTagsFromDom(idx), 250);
    } catch (e) {
        console.error('[Lifeweaver] runScan error:', e);
    }
}

export function initAutomation() {
    try {
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

        // Свайп — помечаем реген, чтобы состояние откатилось к "до" старого варианта
        if (event_types.MESSAGE_SWIPED) {
            eventSource.on(event_types.MESSAGE_SWIPED, () => markRegeneration());
        }
        // GENERATION_STARTED стреляет ДО добавления сообщения — реген определяем
        // по явному типу генерации из первого аргумента.
        if (event_types.GENERATION_STARTED) {
            eventSource.on(event_types.GENERATION_STARTED, (genType, params, dryRun) => {
                if (dryRun) return;
                if (genType === 'regenerate' || genType === 'swipe') markRegeneration();
            });
        }
        // GENERATION_ENDED — хук для стриминговых свайпов/continue
        if (event_types.GENERATION_ENDED) {
            eventSource.on(event_types.GENERATION_ENDED, () => runScan('GENERATION_ENDED'));
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

        // Редактирование сообщения — текст изменился, дедуп должен протухнуть
        if (event_types.MESSAGE_EDITED) {
            eventSource.on(event_types.MESSAGE_EDITED, () => {
                _lastScannedHash = null;
                _lastScannedHashStripped = null;
            });
        }
    } catch (e) {
        console.error('[Lifeweaver] initAutomation error:', e);
    }
}
