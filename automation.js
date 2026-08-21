// ═══════════════════════════════════════════
// AUTOMATION — подписка на события ST + применение результатов скана
// ═══════════════════════════════════════════
//
// Аналог message-handler.js у вдохновителя, сильно упрощённый: без истории
// снапшотов на откат при удалении сообщения, без дедупа по хэшу, без учёта
// свайпов/регенерации отдельно. Это тот самый "ещё много правок потом" —
// сейчас важно, чтобы мозги (детект + применение) работали правильно.

import { eventSource, event_types, saveSettingsDebounced } from '../../../../script.js';
import {
    getSettings, advanceTimeByDays, applyConception, applyLayClutch, applyBirth,
    applyPregnancyLoss, setPregnancyKnown,
} from './state.js';
import { scanMessage, stripOurTags, hasOurTags } from './scanner.js';
import { updatePromptInjection } from './prompts.js';

// Применяет разобранный результат скана к состоянию. Порядок значим:
// потеря беременности — раньше остальных событий этого персонажа (взаимоисключающе
// с кладкой/родами), дальше зачатие → кладка → роды → знание о беременности.
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

function getStContext() {
    return typeof SillyTavern?.getContext === 'function' ? SillyTavern.getContext() : null;
}

// Убирает наши теги из текста сообщения после скана — чтобы они не тянулись
// в контекст модели на следующих ответах (модель имеет свойство копировать
// старые теги по инерции, если видит их в истории).
function cleanMessageTags(msg) {
    if (!msg || !hasOurTags(msg.mes)) return;
    const clean = stripOurTags(msg.mes).replace(/\n{3,}/g, '\n\n').trimEnd();
    if (clean === msg.mes) return;
    msg.mes = clean;
    if (Array.isArray(msg.swipes) && typeof msg.swipe_id === 'number' && msg.swipes[msg.swipe_id] !== undefined) {
        msg.swipes[msg.swipe_id] = clean;
    }
}

function handleMessageAt(index) {
    try {
        const settings = getSettings();
        if (!settings.isEnabled) return;

        const ctx = getStContext();
        if (!ctx?.chat?.length) return;
        let idx = index;
        if (typeof idx !== 'number' || idx < 0 || idx >= ctx.chat.length) idx = ctx.chat.length - 1;
        const msg = ctx.chat[idx];
        if (!msg || !msg.mes) return;

        const result = scanMessage(msg.mes);
        if (result) {
            applyScanResult(result);
            updatePromptInjection();
        }
        cleanMessageTags(msg);
        saveSettingsDebounced();
    } catch (e) {
        console.error('[Lifeweaver] handleMessageAt error:', e);
    }
}

export function initAutomation() {
    try {
        // Основной путь — ответ бота. Плюс сканируем и то, что отправляет сам
        // игрок (можно вручную вписать тег текстом, чтобы проверить механику
        // без ожидания подходящей генерации от модели).
        if (event_types.MESSAGE_RECEIVED) {
            eventSource.on(event_types.MESSAGE_RECEIVED, (index) => handleMessageAt(index));
        }
        if (event_types.MESSAGE_SENT) {
            eventSource.on(event_types.MESSAGE_SENT, (index) => handleMessageAt(index));
        }
    } catch (e) {
        console.error('[Lifeweaver] initAutomation error:', e);
    }
}
