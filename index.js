// ═══════════════════════════════════════════
// LIFEWEAVER — точка входа
// ═══════════════════════════════════════════

import { extensionName, UNIVERSE_PRESETS, UNIVERSE_ORDER, SECTIONS, summarizePreset } from './config.js';
import { getSettings, getActiveUniverse, setActiveUniverse, resetChatIdCache } from './state.js';

const extensionFolderPath = `scripts/extensions/${extensionName}`;

let activeSection = 'overview';

// ─── Вкладки вселенной (верхний ряд) ───
function renderUniverseTabs() {
    const $tabs = $('#lw_universe_tabs');
    const active = getActiveUniverse();
    $tabs.empty();

    for (const id of UNIVERSE_ORDER) {
        const preset = UNIVERSE_PRESETS[id];
        const isActive = id === active;
        const $tab = $(`
            <button type="button" class="lw-utab ${isActive ? 'lw-utab-active' : ''} ${preset.disabled ? 'lw-utab-disabled' : ''}"
                style="--lw-utab-color: ${preset.color}" role="tab" aria-selected="${isActive}"
                ${preset.disabled ? 'aria-disabled="true"' : ''}>
                <span class="lw-utab-label">${preset.label}</span>
                <span class="lw-utab-sub">${preset.sublabel}</span>
            </button>
        `);
        if (!preset.disabled) {
            $tab.on('click', () => {
                setActiveUniverse(id);
                saveSettings();
                renderUniverseTabs();
                renderContent();
            });
        } else {
            $tab.on('click', () => flashDisabledNote(preset.label));
        }
        $tabs.append($tab);
    }
}

let disabledNoteTimer = null;
function flashDisabledNote(label) {
    const $tabs = $('#lw_universe_tabs');
    $tabs.find('.lw-utab-note').remove();
    const $note = $(`<div class="lw-utab-note">«${label}» — конструктор своих вселенных появится позже</div>`);
    $tabs.append($note);
    clearTimeout(disabledNoteTimer);
    disabledNoteTimer = setTimeout(() => $note.fadeOut(200, () => $note.remove()), 2200);
}

// ─── Сайдбар с разделами ───
function renderSidebar() {
    const $sidebar = $('#lw_sidebar');
    $sidebar.empty();
    for (const section of SECTIONS) {
        const isActive = section.id === activeSection;
        const $item = $(`
            <button type="button" class="lw-navitem ${isActive ? 'lw-navitem-active' : ''}">
                <i class="fa-solid ${section.icon}"></i>
                <span>${section.label}</span>
            </button>
        `);
        $item.on('click', () => {
            activeSection = section.id;
            renderSidebar();
            renderContent();
        });
        $sidebar.append($item);
    }
}

// ─── Контент активного раздела ───
function renderContent() {
    const $content = $('#lw_content');
    const section = SECTIONS.find(s => s.id === activeSection);
    const universeId = getActiveUniverse();
    const preset = UNIVERSE_PRESETS[universeId];

    if (activeSection === 'overview') {
        $content.html(`
            <h2 class="lw-content-title">Обзор</h2>
            <div class="lw-card" style="--lw-card-accent: ${preset.color}">
                <div class="lw-card-label">Активная вселенная в этом чате</div>
                <div class="lw-card-value">${preset.label} <span class="lw-dim">(${preset.sublabel})</span></div>
                <div class="lw-card-sub">${summarizePreset(universeId)}</div>
            </div>
            <p class="lw-placeholder-note">Остальные карточки обзора (здоровье, цикл, беременность одной строкой) соберутся по мере того, как наполнятся сами разделы.</p>
        `);
        return;
    }

    $content.html(`
        <h2 class="lw-content-title">${section.label}</h2>
        <div class="lw-empty">
            <i class="fa-solid ${section.icon}"></i>
            <p>Раздел ещё пуст — наполним на одном из следующих этапов.</p>
        </div>
    `);
}

// ─── Открытие/закрытие модалки ───
function openPanel() {
    renderUniverseTabs();
    renderSidebar();
    renderContent();
    $('#lw_modal_overlay').addClass('lw-open');
}

function closePanel() {
    $('#lw_modal_overlay').removeClass('lw-open');
}

async function ensurePanelLoaded() {
    if ($('#lw_modal_overlay').length) return;
    const panelHtml = await $.get(`${extensionFolderPath}/panel.html`);
    $('body').append(panelHtml);

    $('#lw_close').on('click', closePanel);
    $('#lw_modal_overlay').on('click', function (e) {
        if (e.target === this) closePanel();
    });
    $(document).on('keydown', (e) => {
        if (e.key === 'Escape' && $('#lw_modal_overlay').hasClass('lw-open')) closePanel();
    });
}

// ─── Настройки в дровере extensions_settings2 ───
function bindSettingsUI() {
    const settings = getSettings();

    const $enabled = $('#lw_enabled');
    $enabled.prop('checked', settings.isEnabled);
    $enabled.on('change', function () {
        settings.isEnabled = $(this).prop('checked');
        saveSettings();
    });

    $('#lw_open_panel').on('click', async () => {
        await ensurePanelLoaded();
        openPanel();
    });

    try {
        const context = SillyTavern.getContext();
        context.eventSource?.on(context.eventTypes?.CHAT_CHANGED, () => {
            resetChatIdCache();
            if ($('#lw_modal_overlay').hasClass('lw-open')) {
                renderUniverseTabs();
                renderContent();
            }
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
        bindSettingsUI();
        console.log('[Lifeweaver] Загружен, UI-скелет на месте.');
    } catch (e) {
        console.error('[Lifeweaver] Ошибка загрузки:', e);
    }
});
