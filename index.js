// ═══════════════════════════════════════════
// LIFEWEAVER — точка входа
// ═══════════════════════════════════════════

import { extensionName, UNIVERSE_PRESETS, UNIVERSE_ORDER, SECTIONS, summarizePreset, getTotalWeeks, CONTRACEPTION_TYPES, buildCustomPreset } from './config.js';
import {
    getSettings, getActiveUniverse, setActiveUniverse, resetChatIdCache,
    getCharacterData, setDesignation, setCycleDay, getCycleSettings, carrierDisplayName,
    setCanCarry, startPregnancy, endPregnancy, setPregnancyWeeks, setOffspringCount,
    advanceToClutch, currentStageMaxWeeks,
    completeBirth, getChildren, getGrownChildren, updateChildField, archiveChild, deleteChild, restoreChild,
    setContraception, setShowNotifications, setHiddenPregnancy, setNumericSetting,
    getCustomPresetDraft, saveCustomPreset, disableCustomPreset, getRpDay, setRpDay,
    applyMiscarriage, applyAbortion, getLastLoss, clearLastLoss,
} from './state.js';
import { getHeatPhase, getRutPhase } from './cycle.js';
import { initAutomation, refreshRegenSnapshot, clearRegenState } from './automation.js';
import { updatePromptInjection } from './prompts.js';

const extensionFolderPath = `scripts/extensions/${extensionName}`;

let activeSection = 'overview';

// Единая точка резолвинга пресета по id вселенной — учитывает кастом
// (если настроен и включён), иначе безопасно откатывается на mpreg.
// Используется везде, КРОМЕ рендера самих вкладок сверху (там нужен ещё
// и disabled-статус кастома, см. renderUniverseTabs).
function resolvePreset(universeId) {
    if (universeId === 'custom') {
        const cp = getSettings().customPreset;
        if (cp && cp.isConfigured) return buildCustomPreset(cp);
        return UNIVERSE_PRESETS.mpreg;
    }
    return UNIVERSE_PRESETS[universeId] || UNIVERSE_PRESETS.mpreg;
}

// ─── Вкладки вселенной (верхний ряд) ───
function renderUniverseTabs() {
    const $tabs = $('#lw_universe_tabs');
    const active = getActiveUniverse();
    const customCfg = getSettings().customPreset;
    $tabs.empty();

    for (const id of UNIVERSE_ORDER) {
        let preset, disabled;
        if (id === 'custom') {
            if (customCfg && customCfg.isConfigured) {
                preset = buildCustomPreset(customCfg);
                disabled = false;
            } else {
                preset = UNIVERSE_PRESETS.custom; // статичная заглушка: label "Кастом", disabled: true
                disabled = true;
            }
        } else {
            preset = UNIVERSE_PRESETS[id];
            disabled = false;
        }

        const isActive = id === active;
        const $tab = $(`
            <button type="button" class="lw-utab ${isActive ? 'lw-utab-active' : ''} ${disabled ? 'lw-utab-disabled' : ''}"
                style="--lw-utab-color: ${preset.color}" role="tab" aria-selected="${isActive}"
                ${disabled ? 'aria-disabled="true"' : ''}>
                <span class="lw-utab-label">${preset.label}</span>
                <span class="lw-utab-sub">${preset.sublabel}</span>
            </button>
        `);
        if (!disabled) {
            $tab.on('click', () => {
                setActiveUniverse(id);
                saveSettings();
                renderUniverseTabs();
                renderContent();
            });
        } else {
            $tab.on('click', () => flashDisabledNote());
        }
        $tabs.append($tab);
    }
}

let disabledNoteTimer = null;
function flashDisabledNote() {
    const $tabs = $('#lw_universe_tabs');
    $tabs.find('.lw-utab-note').remove();
    const $note = $(`<div class="lw-utab-note">Настрой её в разделе «Настройки» → «Кастомная вселенная»</div>`);
    $tabs.append($note);
    clearTimeout(disabledNoteTimer);
    disabledNoteTimer = setTimeout(() => $note.fadeOut(200, () => $note.remove()), 2600);
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
    const preset = resolvePreset(universeId);

    if (activeSection === 'overview') {
        renderOverviewSection(preset);
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
    if (activeSection === 'tree') {
        renderTreeSection(preset);
        return;
    }
    if (activeSection === 'settings') {
        renderSettingsSection();
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

function renderOverviewSection(preset) {
    $('#lw_content').html(`
        <h2 class="lw-content-title">Обзор</h2>
        <div class="lw-card" style="--lw-card-accent: ${preset.color}">
            <div class="lw-card-label">Активная вселенная в этом чате</div>
            <div class="lw-card-value">${preset.label} <span class="lw-dim">(${preset.sublabel})</span></div>
            <div class="lw-card-sub">${summarizePreset(preset)}</div>
        </div>
        <div class="lw-card">
            <div class="lw-card-label">Автоматика</div>
            <div class="lw-day-control">
                <label>День истории:</label>
                <input type="number" class="lw-input" id="lw_rpday_input" min="0" value="${getRpDay()}">
            </div>
            <div class="lw-card-sub">Двигается тегом <code>DAYS_PASSED</code> от модели. Можно поправить руками, если накрутилось лишнего.</div>
        </div>
        <p class="lw-placeholder-note">Остальные карточки обзора (здоровье, цикл, беременность одной строкой) соберутся по мере того, как наполнятся сами разделы.</p>
    `);

    $('#lw_rpday_input').on('change', function () {
        const applied = setRpDay($(this).val());
        $(this).val(applied);
        saveSettings();
    });
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
        const loss = getLastLoss(who);
        const lossHtml = loss ? `
            <div class="lw-loss-note">
                <i class="fa-solid fa-heart-crack"></i>
                ${loss.reason === 'abortion' ? 'Беременность прервана' : 'Беременность потеряна'}
                <span class="lw-dim">· ${loss.weeks} нед. · ${loss.offspringCount} ${(loss.offspringLabel || '').toLowerCase()}</span>
                <button type="button" class="lw-btn lw-btn-muted lw-clear-loss" data-who="${who}">Скрыть</button>
            </div>
        ` : '';
        bodyHtml = lossHtml + `<button type="button" class="lw-btn lw-start-pregnancy" data-who="${who}">Начать беременность (тест)</button>`;
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
    const stageMax = currentStageMaxWeeks(preset, pregnancy);
    const isStageFullTerm = pregnancy.weeks >= stageMax;

    if (preset.gestationType === 'staged') {
        const s1 = preset.stages.first, s2 = preset.stages.second;
        const w1 = pregnancy.stage === 'formation' ? pregnancy.weeks : s1.weeks;
        const w2 = pregnancy.stage === 'clutch' ? pregnancy.weeks : 0;
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

    // Три состояния кнопок: обычная фаза / формирование завершено, пора класть/метать
    // икру (staged) / текущая фаза завершена и это уже роды-вылупление.
    let actionsHtml;
    if (preset.gestationType === 'staged' && pregnancy.stage === 'formation' && isStageFullTerm) {
        const layVerb = preset.id === 'merfolk' ? 'Нерест' : 'Кладка';
        actionsHtml = `
            <button type="button" class="lw-btn lw-lay-clutch" data-who="${who}">${layVerb} — начать инкубацию</button>
            <button type="button" class="lw-btn lw-btn-muted lw-end-pregnancy" data-who="${who}">Сбросить без кладки</button>
        `;
    } else if (isStageFullTerm) {
        const birthVerb = preset.gestationType === 'staged' ? 'Вылупление' : 'Роды';
        actionsHtml = `
            <button type="button" class="lw-btn lw-complete-birth" data-who="${who}">${birthVerb} — записать ${pregnancy.offspringCount} в «Ребёнок»</button>
            <button type="button" class="lw-btn lw-btn-muted lw-end-pregnancy" data-who="${who}">Сбросить без родов</button>
        `;
    } else {
        actionsHtml = `<button type="button" class="lw-btn lw-btn-muted lw-end-pregnancy" data-who="${who}">Сбросить (тест)</button>`;
    }

    // Прерывание доступно на любом сроке и любой стадии
    const inClutch = preset.gestationType === 'staged' && pregnancy.stage === 'clutch';
    actionsHtml += `
        <div class="lw-loss-actions">
            <button type="button" class="lw-btn lw-btn-danger lw-miscarriage" data-who="${who}">${inClutch ? 'Кладка погибла' : 'Выкидыш'}</button>
            <button type="button" class="lw-btn lw-btn-danger lw-abortion" data-who="${who}">${inClutch ? 'Уничтожить кладку' : 'Аборт'}</button>
        </div>
    `;

    const weeksLabel = preset.gestationType === 'staged' ? 'Неделя (в этой фазе):' : 'Неделя:';

    return `
        ${barsHtml}
        <div class="lw-day-control">
            <label>${weeksLabel}</label>
            <input type="number" class="lw-input lw-weeks-input" data-who="${who}" min="0" max="${stageMax}" value="${pregnancy.weeks}">
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
    $('.lw-lay-clutch').on('click', function () {
        const who = $(this).data('who');
        advanceToClutch(who);
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
    $('.lw-miscarriage').on('click', function () {
        applyMiscarriage($(this).data('who'));
        saveSettings();
        renderContent();
    });
    $('.lw-abortion').on('click', function () {
        applyAbortion($(this).data('who'));
        saveSettings();
        renderContent();
    });
    $('.lw-clear-loss').on('click', function () {
        clearLastLoss($(this).data('who'));
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
        <div class="lw-grown-list" id="lw_grown_list"></div>
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
    }
    if (grown.length) {
        const $grownList = $('#lw_grown_list');
        for (const child of grown) {
            $grownList.append(renderGrownRow(child));
        }
    }
    bindChildEvents();
}

function renderGrownRow(child) {
    return `
        <div class="lw-grown-row" data-id="${child.id}">
            <span>${child.name || 'Без имени'}</span>
            <div class="lw-grown-actions">
                <button type="button" class="lw-btn lw-btn-muted lw-restore-child" data-id="${child.id}">Вернуть</button>
                <button type="button" class="lw-btn lw-btn-muted lw-delete-child" data-id="${child.id}">Удалить</button>
            </div>
        </div>
    `;
}

function renderChildCard(child, preset) {
    const parentName = carrierDisplayName(child.parentWho);
    const originPreset = resolvePreset(child.universe);
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
    $('.lw-restore-child').on('click', function () {
        restoreChild($(this).data('id'));
        saveSettings();
        renderContent();
    });
    $('.lw-delete-child').on('click', function () {
        deleteChild($(this).data('id'));
        saveSettings();
        renderContent();
    });
}

// ─── Раздел "Семейное древо" ───
function designationLabel(designation) {
    if (designation === 'omega') return 'Омега';
    if (designation === 'alpha') return 'Альфа';
    return 'Бета';
}

function renderParentNode(who, preset) {
    const data = getCharacterData(who);
    const name = carrierDisplayName(who);
    const tag = preset.cycleSystem === 'abo' ? `<div class="lw-tree-tag">${designationLabel(data.designation)}</div>` : '';
    const carrierMark = data.canCarry ? `<div class="lw-tree-sub">Может выносить</div>` : '';
    return `
        <div class="lw-tree-node" style="--lw-card-accent: ${preset.color}">
            <div class="lw-tree-name">${name}</div>
            ${tag}
            ${carrierMark}
        </div>
    `;
}

function renderPendingNode(who, preset) {
    const data = getCharacterData(who);
    const pregnancy = data.pregnancy;
    const stageMax = currentStageMaxWeeks(preset, pregnancy);
    const stageLabel = preset.gestationType === 'staged'
        ? (pregnancy.stage === 'clutch' ? preset.stages.second.label : preset.stages.first.label)
        : 'Беременность';
    return `
        <div class="lw-tree-node lw-tree-node-pending" style="--lw-card-accent: ${preset.color}">
            <div class="lw-tree-name">Ожидается</div>
            <div class="lw-tree-tag">${stageLabel} · ${pregnancy.weeks}/${stageMax} нед.</div>
            <div class="lw-tree-sub">от ${carrierDisplayName(who)} · ${preset.offspringLabel.toLowerCase()}: ${pregnancy.offspringCount}</div>
        </div>
    `;
}

function renderTreeChildNode(child, grown, preset) {
    const originPreset = resolvePreset(child.universe);
    return `
        <div class="lw-tree-node ${grown ? 'lw-tree-node-grown' : ''}" style="--lw-card-accent: ${originPreset.color}">
            <div class="lw-tree-name">${child.name || 'Без имени'}</div>
            <div class="lw-tree-tag">${grown ? 'Взрослый' : `${child.ageWeeks || 0} нед.`}</div>
        </div>
    `;
}

function renderTreeSection(preset) {
    const userData = getCharacterData('user');
    const charData = getCharacterData('char');
    const children = getChildren();
    const grown = getGrownChildren();

    const parentsHtml = renderParentNode('user', preset) + renderParentNode('char', preset);

    const pendingHtml = [
        userData.pregnancy?.isPregnant ? renderPendingNode('user', preset) : '',
        charData.pregnancy?.isPregnant ? renderPendingNode('char', preset) : '',
    ].join('');

    const childrenHtml = children.map(c => renderTreeChildNode(c, false, preset)).join('')
        + grown.map(c => renderTreeChildNode(c, true, preset)).join('');

    const hasAnyChildren = pendingHtml || childrenHtml;

    $('#lw_content').html(`
        <h2 class="lw-content-title">Семейное древо</h2>
        <div class="lw-tree">
            <div class="lw-tree-row">${parentsHtml}</div>
            <div class="lw-tree-connector"></div>
            <div class="lw-tree-row lw-tree-children">
                ${hasAnyChildren ? pendingHtml + childrenHtml : '<div class="lw-tree-empty">Пока никого нет</div>'}
            </div>
        </div>
    `);
}

// ─── Раздел "Настройки" ───
function renderContraceptionCard(who) {
    const name = carrierDisplayName(who);
    const current = getCharacterData(who).contraception || 'none';
    const options = Object.values(CONTRACEPTION_TYPES).map(c => `
        <option value="${c.id}" ${c.id === current ? 'selected' : ''}>${c.label}${c.chance ? ` (${c.chance}%)` : ''}</option>
    `).join('');
    return `
        <div class="lw-card">
            <div class="lw-card-label">${name}</div>
            <select class="lw-select lw-contraception-select" data-who="${who}">${options}</select>
        </div>
    `;
}

function renderSettingsSection() {
    const s = getSettings();
    customDraft = getCustomPresetDraft();

    $('#lw_content').html(`
        <h2 class="lw-content-title">Настройки</h2>

        <div class="lw-settings-group">
            <h3 class="lw-content-subtitle">Контрацепция</h3>
            <div class="lw-cycle-grid">
                ${renderContraceptionCard('user')}
                ${renderContraceptionCard('char')}
            </div>
            <p class="lw-placeholder-note">Пока просто хранится — сама механика зачатия (шанс на успех/провал защиты) появится на Этапе 9.</p>
        </div>

        <div class="lw-settings-group">
            <h3 class="lw-content-subtitle">Общее</h3>
            <label class="lw-checkbox-row">
                <input type="checkbox" id="lw_setting_notifications" ${s.showNotifications ? 'checked' : ''}>
                Показывать уведомления о событиях
            </label>
            <label class="lw-checkbox-row">
                <input type="checkbox" id="lw_setting_hidden_pregnancy" ${s.hiddenPregnancy ? 'checked' : ''}>
                Скрытая беременность — герой не знает о зачатии, пока не заметит сам
            </label>
        </div>

        <div class="lw-settings-group">
            <h3 class="lw-content-subtitle">Длительности циклов и беременности</h3>
            <div class="lw-settings-numeric-grid">
                <label>Длина цикла течки (дн.)
                    <input type="number" class="lw-input" id="lw_setting_heatCycleLength" min="7" value="${s.heatCycleLength}">
                </label>
                <label>Длительность течки (дн.)
                    <input type="number" class="lw-input" id="lw_setting_heatDuration" min="1" value="${s.heatDuration}">
                </label>
                <label>Длина цикла гона (дн.)
                    <input type="number" class="lw-input" id="lw_setting_rutCycleLength" min="7" value="${s.rutCycleLength}">
                </label>
                <label>Длительность гона (дн.)
                    <input type="number" class="lw-input" id="lw_setting_rutDuration" min="1" value="${s.rutDuration}">
                </label>
                <label>Обычная беременность (нед.)
                    <input type="number" class="lw-input" id="lw_setting_pregnancyDuration" min="1" value="${s.pregnancyDuration}">
                </label>
            </div>
            <p class="lw-placeholder-note">Фазы драконов/мерфолка (формирование → кладка/инкубация) настраиваются отдельно, в конструкторе кастомной вселенной.</p>
        </div>

        <div class="lw-settings-group">
            <h3 class="lw-content-subtitle">Кастомная вселенная</h3>
            ${renderCustomPresetForm(customDraft)}
        </div>
    `);

    bindSettingsEvents();
}

// ── Конструктор кастомной вселенной (5-й слот) ──
let customDraft = null;

function renderCustomGestationFields(draft) {
    if (draft.gestationType === 'staged') {
        return `
            <div class="lw-custom-grid">
                <label>Название фазы 1
                    <input type="text" class="lw-input" id="lw_custom_stage1_label" value="${draft.stages?.first?.label ?? 'Формирование'}">
                </label>
                <label>Недель (фаза 1)
                    <input type="number" class="lw-input" id="lw_custom_stage1_weeks" min="1" value="${draft.stages?.first?.weeks ?? 20}">
                </label>
                <label>Название фазы 2
                    <input type="text" class="lw-input" id="lw_custom_stage2_label" value="${draft.stages?.second?.label ?? 'Кладка и инкубация'}">
                </label>
                <label>Недель (фаза 2)
                    <input type="number" class="lw-input" id="lw_custom_stage2_weeks" min="1" value="${draft.stages?.second?.weeks ?? 20}">
                </label>
            </div>
        `;
    }
    return `
        <div class="lw-custom-grid">
            <label>Длительность беременности (нед.)
                <input type="number" class="lw-input" id="lw_custom_pregnancyDuration" min="1" value="${draft.pregnancyDuration ?? 40}">
            </label>
        </div>
    `;
}

function renderCustomPresetForm(draft) {
    return `
        <p class="lw-placeholder-note">${draft.isConfigured ? 'Активна как 5-я вкладка вверху.' : 'Заполни поля и сохрани, чтобы включить 5-ю вкладку вселенной.'}</p>

        <div class="lw-custom-grid">
            <label>Название
                <input type="text" class="lw-input" id="lw_custom_label" value="${draft.label || ''}" placeholder="Например: Осьминожки">
            </label>
            <label>Подпись (короткая)
                <input type="text" class="lw-input" id="lw_custom_sublabel" value="${draft.sublabel || ''}" placeholder="Например: Сперматофор">
            </label>
            <label>Цвет метки
                <input type="color" class="lw-input lw-color-input" id="lw_custom_color" value="${draft.color || '#5a5850'}">
            </label>
            <label>Система цикла
                <select class="lw-select" id="lw_custom_cycleSystem">
                    <option value="none" ${draft.cycleSystem === 'none' ? 'selected' : ''}>Без цикла (mpreg)</option>
                    <option value="abo" ${draft.cycleSystem === 'abo' ? 'selected' : ''}>Течка/гон (ABO)</option>
                </select>
            </label>
            <label>Тип вынашивания
                <select class="lw-select" id="lw_custom_gestationType">
                    <option value="live" ${draft.gestationType === 'live' ? 'selected' : ''}>Обычная беременность (одна фаза)</option>
                    <option value="staged" ${draft.gestationType === 'staged' ? 'selected' : ''}>Две фазы (формирование → кладка/инкубация)</option>
                </select>
            </label>
        </div>

        <div id="lw_custom_gestation_fields">${renderCustomGestationFields(draft)}</div>

        <div class="lw-custom-grid">
            <label>Мин. потомства
                <input type="number" class="lw-input" id="lw_custom_offspring_min" min="1" value="${draft.offspringRange?.min ?? 1}">
            </label>
            <label>Макс. потомства
                <input type="number" class="lw-input" id="lw_custom_offspring_max" min="1" value="${draft.offspringRange?.max ?? 1}">
            </label>
            <label>Название потомства в UI
                <input type="text" class="lw-input" id="lw_custom_offspring_label" value="${draft.offspringLabel || ''}" placeholder="Например: Сперматофоров">
            </label>
        </div>

        <div class="lw-child-actions" style="margin-top: 12px;">
            <button type="button" class="lw-btn" id="lw_custom_save">Сохранить и включить</button>
            ${draft.isConfigured ? `<button type="button" class="lw-btn lw-btn-muted" id="lw_custom_disable">Выключить кастом</button>` : ''}
        </div>
    `;
}

function readDraftFromForm() {
    customDraft.label = $('#lw_custom_label').val();
    customDraft.sublabel = $('#lw_custom_sublabel').val();
    customDraft.color = $('#lw_custom_color').val();
    customDraft.cycleSystem = $('#lw_custom_cycleSystem').val();
    customDraft.gestationType = $('#lw_custom_gestationType').val();
    if (customDraft.gestationType === 'staged') {
        customDraft.stages = {
            first: { label: $('#lw_custom_stage1_label').val(), weeks: $('#lw_custom_stage1_weeks').val() },
            second: { label: $('#lw_custom_stage2_label').val(), weeks: $('#lw_custom_stage2_weeks').val() },
        };
    } else {
        customDraft.pregnancyDuration = $('#lw_custom_pregnancyDuration').val();
    }
    customDraft.offspringRange = { min: $('#lw_custom_offspring_min').val(), max: $('#lw_custom_offspring_max').val() };
    customDraft.offspringLabel = $('#lw_custom_offspring_label').val();
}

function bindCustomPresetEvents() {
    $('#lw_custom_gestationType').on('change', function () {
        readDraftFromForm();
        $('#lw_custom_gestation_fields').html(renderCustomGestationFields(customDraft));
    });
    $('#lw_custom_save').on('click', function () {
        readDraftFromForm();
        saveCustomPreset(customDraft);
        saveSettings();
        customDraft = getCustomPresetDraft();
        renderUniverseTabs();
        renderSettingsSection();
    });
    $('#lw_custom_disable').on('click', function () {
        disableCustomPreset();
        saveSettings();
        customDraft = getCustomPresetDraft();
        renderUniverseTabs();
        renderContent();
    });
}

function bindSettingsEvents() {
    $('#lw_setting_notifications').on('change', function () {
        setShowNotifications($(this).is(':checked'));
        saveSettings();
    });
    $('#lw_setting_hidden_pregnancy').on('change', function () {
        setHiddenPregnancy($(this).is(':checked'));
        saveSettings();
    });
    $('.lw-contraception-select').on('change', function () {
        setContraception($(this).data('who'), $(this).val());
        saveSettings();
    });

    const numericFields = [
        { key: 'heatCycleLength', min: 7 },
        { key: 'heatDuration', min: 1 },
        { key: 'rutCycleLength', min: 7 },
        { key: 'rutDuration', min: 1 },
        { key: 'pregnancyDuration', min: 1 },
    ];
    for (const { key, min } of numericFields) {
        $(`#lw_setting_${key}`).on('change', function () {
            const applied = setNumericSetting(key, $(this).val(), min);
            $(this).val(applied);
            saveSettings();
        });
    }

    bindCustomPresetEvents();
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

    // Автоматика поменяла состояние (пришёл тег от модели) — обновляем то,
    // что сейчас на экране, чтобы не приходилось переключать вкладки руками.
    document.addEventListener('lifeweaver:state-changed', () => {
        if ($('#lw_modal_overlay').hasClass('lw-open')) {
            renderUniverseTabs();
            renderContent();
        }
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
            // Снапшоты и позиции скана из прошлого чата не должны пережить переход,
            // иначе состояние утекает между чатами.
            clearRegenState();
            updatePromptInjection();
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
    // Промпт зависит почти от всего состояния (вселенная, designation, canCarry,
    // беременность, контрацепция) — проще освежать его в одной точке после
    // каждого изменения, чем расставлять вызов по всем обработчикам вручную.
    try {
        updatePromptInjection();
    } catch (e) {
        console.warn('[Lifeweaver] Не удалось обновить промпт:', e);
    }
    // Фиксируем ручную правку в снапшоте — иначе следующий свайп/реген
    // откатит её к состоянию до последнего скана ("поставил, отправил, сбросилось").
    try {
        refreshRegenSnapshot();
    } catch (e) { /* ignore */ }
}

jQuery(async () => {
    try {
        const settingsHtml = await $.get(`${extensionFolderPath}/settings.html`);
        $('#extensions_settings2').append(settingsHtml);
        bindSettingsUI();
        initAutomation();
        updatePromptInjection();
        console.log('[Lifeweaver] Загружен, автоматика подключена.');
    } catch (e) {
        console.error('[Lifeweaver] Ошибка загрузки:', e);
    }
});
