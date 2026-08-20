// ═══════════════════════════════════════════
// LIFEWEAVER — точка входа
// ═══════════════════════════════════════════

import { extensionName } from './config.js';
import { getSettings, getChatNote, setChatNote, resetChatIdCache } from './state.js';

const extensionFolderPath = `scripts/extensions/${extensionName}`;

function bindUI() {
    const settings = getSettings();

    const $enabled = $('#lw_enabled');
    $enabled.prop('checked', settings.isEnabled);
    $enabled.on('change', function () {
        settings.isEnabled = $(this).prop('checked');
        saveSettings();
    });

    const $note = $('#lw_chat_note');
    $note.val(getChatNote());
    $note.on('input', function () {
        setChatNote($(this).val());
        saveSettings();
    });

    // При смене чата — сбрасываем кэш id и перечитываем заметку для нового чата
    try {
        const context = SillyTavern.getContext();
        context.eventSource?.on(context.eventTypes?.CHAT_CHANGED, () => {
            resetChatIdCache();
            $note.val(getChatNote());
        });
    } catch (e) {
        console.warn('[Lifeweaver] Не удалось подписаться на смену чата:', e);
    }
}

function saveSettings() {
    try {
        const context = SillyTavern.getContext();
        context.saveSettingsDebounced();
    } catch (e) {
        console.warn('[Lifeweaver] Не удалось сохранить настройки:', e);
    }
}

jQuery(async () => {
    try {
        const settingsHtml = await $.get(`${extensionFolderPath}/settings.html`);
        $('#extensions_settings2').append(settingsHtml);
        bindUI();
        console.log('[Lifeweaver] Загружен, фундамент держит.');
    } catch (e) {
        console.error('[Lifeweaver] Ошибка загрузки:', e);
    }
});
