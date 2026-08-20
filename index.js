// ═══════════════════════════════════════════
// LIFEWEAVER — точка входа
// ═══════════════════════════════════════════

import { extensionName, UNIVERSE_PRESETS, summarizePreset } from './config.js';
import { getSettings, getActiveUniverse, setActiveUniverse, resetChatIdCache } from './state.js';

const extensionFolderPath = `scripts/extensions/${extensionName}`;

function populateUniverseSelect($select) {
    $select.empty();
    for (const id in UNIVERSE_PRESETS) {
        const preset = UNIVERSE_PRESETS[id];
        $select.append(`<option value="${id}">${preset.label}</option>`);
    }
}

function refreshUniverseUI($select, $readout) {
    const active = getActiveUniverse();
    $select.val(active);
    $readout.text(summarizePreset(active));
}

function bindUI() {
    const settings = getSettings();

    const $enabled = $('#lw_enabled');
    $enabled.prop('checked', settings.isEnabled);
    $enabled.on('change', function () {
        settings.isEnabled = $(this).prop('checked');
        saveSettings();
    });

    const $universe = $('#lw_universe_select');
    const $readout = $('#lw_universe_readout');
    populateUniverseSelect($universe);
    refreshUniverseUI($universe, $readout);

    $universe.on('change', function () {
        setActiveUniverse($(this).val());
        refreshUniverseUI($universe, $readout);
        saveSettings();
    });

    // При смене чата — сбрасываем кэш id и перечитываем вселенную для нового чата
    try {
        const context = SillyTavern.getContext();
        context.eventSource?.on(context.eventTypes?.CHAT_CHANGED, () => {
            resetChatIdCache();
            refreshUniverseUI($universe, $readout);
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
        console.log('[Lifeweaver] Загружен, модель вселенных на месте.');
    } catch (e) {
        console.error('[Lifeweaver] Ошибка загрузки:', e);
    }
});
