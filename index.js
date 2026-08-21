// ═══════════════════════════════════════════
// LIFEWEAVER — точка входа
// ═══════════════════════════════════════════

import { extensionName, UNIVERSE_PRESETS, UNIVERSE_ORDER, SECTIONS, summarizePreset, getTotalWeeks } from './config.js';
import {
    getSettings, getActiveUniverse, setActiveUniverse, resetChatIdCache,
    getCharacterData, setDesignation, setCycleDay, getCycleSettings, carrierDisplayName,
    setCanCarry, startPregnancy, endPregnancy, setPregnancyWeeks, setOffspringCount,
    completeBirth, getChildren, getGrownChildren, updateChildField, archiveChild, deleteChild,
} from './state.js';
import { getHeatPhase, getRutPhase } from './cycle.js';

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
    const universeId = getActiveUniverse();
    const preset = UNIVERSE_PRESETS[universeId];

    if (activeSection === 'overview') {
        renderOverviewSection(preset, universeId);
        return;
    }
    if (activeSection === 'cycle') {
        renderCycleSection(preset);
        return;
    }
    if (activeSection === 'pregnancy') {
        renderPregnancySection(preset);
        return;
    }
    if (activeSection === 'child') {
        renderChildSection(preset);
        return;
    }

    const section = SECTIONS.find(s => s.id === activeSection);
    $('#lw_content').html(`
        <h2 class="lw-content-title">${section.label}</h2>
        <div class="lw-empty">
            <i class="fa-solid ${section.icon}"></i>
            <p>Раздел ещё пуст — наполним на одном из следующих этапов.</p>
        </div>
    `);
}

function renderOverviewSection(preset, universeId) {
    $('#lw_content').html(`
        <h2 class="lw-content-title">Обзор</h2>
        <div class="lw-card" style="--lw-card-accent: ${preset.color}">
            <div class="lw-card-label">Активная вселенная в этом чате</div>
            <div class="lw-card-value">${preset.label} <span class="lw-dim">(${preset.sublabel})</span></div>
            <div class="lw-card-sub">${summarizePreset(universeId)}</div>
        </div>
        <p class="lw-placeholder-note">Остальные карточки обзора (здоровье, цикл, беременность одной строкой) соберутся по мере того, как наполнятся сами разделы.</p>
    `);
}

// ─── Раздел "Цикл" ───
function renderCycleSection(preset) {
    if (preset.cycleSystem !== 'abo') {
        $('#lw_content').html(`
            <h2 class="lw-content-title">Цикл</h2>
            <div class="lw-empty">
                <i class="fa-solid fa-moon"></i>
                <p>В этой вселенной нет течки/гона — зачатие не завязано на цикл.</p>
            </div>
        `);
        return;
    }

    const cfg = getCycleSettings();
    $('#lw_content').html(`
        <h2 class="lw-content-title">Цикл</h2>
        <div class="lw-cycle-grid" id="lw_cycle_grid"></div>
    `);
    const $grid = $('#lw_cycle_grid');
    $grid.append(renderCarrierCycleCard('user', preset, cfg));
    $grid.append(renderCarrierCycleCard('char', preset, cfg));
    bindCycleCardEvents();
}

function renderCarrierCycleCard(who, preset, cfg) {
    const data = getCharacterData(who);
    const name = carrierDisplayName(who);

    let phaseHtml;
    if (data.designation === 'omega') {
        const phase = getHeatPhase(data.cycleDay, cfg);
        phaseHtml = `<div class="lw-phase-badge lw-phase-${phase.phase}">${phase.label}</div>`;
    } else if (data.designation === 'alpha') {
        const phase = getRutPhase(data.cycleDay, cfg);
        phaseHtml = `<div class="lw-phase-badge lw-phase-${phase.phase}">${phase.label}</div>`;
    } else {
        phaseHtml = `<div class="lw-phase-badge lw-phase-normal">Бета — обычный цикл, без течки/гона</div>`;
    }

    const dayControlHtml = data.designation !== 'beta' ? `
        <div class="lw-day-control">
            <label>День цикла:</label>
            <input type="number" class="lw-input lw-day-input" data-who="${who}" min="1" value="${data.cycleDay}">
        </div>
    ` : '';

    return `
        <div class="lw-card lw-cycle-card" style="--lw-card-accent: ${preset.color}">
            <div class="lw-card-label">${name}</div>
            <select class="lw-select lw-designation-select" data-who="${who}">
                <option value="omega" ${data.designation === 'omega' ? 'selected' : ''}>Омега</option>
                <option value="beta" ${data.designation === 'beta' ? 'selected' : ''}>Бета</option>
                <option value="alpha" ${data.designation === 'alpha' ? 'selected' : ''}>Альфа</option>
            </select>
            ${phaseHtml}
            ${dayControlHtml}
        </div>
    `;
}

function bindCycleCardEvents() {
    $('.lw-designation-select').on('change', function () {
        const who = $(this).data('who');
        setDesignation(who, $(this).val());
        saveSettings();
        renderContent();
    });
    $('.lw-day-input').on('change', function () {
        const who = $(this).data('who');
        setCycleDay(who, $(this).val());
        saveSettings();
        renderContent();
    });
}

// ─── Раздел "Беременность" ───
function renderPregnancySection(preset) {
    const settings = getSettings();
    $('#lw_content').html(`
        <h2 class="lw-content-title">Беременность</h2>
        <div class="lw-cycle-grid" id="lw_pregnancy_grid"></div>
    `);
    const $grid = $('#lw_pregnancy_grid');
    $grid.append(renderPregnancyCard('user', preset, settings));
    $grid.append(renderPregnancyCard('char', preset, settings));
    bindPregnancyEvents();
}

function renderPregnancyCard(who, preset, settings) {
    const data = getCharacterData(who);
    const name = carrierDisplayName(who);
    const totalWeeks = getTotalWeeks(preset, settings.pregnancyDuration);

    let bodyHtml;
    if (!data.canCarry) {
        bodyHtml = `<p class="lw-dim-note">Не отмечен(а) как носитель в этой истории.</p>`;
    } else if (!data.pregnancy?.isPregnant) {
        bodyHtml = `<button type="button" class="lw-btn lw-start-pregnancy" data-who="${who}">Начать беременность (тест)</button>`;
    } else {
        bodyHtml = renderPregnancyProgress(data.pregnancy, preset, totalWeeks, who);
    }

    return `
        <div class="lw-card lw-pregnancy-card" style="--lw-card-accent: ${preset.color}">
            <div class="lw-card-label">${name}</div>
            <label class="lw-checkbox-row">
                <input type="checkbox" class="lw-can-carry" data-who="${who}" ${data.canCarry ? 'checked' : ''}>
                Может забеременеть в этой истории
            </label>
            <div class="lw-pregnancy-body">${bodyHtml}</div>
        </div>
    `;
}

function renderPregnancyProgress(pregnancy, preset, totalWeeks, who) {
    let barsHtml;
    if (preset.gestationType === 'staged') {
        const s1 = preset.stages.first, s2 = preset.stages.second;
        const w1 = Math.min(pregnancy.weeks, s1.weeks);
        const w2 = Math.max(0, Math.min(pregnancy.weeks - s1.weeks, s2.weeks));
        barsHtml = `
            <div class="lw-stage-bar">
                <div class="lw-stage-label">${s1.label} <span class="lw-dim">${w1}/${s1.weeks} нед.</span></div>
                <div class="lw-bar"><div class="lw-bar-fill" style="width:${(w1 / s1.weeks) * 100}%"></div></div>
            </div>
            <div class="lw-stage-bar ${pregnancy.stage === 'clutch' ? '' : 'lw-stage-pending'}">
                <div class="lw-stage-label">${s2.label} <span class="lw-dim">${w2}/${s2.weeks} нед.</span></div>
                <div class="lw-bar"><div class="lw-bar-fill" style="width:${(w2 / s2.weeks) * 100}%"></div></div>
            </div>
        `;
    } else {
        const trimester = pregnancy.weeks < 13 ? 1 : pregnancy.weeks < 27 ? 2 : 3;
        barsHtml = `
            <div class="lw-stage-bar">
                <div class="lw-stage-label">Неделя ${pregnancy.weeks} из ${totalWeeks} <span class="lw-dim">· ${trimester} триместр</span></div>
                <div class="lw-bar"><div class="lw-bar-fill" style="width:${(pregnancy.weeks / totalWeeks) * 100}%"></div></div>
            </div>
        `;
    }

    const isFullTerm = pregnancy.weeks >= totalWeeks;
    const birthVerb = preset.gestationType === 'staged' ? 'Вылупление' : 'Роды';
    const actionsHtml = isFullTerm ? `
        <button type="button" class="lw-btn lw-complete-birth" data-who="${who}">${birthVerb} — записать ${pregnancy.offspringCount} в «Ребёнок»</button>
        <button type="button" class="lw-btn lw-btn-muted lw-end-pregnancy" data-who="${who}">Сбросить без родов</button>
    ` : `
        <button type="button" class="lw-btn lw-btn-muted lw-end-pregnancy" data-who="${who}">Сбросить (тест)</button>
    `;

    return `
        ${barsHtml}
        <div class="lw-day-control">
            <label>Неделя:</label>
            <input type="number" class="lw-input lw-weeks-input" data-who="${who}" min="0" max="${totalWeeks}" value="${pregnancy.weeks}">
        </div>
        <div class="lw-day-control">
            <label>${preset.offspringLabel}:</label>
            <input type="number" class="lw-input lw-offspring-input" data-who="${who}" min="${preset.offspringRange.min}" max="${preset.offspringRange.max}" value="${pregnancy.offspringCount}">
        </div>
        ${actionsHtml}
    `;
}

function bindPregnancyEvents() {
    $('.lw-can-carry').on('change', function () {
        const who = $(this).data('who');
        setCanCarry(who, $(this).is(':checked'));
        saveSettings();
        renderContent();
    });
    $('.lw-start-pregnancy').on('click', function () {
        const who = $(this).data('who');
        startPregnancy(who);
        saveSettings();
        renderContent();
    });
    $('.lw-end-pregnancy').on('click', function () {
        const who = $(this).data('who');
        endPregnancy(who);
        saveSettings();
        renderContent();
    });
    $('.lw-complete-birth').on('click', function () {
        const who = $(this).data('who');
        completeBirth(who);
        saveSettings();
        activeSection = 'child';
        renderSidebar();
        renderContent();
    });
    $('.lw-weeks-input').on('change', function () {
        const who = $(this).data('who');
        setPregnancyWeeks(who, $(this).val());
        saveSettings();
        renderContent();
    });
    $('.lw-offspring-input').on('change', function () {
        const who = $(this).data('who');
        setOffspringCount(who, $(this).val());
        saveSettings();
        renderContent();
    });
}

// ─── Раздел "Ребёнок" ───
function renderChildSection(preset) {
    const children = getChildren();
    const grown = getGrownChildren();

    const listHtml = children.length === 0
        ? `<div class="lw-empty"><i class="fa-solid fa-child"></i><p>Пока никого нет — запись появится сама после родов/кладки в разделе «Беременность».</p></div>`
        : `<div class="lw-child-list" id="lw_child_list"></div>`;

    const grownHtml = grown.length ? `
        <h3 class="lw-content-subtitle">Архив (выросли)</h3>
        <ul class="lw-grown-list">${grown.map(c => `<li>${c.name || 'Без имени'}</li>`).join('')}</ul>
    ` : '';

    $('#lw_content').html(`
        <h2 class="lw-content-title">Ребёнок</h2>
        ${listHtml}
        ${grownHtml}
    `);

    if (children.length) {
        const $list = $('#lw_child_list');
        for (const child of children) {
            $list.append(renderChildCard(child, preset));
        }
        bindChildEvents();
    }
}

function renderChildCard(child, preset) {
    const parentName = carrierDisplayName(child.parentWho);
    const originPreset = UNIVERSE_PRESETS[child.universe] || preset;
    return `
        <div class="lw-card lw-child-card" style="--lw-card-accent: ${originPreset.color}" data-id="${child.id}">
            <input type="text" class="lw-input lw-child-name" data-id="${child.id}" placeholder="Пока без имени" value="${child.name || ''}">
            <div class="lw-dim lw-child-origin">От: ${parentName} · ${originPreset.label}</div>
            <div class="lw-day-control">
                <label>Возраст (нед.):</label>
                <input type="number" class="lw-input lw-child-age" data-id="${child.id}" min="0" value="${child.ageWeeks || 0}">
            </div>
            <textarea class="lw-input lw-child-notes" data-id="${child.id}" rows="2" placeholder="Заметки, вехи развития...">${child.notes || ''}</textarea>
            <div class="lw-child-actions">
                <button type="button" class="lw-btn lw-btn-muted lw-archive-child" data-id="${child.id}">Архивировать (вырос)</button>
                <button type="button" class="lw-btn lw-btn-muted lw-delete-child" data-id="${child.id}">Удалить</button>
            </div>
        </div>
    `;
}

function bindChildEvents() {
    $('.lw-child-name').on('change', function () {
        updateChildField($(this).data('id'), 'name', $(this).val());
        saveSettings();
    });
    $('.lw-child-age').on('change', function () {
        updateChildField($(this).data('id'), 'ageWeeks', Math.max(0, parseInt($(this).val()) || 0));
        saveSettings();
    });
    $('.lw-child-notes').on('change', function () {
        updateChildField($(this).data('id'), 'notes', $(this).val());
        saveSettings();
    });
    $('.lw-archive-child').on('click', function () {
        archiveChild($(this).data('id'));
        saveSettings();
        renderContent();
    });
    $('.lw-delete-child').on('click', function () {
        deleteChild($(this).data('id'));
        saveSettings();
        renderContent();
    });
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
        console.log('[Lifeweaver] Загружен, цикл на месте.');
    } catch (e) {
        console.error('[Lifeweaver] Ошибка загрузки:', e);
    }
});
