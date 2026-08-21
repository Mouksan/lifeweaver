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
    applyPregnancyLoss, setPregnancyKnown,
} from './state.js';
import { scanMessage, stripOurTags, hasOurTags, stripThink } from './scanner.js';
import { updatePromptInjection } from './prompts.js';

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
function applyScanResult(result) {
    if (!result) return;

    if (result.daysPassed > 0) advanceTimeByDays(result.daysPassed);

    for (const who of ['user', 'char']) {
        const isChar = who === 'char';
        const lossTag = isChar ? result.charLoss : result.loss;
        const conceptionTag = isChar ? result.charConception : result.conception;
        const layTag = isChar ? result.charLayClutch : result.layClutch;
        const birthTag = isChar ? result.charBirth : result.birth;
        const knownTag = isChar ? result.charKnown : result.known;

        if (lossTag) { applyPregnancyLoss(who); continue; }
        if (conceptionTag) applyConception(who);
        if (layTag) applyLayClutch(who);
        if (birthTag) applyBirth(who);
        if (knownTag) setPregnancyKnown(who, true);
    }
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

function runScan() {
    try {
        const settings = getSettings();
        if (!settings.isEnabled) return;

        const ctx = getStContext();
        if (!ctx?.chat?.length) return;

        const idx = ctx.chat.length - 1;
        const lastMessage = ctx.chat[idx];
        if (!lastMessage || !lastMessage.mes) return;

        // Позиция = длина чата: реген/свайп заменяет сообщение на той же позиции
        const positionId = ctx.chat.length;
        // Реген/свайп всегда заканчивается ботским сообщением: на юзерском флаг протух
        const isRegen = _isRegeneration && !lastMessage.is_user;
        _isRegeneration = false;

        const text = stripThink(rawTextOf(lastMessage));
        const textHash = simpleHash(text);

        // ДЕДУП: та же позиция И тот же текст (или его версия с вырезанными
        // тегами) → скип. Именно это спасает от накрутки дней при повторной
        // обработке одного и того же ответа.
        if (!isRegen && _lastScannedPosition === positionId &&
            (textHash === _lastScannedHash || textHash === _lastScannedHashStripped)) {
            return;
        }

        const chatIdNow = getCurrentChatId();

        // РЕГЕН/СВАЙП: восстанавливаем состояние ДО старого варианта ответа,
        // прежде чем применять теги нового. Только если снапшот от этого же чата.
        if (isRegen && _preRegenSnapshot) {
            if (_snapshotChatId === chatIdNow) {
                const chat = getChatData();
                for (const k of Object.keys(chat)) delete chat[k];
                Object.assign(chat, structuredClone(_preRegenSnapshot));
                saveSettingsDebounced();
            }
            _preRegenSnapshot = null;
        }

        // Снапшот ДО обработки — для будущего регена
        _preRegenSnapshot = snapshotOfChatData();
        _snapshotChatId = chatIdNow;

        // Отмечаем скан сразу
        _lastScannedPosition = positionId;
        _lastScannedHash = textHash;
        _lastScannedHashStripped = simpleHash(stripOurTags(text));

        const result = scanMessage(text);
        if (result) {
            applyScanResult(result);
            updatePromptInjection();
            notifyStateChanged();
        }

        // История состояний ПОСЛЕ обработки — для отката при удалении
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
                runScan();
            });
        }
        if (event_types.MESSAGE_SENT) {
            eventSource.on(event_types.MESSAGE_SENT, (i, type) => {
                if (type === 'quiet') return;
                runScan();
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
            eventSource.on(event_types.GENERATION_ENDED, () => runScan());
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
