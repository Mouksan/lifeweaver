// ═══════════════════════════════════════════
// INFOBLOCK — компактная сводка прямо в ленте чата
// ═══════════════════════════════════════════
//
// Портировано с ui.js / message-handler.js вдохновителя. Их схема: блок
// вставляется в DOM последнего ответа бота, перед вставкой все прежние
// экземпляры удаляются, перерисовка вызывается после каждого изменения
// состояния и после событий ST. В сам текст сообщения ничего не пишется —
// блок живёт только в отрисованном DOM, поэтому не попадает ни в контекст
// модели, ни в файл чата.
//
// Наше: строки собираются по активному пресету (беременность, кладки,
// дети, послеродовое), поэтому блок одинаково работает во всех вселенных.

import { getSettings, getActivePreset, getCharacterData, carrierDisplayName, currentStageMaxWeeks,
         getClutches, getChildren, getPostpartum, isPregnancyObvious, getTimeForCare, getRpDay,
         getDynamic, getChildDynamic, getCyclePhase } from './state.js';
import { termsOf } from './config.js';
import { childAgeDays, getGrowthStage, getCareNeeds, getCareNorms, getMilestoneProgress, formatAge, sexLabel } from './baby-care.js';
import { activeComplications, bodyPoolFor } from './health.js';
import { getSymptoms, getCycleState } from './symptoms.js';

function esc(str) {
    return String(str ?? '').replace(/[&<>"']/g, c => (
        { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
}

// ─── Структура вдохновителя ───
// Сворачиваемая секция <details>: шапка с иконкой-кружком, названием, бейджем
// и шевроном; тело с тонкой полосой прогресса и сеткой карточек-статов 2 в ряд;
// примечание на всю ширину внизу. Цвета — наши.

// Свёрнутость переживает перерисовку
const _collapsed = new Set();

export function toggleCollapsed(key, isOpen) {
    if (isOpen) _collapsed.delete(key); else _collapsed.add(key);
}

function bar(value, total, tone) {
    const pct = Math.max(0, Math.min(100, Math.round((value / Math.max(1, total)) * 100)));
    return `<div class="lw-ib-bar"><div class="lw-ib-bar-fill ${tone}" style="width:${pct}%"></div></div>`;
}

function stat(icon, tone, label, value, wide = false, warn = false) {
    if (!value) return '';
    return `
        <div class="lw-ib-stat${wide ? ' lw-ib-wide' : ''}">
            <div class="lw-ib-si ${tone}"><i class="fa-solid ${icon}"></i></div>
            <div>
                <div class="lw-ib-lbl">${esc(label)}</div>
                <div class="lw-ib-val${warn ? ' lw-ib-val-warn' : ''}">${esc(value)}</div>
            </div>
        </div>
    `;
}

function section(key, tone, icon, title, badge, barHtml, statsHtml, noteHtml = '') {
    const open = !_collapsed.has(key) ? ' open' : '';
    return `
        <details class="lw-ib" data-key="${esc(key)}"${open}>
            <summary class="lw-ib-header">
                <div class="lw-ib-icon ${tone}"><i class="fa-solid ${icon}"></i></div>
                <span class="lw-ib-title">${esc(title)}</span>
                ${badge ? `<span class="lw-ib-badge ${tone}">${esc(badge)}</span>` : ''}
                <span class="lw-ib-chev"><i class="fa-solid fa-chevron-down"></i></span>
            </summary>
            <div class="lw-ib-c">
                ${barHtml}
                <div class="lw-ib-grid">${statsHtml}${noteHtml}</div>
            </div>
        </details>
    `;
}

function healthNote(holder) {
    const comps = activeComplications(holder);
    if (!comps.length) return '';
    const crit = comps.some(c => c.severity === 'critical');
    return `<div class="lw-ib-note lw-ib-warnnote"><i class="fa-solid ${crit ? 'fa-circle-exclamation' : 'fa-triangle-exclamation'}"></i> ${esc(comps.map(c => c.type).join(', '))}</div>`;
}

// ─── Носитель ───
function carrierSection(who, preset) {
    const c = getCharacterData(who);
    const p = c.pregnancy;
    const name = carrierDisplayName(who);

    if (p?.isPregnant) {
        const hidden = getSettings().hiddenPregnancy && !isPregnancyObvious(who);
        const dyn = getDynamic(who);

        if (hidden) {
            return section(`p:${who}`, 'pregnancy', 'fa-heart', name, 'самочувствие', '',
                stat('fa-question', 'purple', 'Состояние', 'что-то не так', true) +
                stat('fa-comment', 'purple', 'Ощущения', dyn.note, true));
        }

        const max = currentStageMaxWeeks(preset, p);
        const stageLabel = preset.gestationType === 'staged' ? preset.stages.first.label : 'Беременность';
        const left = max - p.weeks;

        let stats = stat('fa-hourglass-half', 'pink', 'Срок', `${p.weeks} / ${max} нед.`);
        const offIcon = preset.gestationType === 'staged' ? 'fa-egg' : 'fa-baby';
        stats += stat(offIcon, 'orange', preset.offspringLabel || 'Потомство', String(p.offspringCount));
        stats += stat('fa-ruler', 'blue', 'Размер', dyn.fetus_size || dyn.clutch_size);
        stats += stat('fa-wave-square', 'green', 'Шевеления', dyn.movements);
        if (left > 0) stats += stat('fa-flag-checkered', 'purple', 'Осталось', `${left} нед.`);
        stats += stat('fa-face-smile', 'purple', 'Настроение', dyn.mood);
        stats += stat('fa-fire', 'red', 'Либидо', dyn.libido);
        if (p.sexRevealed && p.offspringSex?.length) {
            stats += stat('fa-venus-mars', 'purple', 'Пол', p.offspringSex.map(sexLabel).join(', '), true);
        }
        const note = (dyn.note ? `<div class="lw-ib-note">${esc(dyn.note)}</div>` : '') + healthNote(p);

        return section(`p:${who}`, 'pregnancy', 'fa-heart', name,
            `${p.weeks} из ${max} нед.`,
            bar(p.weeks, max, 'pregnancy'), stats, note);
    }

    // Цикл показываем, только когда что-то происходит
    const phase = getCyclePhase(who);
    if (!phase || phase.key === 'beta' || phase.key === 'normal') return '';
    const st = getCycleState(phase.key, phase.day, c.cycleDay);
    const hot = phase.key === 'heat' || phase.key === 'rut';
    const tone = hot ? 'heat' : 'cycle';

    let stats = stat('fa-face-smile', 'purple', 'Настроение', st.mood, true);
    stats += stat('fa-fire', 'red', 'Либидо', st.libido);
    stats += stat('fa-bolt', 'orange', 'Энергия', st.energy);
    const note = `<div class="lw-ib-note">${esc(st.body.slice(0, 3).join(' · '))}</div>`;

    return section(`c:${who}`, tone, hot ? 'fa-fire' : 'fa-moon', name,
        phase.daysLeft !== null && !hot ? `${st.label} · ${phase.daysLeft} дн.` : st.label,
        '', stats, note);
}

// ─── Кладка ───
function clutchSection(clutch, preset) {
    const t = termsOf(preset);
    const pct = Math.round((clutch.weeks / Math.max(1, clutch.totalWeeks)) * 100);
    const left = clutch.totalWeeks - clutch.weeks;

    let stats = stat('fa-hourglass-half', 'orange', 'Инкубация', `${clutch.weeks} / ${clutch.totalWeeks} нед.`);
    stats += stat('fa-egg', 'orange', preset.offspringLabel || 'Кладка', String(clutch.offspringCount));
    stats += stat('fa-user', 'purple', 'От', carrierDisplayName(clutch.parentWho), true);
    const note = `<div class="lw-ib-note">${esc(getSymptoms('clutch', pct, clutch.weeks, t).slice(0, 2).join(' · '))}</div>` + healthNote(clutch);

    return section(`cl:${clutch.id}`, 'clutch', 'fa-egg', t.clutch,
        left > 0 ? `${left} нед.` : 'вот-вот', bar(clutch.weeks, clutch.totalWeeks, 'clutch'), stats, note);
}

// ─── Дети ───
function childrenSection() {
    const children = getChildren();
    if (!children.length) return '';

    let stats = '';
    for (const child of children.slice(0, 6)) {
        const days = childAgeDays(child);
        const stage = getGrowthStage(days);
        const cd = getChildDynamic(child.id);
        const needs = getCareNeeds(days, getTimeForCare(), child, getRpDay());
        const alerts = [needs.feeding, needs.diaper].filter(v => /Хочет есть|Требует смены/.test(v || ''));
        const icon = child.sex === 'M' ? 'fa-mars' : child.sex === 'F' ? 'fa-venus' : 'fa-baby';
        const tone = child.sex === 'F' ? 'pink' : 'blue';
        const state = cd.sleep || needs.sleep;
        const extra = [cd.mood, cd.feeding].filter(Boolean).join(', ');
        const value = `${formatAge(days)} · ${state}${extra ? ` · ${extra}` : ''}${alerts.length && !cd.sleep ? ` · ${alerts.join(', ').toLowerCase()}` : ''}`;
        stats += stat(icon, tone, `${child.name || 'Без имени'}${stage ? ` · ${stage.label}` : ''}`, value, true, alerts.length > 0 && !cd.sleep);
        // Подробности: уход по возрасту и ближайшая веха — чтобы секция
        // не была огрызком из одной строки
        const norms = getCareNorms(days, child);
        const prog = getMilestoneProgress(child);
        stats += stat('fa-utensils', 'orange', 'Кормление', norms.feeding);
        stats += stat('fa-moon', 'purple', 'Сон', norms.sleep);
        if (days < 1095) stats += stat('fa-baby', 'blue', 'Подгузники', norms.diaper);
        if (norms.teething) stats += stat('fa-tooth', 'red', 'Зубы', norms.teething);
        stats += stat('fa-star', 'green', 'Вехи', `${prog.reached.length} из ${prog.total}${prog.next ? ` · далее ${prog.next.label}` : ''}`, true);
        if (cd.care_note) stats += stat('fa-comment', 'purple', 'В сцене', cd.care_note, true);
    }
    const more = children.length > 6 ? `<div class="lw-ib-note">…и ещё ${children.length - 6}</div>` : '';
    return section('kids', 'baby', 'fa-baby', 'Дети', String(children.length), '', stats, more);
}

// ─── Послеродовое ───
function postpartumSection(who) {
    const pp = getPostpartum(who);
    if (!pp || pp.days > 60) return '';
    let stats = stat('fa-hand-holding-heart', 'green', 'Восстановление', pp.label, true);
    stats += stat('fa-bandage', 'orange', 'Заживление', pp.healing);
    if (pp.lochia) stats += stat('fa-droplet', 'red', 'Кровотечение', 'ещё идёт');
    stats += stat('fa-baby', 'blue', 'Кормление', pp.lactating ? 'кормит' : 'не кормит');
    stats += stat('fa-rotate', 'purple', 'Цикл', pp.cycleReturned ? 'вернулся' : 'не вернулся');
    return section(`pp:${who}`, 'baby', 'fa-hand-holding-heart', carrierDisplayName(who),
        `${pp.days} дн.`, '', stats);
}

export function buildInfoblockHtml() {
    const s = getSettings();
    if (!s.isEnabled) return '';
    const preset = getActivePreset();

    const parts = [
        ...['user', 'char'].map(w => carrierSection(w, preset)),
        ...getClutches().map(c => clutchSection(c, preset)),
        childrenSection(),
        ...['user', 'char'].map(w => postpartumSection(w)),
    ].filter(Boolean);

    return parts.length ? `<div class="lw-infoblock">${parts.join('')}</div>` : '';
}

// ─── Вставка в DOM последнего ответа бота ───
export function renderInfoblock() {
    try {
        const pos = getSettings().infoblockPosition;
        // Сначала всегда убираем прежние экземпляры — иначе они копятся
        document.querySelectorAll('.lw-infoblock-inserted').forEach(el => el.remove());
        if (!pos || pos === 'off') return;

        const html = buildInfoblockHtml();
        if (!html) return;

        const messages = document.querySelectorAll('.mes:not([is_system="true"])');
        let lastBot = null;
        for (let i = messages.length - 1; i >= 0; i--) {
            if (messages[i].getAttribute('is_user') === 'false') { lastBot = messages[i]; break; }
        }
        if (!lastBot) return;
        const mesText = lastBot.querySelector('.mes_text');
        if (!mesText) return;

        const wrapper = document.createElement('div');
        wrapper.className = 'lw-infoblock-inserted';
        wrapper.innerHTML = html;

        if (pos === 'top') mesText.insertBefore(wrapper, mesText.firstChild);
        else mesText.appendChild(wrapper);

        wrapper.querySelectorAll('details.lw-ib').forEach(el => {
            el.addEventListener('toggle', () => toggleCollapsed(el.dataset.key, el.open));
        });

    } catch (e) {
        console.warn('[Lifeweaver] Ошибка отрисовки инфоблока:', e);
    }
}
