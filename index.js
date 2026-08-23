// ═══════════════════════════════════════════
// LIFEWEAVER — точка входа
// ═══════════════════════════════════════════

import { extensionName, UNIVERSE_PRESETS, UNIVERSE_ORDER, SECTIONS, summarizePreset, getTotalWeeks, CONTRACEPTION_TYPES, buildCustomPreset, termsOf } from './config.js';
import {
    getSettings, getActiveUniverse, setActiveUniverse, resetChatIdCache,
    getCharacterData, setDesignation, setCycleDay, getCycleSettings, carrierDisplayName,
    setCanCarry, startPregnancy, endPregnancy, setPregnancyWeeks, setOffspringCount,
    applyLayClutch, currentStageMaxWeeks,
    completeBirth, getChildren, getGrownChildren, updateChildField, archiveChild, deleteChild, restoreChild,
    setContraception, setShowNotifications, setHiddenPregnancy, setNumericSetting,
    getCustomPresetDraft, saveCustomPreset, disableCustomPreset, getRpDay, setRpDay,
    applyMiscarriage, applyAbortion, getLastLoss, clearLastLoss, revealOffspringSex,
    blockRemaining, clearResurrectionBlocks, getTimeOfDay, setTimeOfDay, getRpTime, setRpTime, getTimeForCare,
    isTrying, setTrying, monthsTrying, conceptionStruggle, getFertilityAid, setFertilityAid, clearFertilityAid,
    getClutches, setClutchWeeks, hatchClutch, removeClutch, migrateLegacyClutch,
    getHealthHolders, doctorVisit, takeTest, getCurrentChatId, addExistingChild,
    getLooks, setLooks, getPostpartum, setLactating, clearPostpartum, getDynamic, getChildDynamic,
    getCyclePhase, getAvatarUrl,
    createUndoCheckpoint, undoLastChange, canUndo, lastUndoLabel,
} from './state.js';
import { getHeatPhase, getRutPhase } from './cycle.js';
import { childAgeDays, getGrowthStage, getCareNorms, getCareNeeds, getMilestoneProgress, formatAge, sexLabel, TIME_BUCKETS } from './baby-care.js';
import { initAutomation, refreshRegenSnapshot, clearRegenState, getLastScanDebug } from './automation.js';
import { showBirthDialog, showNotification } from './notifications.js';
import { renderInfoblock } from './infoblock.js';
import { scanFullHistory, estimateHistory } from './history-scan.js';
import { activeComplications, getHealthInfo, TEST_LABELS, EYE_OPTIONS, HAIR_OPTIONS, bodyPoolFor } from './health.js';
import { getSymptoms, getRecommendation, getCycleState } from './symptoms.js';
import { updatePromptInjection, buildPrompt } from './prompts.js';

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
// Свой CSS инфоблока держим отдельным тегом, чтобы переписывать целиком
function injectCustomInfoblockCss() {
    try {
        let tag = document.getElementById('lw_custom_infoblock_css');
        if (!tag) {
            tag = document.createElement('style');
            tag.id = 'lw_custom_infoblock_css';
            document.head.appendChild(tag);
        }
        tag.textContent = getSettings().customInfoblockCss || '';
    } catch (e) { /* ignore */ }
}

// Кнопка отмены активна только когда есть что отменять, и подсказывает что именно
function refreshUndoButton() {
    const $btn = $('#lw_undo');
    if (!$btn.length) return;
    const label = lastUndoLabel();
    $btn.prop('disabled', !label);
    $btn.attr('title', label ? `Отменить: ${label}` : 'Нечего отменять');
    $btn.toggleClass('lw-undo-ready', !!label);
}

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
    if (activeSection === 'health') {
        renderHealthSection(preset);
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

function avatarHtml(who, size = 'md') {
    const url = getAvatarUrl(who);
    const name = carrierDisplayName(who);
    const initial = (name || '?').trim().charAt(0).toUpperCase();
    return url
        ? `<div class="lw-av lw-av-${size}"><img src="${url}" alt="" onerror="this.parentNode.textContent='${initial}'"></div>`
        : `<div class="lw-av lw-av-${size} lw-av-ph">${initial}</div>`;
}

function childAvatarHtml(child) {
    const icon = child.sex === 'M' ? 'fa-mars' : child.sex === 'F' ? 'fa-venus' : 'fa-baby';
    const tone = child.sex === 'M' ? 'blue' : child.sex === 'F' ? 'pink' : 'neutral';
    return `<div class="lw-av lw-av-sm lw-av-ph lw-av-${tone}"><i class="fa-solid ${icon}"></i></div>`;
}

// Карточка-превью: клик уводит в свой раздел
function tile(section, title, bodyHtml, opts = {}) {
    return `
        <div class="lw-tile ${opts.wide ? 'lw-tile-wide' : ''}" data-goto="${section}" style="${opts.accent ? `--lw-card-accent:${opts.accent}` : ''}">
            <div class="lw-tile-head">
                <span class="lw-tile-title">${title}</span>
                <span class="lw-tile-go"><i class="fa-solid fa-arrow-right"></i></span>
            </div>
            ${bodyHtml}
        </div>
    `;
}

function chip(label, value, tone = '') {
    return `<div class="lw-chip ${tone}"><span class="lw-chip-l">${label}</span><span class="lw-chip-v">${value}</span></div>`;
}

// ── Кто отслеживается ──
function carrierTile(preset) {
    const rows = ['user', 'char'].map(who => {
        const c = getCharacterData(who);
        const badge = preset.cycleSystem === 'abo'
            ? `<span class="lw-tile-sub">${designationLabel(c.designation)}</span>` : '';
        return `
            <div class="lw-person">
                ${avatarHtml(who)}
                <div>
                    <div class="lw-person-name">${carrierDisplayName(who)}</div>
                    ${badge}
                    <div class="lw-person-note">${c.canCarry ? 'может вынашивать' : 'не носитель'}</div>
                </div>
            </div>
        `;
    }).join('');
    return tile('pregnancy', 'Кто отслеживается', `<div class="lw-persons">${rows}</div>`, { accent: preset.color });
}

// ── Цикл ──
function cycleTile(preset) {
    if (preset.cycleSystem !== 'abo') {
        return tile('cycle', 'Цикл', `<div class="lw-tile-big">Нет цикла</div>
            <div class="lw-tile-sub">В этой вселенной зачатие не завязано на течку</div>`);
    }
    const parts = ['user', 'char'].map(who => {
        const phase = getCyclePhase(who);
        if (!phase) return '';
        const c = getCharacterData(who);
        const st = getCycleState(phase.key, phase.day, c.cycleDay);
        const hot = phase.key === 'heat' || phase.key === 'rut';
        return `
            <div class="lw-cyc ${hot ? 'lw-cyc-hot' : ''}">
                <div class="lw-cyc-top">${carrierDisplayName(who)}</div>
                <div class="lw-tile-big">${st.label}</div>
                ${phase.len ? `<div class="lw-tile-sub">День ${phase.day} / ${phase.len}</div>
                    <div class="lw-bar"><div class="lw-bar-fill" style="width:${(phase.day / phase.len) * 100}%"></div></div>` : ''}
                ${phase.daysLeft !== null && !hot ? `<div class="lw-tile-sub">${phase.kind === 'rut' ? 'до гона' : 'до течки'} ${phase.daysLeft} дн.</div>` : ''}
            </div>
        `;
    }).filter(Boolean).join('');
    return tile('cycle', 'Цикл', `<div class="lw-cycs">${parts}</div>`, { accent: preset.color });
}

// ── Краткое состояние: живое от модели, иначе — по фазе цикла ──
function stateTile(preset) {
    const chips = [];
    for (const who of ['user', 'char']) {
        const c = getCharacterData(who);
        const dyn = getDynamic(who);
        const name = carrierDisplayName(who);

        if (c.pregnancy?.isPregnant) {
            const info = getHealthInfo(c.pregnancy.healthStatus || 'normal');
            chips.push(chip(`${name} · здоровье`, info.text, `lw-chip-${info.tone}`));
            if (dyn.mood) chips.push(chip(`${name} · настроение`, dyn.mood));
            if (dyn.libido) chips.push(chip(`${name} · либидо`, dyn.libido));
            if (dyn.physical) chips.push(chip(`${name} · тело`, dyn.physical));
        } else {
            const phase = getCyclePhase(who);
            if (!phase || phase.key === 'beta') continue;
            const st = getCycleState(phase.key, phase.day, c.cycleDay);
            const hot = phase.key === 'heat' || phase.key === 'rut';
            chips.push(chip(`${name} · настроение`, st.mood, hot ? 'lw-chip-warning' : ''));
            chips.push(chip(`${name} · либидо`, st.libido, hot ? 'lw-chip-warning' : ''));
            chips.push(chip(`${name} · энергия`, st.energy));
        }
    }
    if (!chips.length) chips.push(chip('Состояние', 'ничего не отслеживается'));
    return tile('health', 'Краткое состояние', `<div class="lw-chips">${chips.join('')}</div>`, { accent: preset.color });
}

// ── Беременность и кладки ──
function pregnancyTile(preset) {
    const blocks = [];
    for (const who of ['user', 'char']) {
        const p = getCharacterData(who).pregnancy;
        if (!p?.isPregnant) continue;
        const max = currentStageMaxWeeks(preset, p);
        const hidden = getSettings().hiddenPregnancy && !isPregnancyObvious(who);
        const dyn = getDynamic(who);
        const stage = preset.gestationType === 'staged' ? preset.stages.first.label : 'Беременность';
        blocks.push(`
            <div class="lw-preg">
                <div class="lw-preg-top">${avatarHtml(who, 'sm')}<span>${carrierDisplayName(who)}</span></div>
                <div class="lw-tile-big">${hidden ? '—' : `${p.weeks} нед.`}</div>
                <div class="lw-tile-sub">${hidden ? 'ещё не знает' : `${stage} · до конца ${max - p.weeks} нед.`}</div>
                <div class="lw-bar"><div class="lw-bar-fill" style="width:${hidden ? 0 : (p.weeks / max) * 100}%"></div></div>
                ${!hidden && (dyn.fetus_size || dyn.clutch_size) ? `<div class="lw-tile-sub">${dyn.fetus_size || dyn.clutch_size}</div>` : ''}
            </div>
        `);
    }
    for (const cl of getClutches()) {
        const op = resolvePreset(cl.universe);
        blocks.push(`
            <div class="lw-preg">
                <div class="lw-preg-top"><i class="fa-solid fa-egg"></i><span>${termsOf(op).clutch}</span></div>
                <div class="lw-tile-big">${cl.weeks} нед.</div>
                <div class="lw-tile-sub">${cl.offspringCount} ${(op.offspringLabel || '').toLowerCase()} · до вылупления ${cl.totalWeeks - cl.weeks} нед.</div>
                <div class="lw-bar"><div class="lw-bar-fill" style="width:${(cl.weeks / cl.totalWeeks) * 100}%"></div></div>
            </div>
        `);
    }
    if (!blocks.length) {
        blocks.push(`<div class="lw-tile-sub">Сейчас никто не вынашивает</div>`);
    }
    return tile('pregnancy', 'Беременность', `<div class="lw-pregs">${blocks.join('')}</div>`,
        { wide: true, accent: preset.color });
}

// ── Дети ──
function childrenTile(preset) {
    const children = getChildren();
    if (!children.length) {
        return tile('child', 'Дети', `<div class="lw-tile-sub">Пока никого</div>`, { accent: preset.color });
    }
    const rows = children.slice(0, 4).map(child => {
        const days = childAgeDays(child);
        const stage = getGrowthStage(days);
        const cd = getChildDynamic(child.id);
        const needs = getCareNeeds(days, getTimeForCare(), child, getRpDay());
        return `
            <div class="lw-person">
                ${childAvatarHtml(child)}
                <div>
                    <div class="lw-person-name">${child.name || 'Без имени'}</div>
                    <div class="lw-tile-sub">${formatAge(days)}${stage ? ` · ${stage.label}` : ''}</div>
                    <div class="lw-person-note">${cd.mood || cd.sleep || needs.sleep}</div>
                </div>
            </div>
        `;
    }).join('');
    const more = children.length > 4 ? `<div class="lw-tile-sub">…и ещё ${children.length - 4}</div>` : '';
    return tile('child', 'Дети', `<div class="lw-persons">${rows}</div>${more}`, { accent: preset.color });
}

// ── Семейное древо (превью) ──
function treeTile(preset) {
    const kids = [...getChildren(), ...getGrownChildren()];
    const parents = ['user', 'char'].map(who => `
        <div class="lw-tt-node">${avatarHtml(who, 'sm')}<span>${carrierDisplayName(who)}</span></div>
    `).join('');
    const kidNodes = kids.slice(0, 5).map(c => `
        <div class="lw-tt-node lw-tt-kid">${childAvatarHtml(c)}<span>${c.name || '—'}</span></div>
    `).join('');
    return tile('tree', 'Семейное древо', `
        <div class="lw-tt-row">${parents}</div>
        ${kidNodes ? `<div class="lw-tt-line"></div><div class="lw-tt-row">${kidNodes}</div>` : ''}
        ${kids.length > 5 ? `<div class="lw-tile-sub">…и ещё ${kids.length - 5}</div>` : ''}
    `, { wide: true, accent: preset.color });
}

function renderOverviewSection(preset) {
    $('#lw_content').html(`
        <div class="lw-overview">
            ${carrierTile(preset)}
            ${cycleTile(preset)}
            ${stateTile(preset)}
            ${pregnancyTile(preset)}
            ${childrenTile(preset)}
            ${treeTile(preset)}
        </div>
        <div class="lw-ov-foot">
            <span class="lw-dim">День истории: ${getRpDay()}${getRpTime() ? ` · ${getRpTime()}` : ''}</span>
            <span class="lw-dim">${summarizePreset(preset)}</span>
        </div>
    `);

    // Клик по карточке уводит в её раздел
    $('.lw-tile').on('click', function () {
        const target = $(this).data('goto');
        if (!target) return;
        activeSection = target;
        renderSidebar();
        renderContent();
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
function renderTryingPanel(preset) {
    const on = isTrying();
    const months = monthsTrying();
    const struggle = conceptionStruggle(months);

    // Контрацепция и планирование противоречат друг другу — подсказываем,
    // но не мешаем: выставлять настройки это дело игрока.
    const conflicted = on ? ['user', 'char'].filter(w => {
        const c = getCharacterData(w);
        return c.canCarry && (c.contraception || 'none') !== 'none';
    }) : [];

    // Средства (пилюли, зелья, ритуалы) — атрибут вселенных БЕЗ цикла: там
    // мужская беременность редка и требует вмешательства. В омегаверсе,
    // у драконов и мерфолка фертильность даёт течка, средства не нужны.
    const aidsAllowed = preset.cycleSystem !== 'abo';
    const aidsHtml = !aidsAllowed ? '' : ['user', 'char'].filter(w => getCharacterData(w).canCarry).map(w => {
        const aid = getFertilityAid(w);
        return `
            <div class="lw-aid-row">
                <span class="lw-dim">${carrierDisplayName(w)}:</span>
                <input type="text" class="lw-input lw-aid-label" data-who="${w}"
                       placeholder="пилюля, зелье, ритуал…" value="${aid?.label || ''}">
                <input type="number" class="lw-input lw-aid-days" data-who="${w}" min="0"
                       placeholder="дн." title="Сколько дней действует (пусто — бессрочно)"
                       value="${aid?.untilRpDay !== null && aid?.untilRpDay !== undefined ? Math.max(0, aid.untilRpDay - getRpDay()) : ''}">
                ${aid ? `<button type="button" class="lw-btn lw-btn-muted lw-aid-clear" data-who="${w}">Снять</button>` : ''}
            </div>
        `;
    }).join('');

    return `
        <div class="lw-card lw-trying-card ${on ? 'lw-trying-on' : ''}">
            <label class="lw-checkbox-row">
                <input type="checkbox" id="lw_trying_toggle" ${on ? 'checked' : ''}>
                Планируем ребёнка
            </label>
            ${on ? `
                <div class="lw-dim" style="font-size:0.78rem;">
                    Пытаются ${months > 0 ? `~${months} мес.` : 'недавно'}${preset.cycleSystem === 'abo' ? ' · окно фертильности — течка' : ' · цикла нет, фертильность ровная'}
                </div>
                ${struggle ? `<div class="lw-struggle-note"><i class="fa-solid fa-hourglass-half"></i> ${struggle.label}</div>` : ''}
                ${conflicted.length ? `<div class="lw-struggle-note"><i class="fa-solid fa-triangle-exclamation"></i> Контрацепция включена у: ${conflicted.map(carrierDisplayName).join(', ')}</div>` : ''}
                ${aidsAllowed ? `
                    <div class="lw-card-label" style="margin-top:8px;">Средства фертильности</div>
                    ${aidsHtml || '<div class="lw-dim">Никто не отмечен носителем.</div>'}
                ` : ''}
            ` : ''}
        </div>
    `;
}

function renderClutchCard(clutch, preset) {
    const parentName = carrierDisplayName(clutch.parentWho);
    const originPreset = resolvePreset(clutch.universe);
    const label = originPreset.gestationType === 'staged' ? originPreset.stages.second.label : 'Инкубация';
    const ready = clutch.weeks >= clutch.totalWeeks;
    return `
        <div class="lw-card lw-clutch-card" style="--lw-card-accent: ${originPreset.color}">
            <div class="lw-card-label">${label} · от ${parentName}</div>
            <div class="lw-stage-bar">
                <div class="lw-stage-label">${clutch.weeks}/${clutch.totalWeeks} нед. · ${clutch.offspringCount} ${(originPreset.offspringLabel || '').toLowerCase()}</div>
                <div class="lw-bar"><div class="lw-bar-fill" style="width:${(clutch.weeks / clutch.totalWeeks) * 100}%"></div></div>
            </div>
            <div class="lw-day-control">
                <label>Неделя:</label>
                <input type="number" class="lw-input lw-clutch-weeks" data-id="${clutch.id}" min="0" max="${clutch.totalWeeks}" value="${clutch.weeks}">
            </div>
            <div class="lw-symptoms">
                <div class="lw-card-label">Состояние кладки</div>
                ${getSymptoms('clutch', Math.round((clutch.weeks / Math.max(1, clutch.totalWeeks)) * 100), clutch.weeks, termsOf(originPreset)).map(s => `<div>• ${s}</div>`).join('')}
                <div class="lw-rec"><i class="fa-solid fa-lightbulb"></i> ${getRecommendation('clutch', Math.round((clutch.weeks / Math.max(1, clutch.totalWeeks)) * 100), termsOf(originPreset))}</div>
            </div>
            <div class="lw-child-actions">
                <button type="button" class="lw-btn lw-hatch-clutch" data-id="${clutch.id}" ${ready ? '' : 'disabled'}>
                    Вылупление — записать ${clutch.offspringCount}
                </button>
                <button type="button" class="lw-btn lw-btn-danger lw-clutch-lost" data-id="${clutch.id}">Кладка погибла</button>
            </div>
        </div>
    `;
}

function renderPregnancySection(preset) {
    const settings = getSettings();
    const clutches = getClutches();
    $('#lw_content').html(`
        <h2 class="lw-content-title">Беременность</h2>
        ${renderTryingPanel(preset)}
        <div class="lw-cycle-grid" id="lw_pregnancy_grid"></div>
        ${clutches.length ? `<h3 class="lw-content-subtitle">Инкубация</h3><div class="lw-cycle-grid" id="lw_clutch_grid"></div>` : ''}
    `);
    const $grid = $('#lw_pregnancy_grid');
    $grid.append(renderPregnancyCard('user', preset, settings));
    $grid.append(renderPregnancyCard('char', preset, settings));
    if (clutches.length) {
        const $cg = $('#lw_clutch_grid');
        for (const c of clutches) $cg.append(renderClutchCard(c, preset));
    }
    bindPregnancyEvents();
}

// Текст плашки потери: на стадии инкубации потеряна кладка, а не «беременность»
function lossTitle(loss, preset) {
    const wasClutch = loss.stage === 'clutch';
    if (loss.reason === 'abortion') return wasClutch ? 'Кладка уничтожена' : 'Беременность прервана';
    return wasClutch ? 'Кладка погибла' : 'Беременность потеряна';
}

function renderPregnancyCard(who, preset, settings) {
    const data = getCharacterData(who);
    const name = carrierDisplayName(who);
    const totalWeeks = getTotalWeeks(preset, settings.pregnancyDuration);

    let bodyHtml;
    if (!data.canCarry) {
        bodyHtml = `<p class="lw-dim-note">Не отмечен(а) как носитель в этой истории.</p>`;
    } else if (!data.pregnancy?.isPregnant) {
        // Если у носителя есть живая кладка — плашка о прошлой потере только
        // путает: рядом же лежит вполне здоровое потомство.
        const hasClutch = getClutches().some(c => c.parentWho === who);
        const loss = hasClutch ? null : getLastLoss(who);
        const lossHtml = loss ? `
            <div class="lw-loss-note">
                <i class="fa-solid fa-heart-crack"></i>
                ${lossTitle(loss, preset)}
                <span class="lw-dim">· ${loss.weeks} нед. · ${loss.offspringCount}</span>
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
        // Беременность у двухфазных = только формирование; инкубация живёт
        // отдельной карточкой (кладка уже снаружи тела).
        const s1 = preset.stages.first;
        barsHtml = `
            <div class="lw-stage-bar">
                <div class="lw-stage-label">${s1.label} <span class="lw-dim">${pregnancy.weeks}/${s1.weeks} нед.</span></div>
                <div class="lw-bar"><div class="lw-bar-fill" style="width:${(pregnancy.weeks / s1.weeks) * 100}%"></div></div>
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
    if (preset.gestationType === 'staged') {
        const layVerb = preset.id === 'merfolk' ? 'Нерест' : 'Кладка';
        actionsHtml = isStageFullTerm ? `
            <button type="button" class="lw-btn lw-lay-clutch" data-who="${who}">${layVerb} — отложить ${pregnancy.offspringCount}</button>
            <button type="button" class="lw-btn lw-btn-muted lw-end-pregnancy" data-who="${who}">Сбросить</button>
        ` : `<button type="button" class="lw-btn lw-btn-muted lw-end-pregnancy" data-who="${who}">Сбросить (тест)</button>`;
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
    const inClutch = false; // прерывание кладки живёт на карточке кладки
    actionsHtml += `
        <div class="lw-loss-actions">
            <button type="button" class="lw-btn lw-btn-danger lw-miscarriage" data-who="${who}">${inClutch ? 'Кладка погибла' : 'Выкидыш'}</button>
            <button type="button" class="lw-btn lw-btn-danger lw-abortion" data-who="${who}">${inClutch ? 'Уничтожить кладку' : 'Аборт'}</button>
        </div>
    `;

    const weeksLabel = preset.gestationType === 'staged' ? 'Неделя (в этой фазе):' : 'Неделя:';

    // Живое от модели — важнее наших табличных догадок, поэтому выше
    const dyn = getDynamic(who);
    const dynEntries = Object.entries(dyn).filter(([, v]) => v);
    const DYN_LABELS = {
        mood: 'Настроение', libido: 'Либидо', physical: 'Тело', weight_gain: 'Вес',
        symptoms: 'Симптомы', movements: 'Шевеления', swelling: 'Отёки',
        braxton_hicks: 'Тренировочные схватки', pre_laying_cramps: 'Спазмы перед кладкой',
        fetal_position: 'Положение', fetus_size: 'Размер', clutch_size: 'Размер',
        father_name: 'Отец', note: '',
    };
    const dynHtml = dynEntries.length ? `
        <div class="lw-dynamic">
            <div class="lw-card-label">Из последней сцены</div>
            ${dynEntries.filter(([k]) => k !== 'note').map(([k, v]) =>
                `<div><span class="lw-dim">${DYN_LABELS[k] || k}:</span> ${v}</div>`).join('')}
            ${dyn.note ? `<div class="lw-dyn-note">${dyn.note}</div>` : ''}
        </div>
    ` : '';

    // Телесные признаки текущего срока
    const pct = Math.round((pregnancy.weeks / Math.max(1, stageMax)) * 100);
    const symptomsHtml = `
        <div class="lw-symptoms">
            <div class="lw-card-label">Сейчас в теле</div>
            ${getSymptoms(bodyPoolFor(preset), pct, pregnancy.weeks, termsOf(preset)).map(s => `<div>• ${s}</div>`).join('')}
            <div class="lw-rec"><i class="fa-solid fa-lightbulb"></i> ${getRecommendation(bodyPoolFor(preset), pct, termsOf(preset))}</div>
        </div>
    `;

    // Пол потомства: скрыт до раскрытия (тег SEX_REVEAL или кнопка)
    const sexHtml = pregnancy.sexRevealed
        ? `<div class="lw-sex-row">${(pregnancy.offspringSex || []).map(s => `<span class="lw-badge">${sexLabel(s)}</span>`).join('')}</div>`
        : `<button type="button" class="lw-btn lw-btn-muted lw-reveal-sex" data-who="${who}">Узнать пол</button>`;

    // Блок анти-воскрешения виден явно — раньше он молча отклонял роды
    const birthBlock = blockRemaining('birth', who);
    const blockHtml = birthBlock > 0 ? `
        <div class="lw-block-note">
            <i class="fa-solid fa-lock"></i>
            Роды заблокированы после недавней потери (ещё ~${birthBlock} сообщ.)
            <button type="button" class="lw-btn lw-btn-muted lw-clear-block" data-who="${who}">Снять</button>
        </div>
    ` : '';

    return `
        ${barsHtml}
        ${blockHtml}
        <div class="lw-day-control">
            <label>${weeksLabel}</label>
            <input type="number" class="lw-input lw-weeks-input" data-who="${who}" min="0" max="${stageMax}" value="${pregnancy.weeks}">
        </div>
        <div class="lw-day-control">
            <label>${preset.offspringLabel}:</label>
            <input type="number" class="lw-input lw-offspring-input" data-who="${who}" min="${preset.offspringRange.min}" max="${preset.offspringRange.max}" value="${pregnancy.offspringCount}">
        </div>
        ${sexHtml}
        ${dynHtml}
        ${symptomsHtml}
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
        createUndoCheckpoint(`Сброс беременности: ${carrierDisplayName(who)}`);
        endPregnancy(who);
        saveSettings();
        renderContent();
    });
    $('.lw-lay-clutch').on('click', function () {
        applyLayClutch($(this).data('who'));
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
    $('#lw_trying_toggle').on('change', function () {
        setTrying($(this).is(':checked'));
        saveSettings();
        renderContent();
    });
    $('.lw-aid-label, .lw-aid-days').on('change', function () {
        const who = $(this).data('who');
        const label = $(`.lw-aid-label[data-who="${who}"]`).val();
        const days = $(`.lw-aid-days[data-who="${who}"]`).val();
        setFertilityAid(who, label, days);
        saveSettings();
        renderContent();
    });
    $('.lw-aid-clear').on('click', function () {
        clearFertilityAid($(this).data('who'));
        saveSettings();
        renderContent();
    });
    $('.lw-clutch-weeks').on('change', function () {
        setClutchWeeks($(this).data('id'), $(this).val());
        saveSettings();
        renderContent();
    });
    $('.lw-hatch-clutch').on('click', function () {
        const created = hatchClutch($(this).data('id'));
        saveSettings();
        if (created.length) {
            showBirthDialog(created, resolvePreset(getActiveUniverse()), (names) => {
                if (Array.isArray(names)) {
                    names.forEach((n, i) => { if (n && created[i]) created[i].name = n; });
                    saveSettings();
                }
                activeSection = 'child';
                renderSidebar();
                renderContent();
            });
        } else {
            renderContent();
        }
    });
    $('.lw-clutch-lost').on('click', function () {
        createUndoCheckpoint('Гибель кладки');
        removeClutch($(this).data('id'));
        saveSettings();
        renderContent();
    });
    $('.lw-clear-block').on('click', function () {
        clearResurrectionBlocks($(this).data('who'));
        saveSettings();
        renderContent();
    });
    $('.lw-reveal-sex').on('click', function () {
        revealOffspringSex($(this).data('who'));
        saveSettings();
        renderContent();
    });
    $('.lw-miscarriage').on('click', function () {
        createUndoCheckpoint(`Потеря беременности: ${carrierDisplayName($(this).data('who'))}`);
        applyMiscarriage($(this).data('who'));
        saveSettings();
        renderContent();
    });
    $('.lw-abortion').on('click', function () {
        createUndoCheckpoint(`Прерывание беременности: ${carrierDisplayName($(this).data('who'))}`);
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
        <h3 class="lw-content-subtitle">Добавить существующего</h3>
        <p class="lw-placeholder-note">Для детей, которые уже есть в истории и родились не в этом чате.</p>
        <div class="lw-custom-grid">
            <label>Имя
                <input type="text" class="lw-input" id="lw_add_child_name" placeholder="Имя ребёнка">
            </label>
            <label>Пол
                <select class="lw-select" id="lw_add_child_sex">
                    <option value="unknown">не указан</option>
                    <option value="M">мальчик</option>
                    <option value="F">девочка</option>
                </select>
            </label>
            <label>Возраст
                <div style="display:flex;gap:6px;">
                    <input type="number" class="lw-input" id="lw_add_child_age" min="0" value="0" style="flex:1;min-width:0;">
                    <select class="lw-select" id="lw_add_child_unit" style="width:88px;">
                        <option value="w">недель</option>
                        <option value="m">месяцев</option>
                        <option value="y">лет</option>
                    </select>
                </div>
            </label>
            <label>Родитель
                <select class="lw-select" id="lw_add_child_parent">
                    <option value="user">${carrierDisplayName('user')}</option>
                    <option value="char">${carrierDisplayName('char')}</option>
                </select>
            </label>
        </div>
        <button type="button" class="lw-btn" id="lw_add_child_btn"><i class="fa-solid fa-plus"></i> Добавить</button>
    `);

    $('#lw_add_child_btn').on('click', () => {
        const n = Math.max(0, parseInt($('#lw_add_child_age').val()) || 0);
        const unit = $('#lw_add_child_unit').val();
        const weeks = unit === 'y' ? n * 52 : unit === 'm' ? Math.round(n * 4.345) : n;
        addExistingChild({
            name: $('#lw_add_child_name').val(),
            sex: $('#lw_add_child_sex').val(),
            ageWeeks: weeks,
            parentWho: $('#lw_add_child_parent').val(),
        });
        saveSettings();
        renderContent();
    });

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
    const ageDays = childAgeDays(child);
    const stage = getGrowthStage(ageDays);
    const norms = getCareNorms(ageDays, child);
    const progress = getMilestoneProgress(child);

    const traitsHtml = `
        <div class="lw-child-traits">
            <label class="lw-trait-field">
                <span class="lw-dim">Характер:</span>
                <input type="text" class="lw-input lw-child-personality" data-id="${child.id}"
                       placeholder="через запятую" value="${(child.personality || []).join(', ')}">
            </label>
            <label class="lw-trait-field">
                <span class="lw-dim">Внешность:</span>
                <input type="text" class="lw-input lw-child-appearance" data-id="${child.id}"
                       placeholder="через запятую" value="${(child.appearance || []).join(', ')}">
            </label>
        </div>
    `;

    const needs = getCareNeeds(ageDays, getTimeForCare(), child, getRpDay());
    const needClass = (v) => (/Хочет есть|Требует смены|Проснулся/.test(v) ? 'lw-need-alert' : '');
    const needsHtml = `
        <div class="lw-child-needs">
            <span class="lw-badge ${needClass(needs.feeding)}"><i class="fa-solid fa-utensils"></i> ${needs.feeding}</span>
            <span class="lw-badge ${needClass(needs.sleep)}"><i class="fa-solid fa-moon"></i> ${needs.sleep}</span>
            ${needs.diaper ? `<span class="lw-badge ${needClass(needs.diaper)}"><i class="fa-solid fa-baby"></i> ${needs.diaper}</span>` : ''}
        </div>
        ${needs.careNote ? `<div class="lw-care-note">${needs.careNote}</div>` : ''}
    `;

    const cdyn = getChildDynamic(child.id);
    const cdynEntries = Object.entries(cdyn).filter(([, v]) => v);
    const CDYN_LABELS = { mood: 'Настроение', sleep: 'Сон', feeding: 'Кормление', diaper: 'Подгузник', care_note: '', note: '' };
    const childDynHtml = cdynEntries.length ? `
        <div class="lw-dynamic">
            <div class="lw-card-label">Из последней сцены</div>
            ${cdynEntries.filter(([k]) => !['care_note', 'note'].includes(k)).map(([k, v]) =>
                `<div><span class="lw-dim">${CDYN_LABELS[k] || k}:</span> ${v}</div>`).join('')}
            ${(cdyn.care_note || cdyn.note) ? `<div class="lw-dyn-note">${cdyn.care_note || cdyn.note}</div>` : ''}
        </div>
    ` : '';

    const careBits = [norms.feeding, norms.sleep];
    if (ageDays < 1095) careBits.push(norms.diaper);
    if (norms.teething) careBits.push(`🦷 ${norms.teething}`);
    if (norms.colic) careBits.push('😖 колики');

    return `
        <div class="lw-card lw-child-card" style="--lw-card-accent: ${originPreset.color}" data-id="${child.id}">
            <input type="text" class="lw-input lw-child-name" data-id="${child.id}" placeholder="Пока без имени" value="${child.name || ''}">
            <div class="lw-child-badges">
                ${stage ? `<span class="lw-badge"><i class="fa-solid ${stage.icon}"></i> ${stage.label}</span>` : ''}
                <span class="lw-badge">${formatAge(ageDays)}</span>
                <select class="lw-select lw-child-sex" data-id="${child.id}">
                    <option value="unknown" ${child.sex === 'unknown' ? 'selected' : ''}>пол неизвестен</option>
                    <option value="M" ${child.sex === 'M' ? 'selected' : ''}>мальчик</option>
                    <option value="F" ${child.sex === 'F' ? 'selected' : ''}>девочка</option>
                </select>
            </div>
            <div class="lw-dim lw-child-origin">От: ${parentName} · ${originPreset.label}${child.fatherName ? ` · отец: ${child.fatherName}` : ''}</div>
            ${needsHtml}
            ${childDynHtml}
            ${traitsHtml}
            <div class="lw-child-care">${careBits.filter(Boolean).map(b => `<div>• ${b}</div>`).join('')}</div>
            <div class="lw-child-milestones">
                <div class="lw-stage-label">Вехи: ${progress.reached.length}/${progress.total}${progress.next ? ` · далее: ${progress.next.label}` : ''}</div>
                <div class="lw-bar"><div class="lw-bar-fill" style="width:${(progress.reached.length / progress.total) * 100}%"></div></div>
            </div>
            <div class="lw-day-control">
                <label>Возраст (нед.):</label>
                <input type="number" class="lw-input lw-child-age" data-id="${child.id}" min="0" value="${child.ageWeeks || 0}">
            </div>
            <textarea class="lw-input lw-child-notes" data-id="${child.id}" rows="2" placeholder="Заметки...">${child.notes || ''}</textarea>
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
    const parseTraitList = (v) => String(v || '').split(',').map(s => s.trim()).filter(Boolean).slice(0, 4);
    $('.lw-child-personality').on('change', function () {
        updateChildField($(this).data('id'), 'personality', parseTraitList($(this).val()));
        saveSettings();
    });
    $('.lw-child-appearance').on('change', function () {
        updateChildField($(this).data('id'), 'appearance', parseTraitList($(this).val()));
        saveSettings();
    });
    $('.lw-child-sex').on('change', function () {
        updateChildField($(this).data('id'), 'sex', $(this).val());
        saveSettings();
        renderContent();
    });
    $('.lw-child-notes').on('change', function () {
        updateChildField($(this).data('id'), 'notes', $(this).val());
        saveSettings();
    });
    $('.lw-archive-child').on('click', function () {
        createUndoCheckpoint('Архивация ребёнка');
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
        const child = [...getChildren(), ...getGrownChildren()].find(c => c.id === $(this).data('id'));
        createUndoCheckpoint(`Удаление ребёнка: ${child?.name || 'без имени'}`);
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
        ? preset.stages.first.label
        : 'Беременность';
    return `
        <div class="lw-tree-node lw-tree-node-pending" style="--lw-card-accent: ${preset.color}">
            <div class="lw-tree-name">Ожидается</div>
            <div class="lw-tree-tag">${stageLabel} · ${pregnancy.weeks}/${stageMax} нед.</div>
            <div class="lw-tree-sub">от ${carrierDisplayName(who)} · ${preset.offspringLabel.toLowerCase()}: ${pregnancy.offspringCount}</div>
        </div>
    `;
}

function renderClutchNode(clutch, preset) {
    const originPreset = resolvePreset(clutch.universe);
    const label = originPreset.gestationType === 'staged' ? originPreset.stages.second.label : 'Инкубация';
    return `
        <div class="lw-tree-node lw-tree-node-pending" style="--lw-card-accent: ${originPreset.color}">
            <div class="lw-tree-name">В гнезде</div>
            <div class="lw-tree-tag">${label} · ${clutch.weeks}/${clutch.totalWeeks} нед.</div>
            <div class="lw-tree-sub">${clutch.offspringCount} ${(originPreset.offspringLabel || '').toLowerCase()} · от ${carrierDisplayName(clutch.parentWho)}</div>
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

    // Ожидаемое потомство: и то, что растёт в теле, и уже отложенные кладки.
    // Без кладок древо пустело сразу после нереста, хотя икринки лежат в гнезде.
    const clutchNodes = getClutches().map(c => renderClutchNode(c, preset)).join('');
    const pendingHtml = [
        userData.pregnancy?.isPregnant ? renderPendingNode('user', preset) : '',
        charData.pregnancy?.isPregnant ? renderPendingNode('char', preset) : '',
        clutchNodes,
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

// ─── Раздел "Здоровье" ───
function renderHealthCard(entry, preset) {
    const info = getHealthInfo(entry.holder.healthStatus || 'normal');
    const active = activeComplications(entry.holder);
    const resolved = (entry.holder.complications || []).filter(c => c.resolved);
    const target = entry.kind === 'clutch' ? entry.id : entry.who;

    const listHtml = active.length
        ? active.map(c => `
            <div class="lw-comp lw-comp-${c.severity}">
                <i class="fa-solid ${c.severity === 'critical' ? 'fa-circle-exclamation' : 'fa-triangle-exclamation'}"></i>
                <span>${c.type}</span>
                <span class="lw-dim">с ${c.week} нед.</span>
            </div>`).join('')
        : '<div class="lw-dim">Осложнений нет.</div>';

    return `
        <div class="lw-card lw-health-card" style="--lw-card-accent: ${preset.color}">
            <div class="lw-card-label">${entry.label}</div>
            <div class="lw-health-status lw-health-${info.tone}">
                <i class="fa-solid ${info.icon}"></i> ${info.text}
            </div>
            ${listHtml}
            ${resolved.length ? `<div class="lw-dim" style="font-size:0.72rem;">Вылечено ранее: ${resolved.map(c => c.type).join(', ')}</div>` : ''}
            ${active.length ? `<button type="button" class="lw-btn lw-doctor-visit" data-target="${target}">
                <i class="fa-solid fa-stethoscope"></i> Визит к врачу
            </button>` : ''}
        </div>
    `;
}

function renderTestCard(who, preset) {
    const character = getCharacterData(who);
    if (!character.canCarry) return '';
    const p = character.pregnancy;
    const last = p?.lastTestResult;
    return `
        <div class="lw-card" style="--lw-card-accent: ${preset.color}">
            <div class="lw-card-label">${carrierDisplayName(who)}</div>
            ${last ? `<div class="lw-test-result lw-test-${last}">${TEST_LABELS[last]} <span class="lw-dim">· день ${p.lastTestRpDay}</span></div>` : '<div class="lw-dim">Тест ещё не делали.</div>'}
            <button type="button" class="lw-btn lw-take-test" data-who="${who}"><i class="fa-solid fa-vial"></i> Сделать тест</button>
        </div>
    `;
}

function renderPostpartumCard(who, preset) {
    const pp = getPostpartum(who);
    if (!pp) return '';
    const bits = [];
    if (pp.healing) bits.push(pp.healing);
    if (pp.lochia) bits.push('кровотечение ещё идёт');
    bits.push(pp.cycleReturned ? 'цикл вернулся — зачатие возможно' : 'цикл не вернулся — зачатие маловероятно');
    return `
        <div class="lw-card" style="--lw-card-accent: ${preset.color}">
            <div class="lw-card-label">${carrierDisplayName(who)} · ${pp.days} дн. с родов</div>
            <div class="lw-health-status lw-health-${pp.days < 42 ? 'warning' : 'normal'}">
                <i class="fa-solid fa-heart"></i> ${pp.label}
            </div>
            <div class="lw-child-care">${bits.map(b => `<div>• ${b}</div>`).join('')}</div>
            <label class="lw-checkbox-row">
                <input type="checkbox" class="lw-lactating" data-who="${who}" ${pp.lactatingFlag ? 'checked' : ''}>
                Кормит
            </label>
            <button type="button" class="lw-btn lw-btn-muted lw-clear-pp" data-who="${who}">Завершить период</button>
        </div>
    `;
}

function renderLooksCard(who, preset) {
    const looks = getLooks(who);
    // Свободный ввод, а не выбор из списка: в фэнтези глаза бывают золотые,
    // фиолетовые, серебряные — какими угодно. Подсказки только помогают.
    return `
        <div class="lw-card" style="--lw-card-accent: ${preset.color}">
            <div class="lw-card-label">${carrierDisplayName(who)}</div>
            <div class="lw-aid-row">
                <span class="lw-dim">Глаза:</span>
                <input type="text" class="lw-input lw-looks" data-who="${who}" data-field="eyes"
                       list="lw_eye_hints" placeholder="любой цвет" value="${looks.eyes || ''}">
            </div>
            <div class="lw-aid-row">
                <span class="lw-dim">Волосы:</span>
                <input type="text" class="lw-input lw-looks" data-who="${who}" data-field="hair"
                       list="lw_hair_hints" placeholder="любой цвет" value="${looks.hair || ''}">
            </div>
        </div>
    `;
}

function renderLooksHints() {
    return `
        <datalist id="lw_eye_hints">${EYE_OPTIONS.map(o => `<option value="${o}">`).join('')}</datalist>
        <datalist id="lw_hair_hints">${HAIR_OPTIONS.map(o => `<option value="${o}">`).join('')}</datalist>
    `;
}

function renderHealthSection(preset) {
    const holders = getHealthHolders();
    const testsHtml = ['user', 'char'].map(w => renderTestCard(w, preset)).filter(Boolean).join('');
    const ppHtml = ['user', 'char'].map(w => renderPostpartumCard(w, preset)).filter(Boolean).join('');
    const looksHtml = ['user', 'char'].map(w => renderLooksCard(w, preset)).join('');

    $('#lw_content').html(`
        <h2 class="lw-content-title">Здоровье</h2>
        ${holders.length ? `<div class="lw-cycle-grid">${holders.map(h => renderHealthCard(h, preset)).join('')}</div>`
            : '<div class="lw-empty"><i class="fa-solid fa-heart-pulse"></i><p>Сейчас нечего отслеживать — ни беременности, ни кладки.</p></div>'}
        ${ppHtml ? `<h3 class="lw-content-subtitle">Послеродовое восстановление</h3><div class="lw-cycle-grid">${ppHtml}</div>` : ''}
        ${testsHtml ? `<h3 class="lw-content-subtitle">Тесты на беременность</h3><div class="lw-cycle-grid">${testsHtml}</div>` : ''}
        <h3 class="lw-content-subtitle">Внешность родителей</h3>
        <p class="lw-placeholder-note">От неё дети наследуют глаза и волосы. Для обычных цветов работает наследование: тёмное доминирует, рецессивное проявляется примерно в трети случаев. Необычные цвета (золотые, фиолетовые) наследуются от одного из родителей поровну. Остальное модель дописывает сама.</p>
        ${renderLooksHints()}
        <div class="lw-cycle-grid">${looksHtml}</div>
        <p class="lw-placeholder-note">Осложнения определяются один раз при зачатии и проявляются по мере срока. Врач лечит обычное с шансом 75%, критическое — 50%.</p>
    `);

    $('.lw-looks').on('change', function () {
        setLooks($(this).data('who'), $(this).data('field'), $(this).val());
        saveSettings();
    });
    $('.lw-lactating').on('change', function () {
        setLactating($(this).data('who'), $(this).is(':checked'));
        saveSettings();
        renderContent();
    });
    $('.lw-clear-pp').on('click', function () {
        clearPostpartum($(this).data('who'));
        saveSettings();
        renderContent();
    });

    $('.lw-doctor-visit').on('click', function () {
        const r = doctorVisit($(this).data('target'));
        saveSettings();
        showNotification(r.healed
            ? `<i class="fa-solid fa-stethoscope"></i> Вылечено: ${r.healed}${r.failed ? `, осталось: ${r.failed}` : ''}`
            : '<i class="fa-solid fa-stethoscope"></i> Лечение не помогло', r.healed ? 'success' : 'warning');
        renderContent();
    });
    $('.lw-take-test').on('click', function () {
        const who = $(this).data('who');
        const r = takeTest(who);
        saveSettings();
        showNotification(`<i class="fa-solid fa-vial"></i> Тест: ${TEST_LABELS[r]}`, r === 'negative' ? 'info' : 'success');
        renderContent();
    });
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
            <h3 class="lw-content-subtitle">Инфоблок в чате</h3>
            <p class="lw-placeholder-note">Компактная сводка в последнем ответе бота. Видна только тебе — в текст сообщения и в контекст модели не попадает.</p>
            <div class="lw-custom-grid">
                <label>Положение
                    <select class="lw-select" id="lw_setting_infoblockPosition">
                        <option value="off" ${s.infoblockPosition === 'off' ? 'selected' : ''}>Выключен</option>
                        <option value="top" ${s.infoblockPosition === 'top' ? 'selected' : ''}>Над сообщением</option>
                        <option value="bottom" ${s.infoblockPosition === 'bottom' ? 'selected' : ''}>Под сообщением</option>
                    </select>
                </label>
            </div>
            <label style="display:block;font-size:0.78rem;color:var(--lw-text-dim);">Свой CSS для инфоблока
                <textarea class="lw-input" id="lw_setting_infoblockCss" rows="4" style="width:100%;margin-top:5px;font-family:var(--lw-font-mono);font-size:0.72rem;"
                    placeholder=".lw-infoblock { ... }">${escapeHtml(s.customInfoblockCss || '')}</textarea>
            </label>
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
                <label>Беременность очевидна с недели
                    <input type="number" class="lw-input" id="lw_setting_obviousAtWeek" min="1" value="${s.obviousAtWeek}">
                </label>
                <label>Ребёнок «вырос» через (дн.), 0 — никогда
                    <input type="number" class="lw-input" id="lw_setting_childMaxAgeDays" min="0" value="${s.childMaxAgeDays}">
                </label>
            </div>
            <p class="lw-placeholder-note">Фазы драконов/мерфолка (формирование → кладка/инкубация) настраиваются отдельно, в конструкторе кастомной вселенной.</p>
        </div>

        <div class="lw-settings-group">
            <h3 class="lw-content-subtitle">Кастомная вселенная</h3>
            ${renderCustomPresetForm(customDraft)}
        </div>

        <div class="lw-settings-group">
            <h3 class="lw-content-subtitle">Пересканировать историю</h3>
            <p class="lw-placeholder-note">Проходит по всему чату с начала и восстанавливает состояние из тегов — на случай, если расширение подключили к уже идущей истории или данные разъехались. Настройки персонажей, выросшие дети и внешность родителей сохраняются. Действие отменяемо стрелкой в шапке.</p>
            <div id="lw_rescan_box" class="lw-debug-box"></div>
            <div class="lw-child-actions" style="margin-top: 10px;">
                <button type="button" class="lw-btn lw-btn-muted" id="lw_rescan_check">Что найдётся</button>
                <button type="button" class="lw-btn lw-btn-danger" id="lw_rescan_run">Пересканировать</button>
            </div>
        </div>

        <div class="lw-settings-group">
            <h3 class="lw-content-subtitle">Диагностика</h3>
            <p class="lw-placeholder-note">Что расширение увидело в последнем сообщении. Если событие не сработало — смотри сюда.</p>
            <div id="lw_debug_box" class="lw-debug-box">${renderDebugBox()}</div>
            <div class="lw-child-actions" style="margin-top: 10px;">
                <button type="button" class="lw-btn lw-btn-muted" id="lw_debug_refresh">Обновить</button>
                <button type="button" class="lw-btn lw-btn-muted" id="lw_debug_prompt">Показать промпт</button>
                <button type="button" class="lw-btn lw-btn-muted" id="lw_debug_storage">Хранилище чатов</button>
                <button type="button" class="lw-btn lw-btn-muted" id="lw_debug_copy">Скопировать всё</button>
            </div>
        </div>
    `);

    bindSettingsEvents();
}

function renderDebugBox() {
    const d = getLastScanDebug();
    if (!d) return '<div class="lw-dim">Пока ничего не сканировалось. Отправь сообщение в чат и вернись сюда.</div>';

    const tags = d.распознаноТегов?.length ? d.распознаноТегов.join(', ') : '— теги не найдены';
    const applied = d.применено?.length ? d.применено.map(a => `<div>• ${escapeHtml(a)}</div>`).join('') : '<div class="lw-dim">— ничего не применено</div>';
    const comments = d.всеКомментарии?.length
        ? d.всеКомментарии.map(c => `<div class="lw-debug-comment">${escapeHtml(c)}</div>`).join('')
        : '<div class="lw-dim">— HTML-комментариев в сообщении нет вообще</div>';

    return `
        <div class="lw-debug-row"><span class="lw-dim">Триггер:</span> ${escapeHtml(d.триггер)} · позиция ${d.позиция} · ${escapeHtml(d.откуда)}</div>
        <div class="lw-debug-row"><span class="lw-dim">Распознано тегов:</span> ${escapeHtml(tags)}</div>
        <div class="lw-debug-row"><span class="lw-dim">Дней прошло:</span> ${d.днейПрошло}</div>
        <div class="lw-debug-row"><span class="lw-dim">Применено:</span></div>
        ${applied}
        <div class="lw-debug-row"><span class="lw-dim">Все комментарии в тексте (${d.комментариевВТексте}):</span></div>
        ${comments}
        <div class="lw-debug-row"><span class="lw-dim">Хвост текста:</span></div>
        <div class="lw-debug-tail">${escapeHtml(d.хвостТекста || '')}</div>
    `;
}

function escapeHtml(str) {
    return String(str ?? '').replace(/[&<>"']/g, c => (
        { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
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

        <div class="lw-custom-grid" id="lw_custom_terms" style="${draft.gestationType === 'staged' ? '' : 'display:none;'}">
            <label>Потомство (мн.ч.)
                <input type="text" class="lw-input" id="lw_custom_term_eggs" value="${draft.terms?.eggs || ''}" placeholder="яйца / икринки">
            </label>
            <label>Оболочка (им.п.)
                <input type="text" class="lw-input" id="lw_custom_term_shell" value="${draft.terms?.shell || ''}" placeholder="скорлупа / оболочка">
            </label>
            <label>Оболочка (предл.п.)
                <input type="text" class="lw-input" id="lw_custom_term_shellPrep" value="${draft.terms?.shellPrep || ''}" placeholder="скорлупе / оболочке">
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
    customDraft.terms = {
        eggs: $('#lw_custom_term_eggs').val() || undefined,
        shell: $('#lw_custom_term_shell').val() || undefined,
        shellPrep: $('#lw_custom_term_shellPrep').val() || undefined,
    };
}

function bindCustomPresetEvents() {
    $('#lw_custom_gestationType').on('change', function () {
        readDraftFromForm();
        $('#lw_custom_gestation_fields').html(renderCustomGestationFields(customDraft));
        $('#lw_custom_terms').toggle(customDraft.gestationType === 'staged');
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
    $('#lw_setting_infoblockPosition').on('change', function () {
        getSettings().infoblockPosition = $(this).val();
        saveSettings();
        renderInfoblock();
    });
    $('#lw_setting_infoblockCss').on('change', function () {
        getSettings().customInfoblockCss = $(this).val();
        saveSettings();
        injectCustomInfoblockCss();
        renderInfoblock();
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
        { key: 'obviousAtWeek', min: 1 },
        { key: 'childMaxAgeDays', min: 0 },
    ];
    for (const { key, min } of numericFields) {
        $(`#lw_setting_${key}`).on('change', function () {
            const applied = setNumericSetting(key, $(this).val(), min);
            $(this).val(applied);
            saveSettings();
        });
    }

    bindCustomPresetEvents();

    $('#lw_rescan_check').on('click', () => {
        const est = estimateHistory();
        $('#lw_rescan_box').html(est.tagged === 0
            ? `<div class="lw-dim">В истории (${est.total} сообщ.) нет ни одного нашего тега — восстанавливать нечего. Такое бывает, если чат шёл без расширения: теги проставляются только при включённом Lifeweaver.</div>`
            : `<div>Сообщений в чате: <b>${est.total}</b><br>Из них с тегами: <b>${est.tagged}</b></div>
               <div class="lw-dim" style="margin-top:6px;">Пересканирование сбросит текущее состояние и соберёт его заново из этих сообщений.</div>`);
    });

    $('#lw_rescan_run').on('click', () => {
        const est = estimateHistory();
        if (!confirm(`Пересканировать историю?\n\nСообщений с тегами: ${est.tagged} из ${est.total}.\nТекущее состояние будет пересобрано заново.\n\nОтменить можно стрелкой в шапке.`)) return;
        const st = scanFullHistory();
        saveSettings();
        $('#lw_rescan_box').html(`
            <div><b>Готово.</b> Обработано сообщений с тегами: ${st.processed}</div>
            <div class="lw-dim" style="margin-top:6px;">
                прошло дней: ${st.days} · зачатий: ${st.conceptions} · кладок: ${st.clutches} ·
                рождений: ${st.births} · потерь: ${st.losses} · тестов: ${st.tests}
            </div>`);
        showNotification(`<i class="fa-solid fa-clock-rotate-left"></i> История пересканирована: ${st.processed} событийных сообщений`, 'success');
        renderUniverseTabs();
        refreshUndoButton();
    });

    $('#lw_debug_refresh').on('click', () => {
        $('#lw_debug_box').html(renderDebugBox());
    });
    $('#lw_debug_prompt').on('click', () => {
        const prompt = buildPrompt();
        $('#lw_debug_box').html(`<div class="lw-debug-tail">${escapeHtml(prompt || '(промпт пуст — расширение выключено?)')}</div>`);
    });
    $('#lw_debug_storage').on('click', () => {
        const s = getSettings();
        const current = getCurrentChatId();
        const rows = Object.entries(s.chatData || {}).map(([id, d]) => {
            const kids = (d.children || []).length;
            const cl = (d.clutches || []).length;
            const preg = ['user', 'char'].filter(w => d.characters?.[w]?.pregnancy?.isPregnant).length;
            return `<div class="lw-debug-comment">${id === current ? '► ' : '&nbsp;&nbsp;&nbsp;'}${escapeHtml(id)}
                <button type="button" class="lw-btn lw-btn-danger lw-purge-entry" data-id="${escapeHtml(id)}" style="float:right;padding:2px 7px;font-size:0.65rem;">Удалить</button>
                <br><span class="lw-dim">вселенная: ${escapeHtml(d.universe || '—')} · беременностей: ${preg} · кладок: ${cl} · детей: ${kids} · день: ${d.rpDay || 0}</span></div>`;
        });
        $('#lw_debug_box').html(`
            <div class="lw-debug-row"><span class="lw-dim">Текущий чат:</span> ${escapeHtml(current || '(не определён!)')}</div>
            <div class="lw-debug-row"><span class="lw-dim">Записей в хранилище: ${rows.length}</span></div>
            ${rows.join('') || '<div class="lw-dim">пусто</div>'}
            <div class="lw-debug-row lw-dim" style="margin-top:8px;">Удаление стирает данные этого чата насовсем — для чистки слипшихся записей.</div>
        `);
        $('.lw-purge-entry').on('click', function () {
            const id = $(this).data('id');
            delete getSettings().chatData[id];
            saveSettings();
            $('#lw_debug_storage').trigger('click');
        });
    });
    $('#lw_debug_copy').on('click', async () => {
        const d = getLastScanDebug();
        const payload = `=== LIFEWEAVER ДИАГНОСТИКА ===\n\nПОСЛЕДНИЙ СКАН:\n${JSON.stringify(d, null, 2)}\n\nТЕКУЩИЙ ПРОМПТ:\n${buildPrompt()}`;
        try {
            await navigator.clipboard.writeText(payload);
            $('#lw_debug_copy').text('Скопировано');
            setTimeout(() => $('#lw_debug_copy').text('Скопировать всё'), 1500);
        } catch (e) {
            console.log('[Lifeweaver] ДИАГНОСТИКА:\n' + payload);
            $('#lw_debug_copy').text('Вывела в консоль');
            setTimeout(() => $('#lw_debug_copy').text('Скопировать всё'), 1800);
        }
    });
}

// ─── Открытие/закрытие модалки ───
function openPanel() {
    renderUniverseTabs();
    renderSidebar();
    renderContent();
    refreshUndoButton();
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
    $('#lw_undo').on('click', () => {
        const label = undoLastChange();
        saveSettings();
        showNotification(
            label ? `<i class="fa-solid fa-rotate-left"></i> Отменено: ${label}` : 'Нечего отменять',
            label ? 'success' : 'info');
        renderUniverseTabs();
        renderContent();
    });
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
            // ВАЖНО: ничего не читаем и не пишем прямо сейчас. В момент события
            // новый чат может быть ещё не догружен, и любое обращение к
            // состоянию попадёт не в тот чат. Даём кадр на догрузку.
            // (Миграцию старых кладок не зовём — она и так ленивая.)
            setTimeout(() => {
                try {
                    updatePromptInjection();
                    renderInfoblock();
                    if ($('#lw_modal_overlay').hasClass('lw-open')) {
                        renderUniverseTabs();
                        renderContent();
                    }
                } catch (e) {
                    console.warn('[Lifeweaver] Ошибка обновления после смены чата:', e);
                }
            }, 0);
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
    try {
        refreshUndoButton();
    } catch (e) { /* ignore */ }
    try {
        renderInfoblock();
    } catch (e) { /* ignore */ }
}

jQuery(async () => {
    try {
        const settingsHtml = await $.get(`${extensionFolderPath}/settings.html`);
        $('#extensions_settings2').append(settingsHtml);
        bindSettingsUI();
        initAutomation();
        updatePromptInjection();
        injectCustomInfoblockCss();
        // ST дорисовывает сообщения не мгновенно — даём ленте устояться
        setTimeout(renderInfoblock, 400);
        console.log('[Lifeweaver] Загружен, автоматика подключена.');
    } catch (e) {
        console.error('[Lifeweaver] Ошибка загрузки:', e);
    }
});
