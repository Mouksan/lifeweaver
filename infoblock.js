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
         getClutches, getChildren, getPostpartum, isPregnancyObvious, getTimeForCare, getRpDay } from './state.js';
import { termsOf } from './config.js';
import { activeComplications } from './health.js';
import { childAgeDays, getGrowthStage, getCareNeeds, formatAge, sexLabel } from './baby-care.js';

function esc(str) {
    return String(str ?? '').replace(/[&<>"']/g, c => (
        { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
}

function bar(value, total) {
    const pct = Math.max(0, Math.min(100, Math.round((value / Math.max(1, total)) * 100)));
    return `<div class="lw-ib-bar"><div class="lw-ib-fill" style="width:${pct}%"></div></div>`;
}

// ─── Строка носителя ───
function carrierRow(who, preset) {
    const character = getCharacterData(who);
    const p = character.pregnancy;
    if (!p?.isPregnant) return '';

    // Скрытая беременность: пока не очевидна и не подтверждена — не выдаём её
    // в инфоблоке, иначе он проспойлерит то, что героиня ещё не знает.
    if (getSettings().hiddenPregnancy && !isPregnancyObvious(who)) {
        return `<div class="lw-ib-row"><span class="lw-ib-label">${esc(carrierDisplayName(who))}</span>
            <span class="lw-ib-dim">что-то не так с самочувствием</span></div>`;
    }

    const max = currentStageMaxWeeks(preset, p);
    const stage = preset.gestationType === 'staged' ? preset.stages.first.label : 'Беременность';
    const comps = activeComplications(p);
    return `
        <div class="lw-ib-row">
            <span class="lw-ib-label"><i class="fa-solid fa-heart"></i> ${esc(carrierDisplayName(who))}</span>
            <span>${esc(stage)} ${p.weeks}/${max} нед. · ${p.offspringCount} ${esc((preset.offspringLabel || '').toLowerCase())}</span>
            ${comps.length ? `<span class="lw-ib-warn"><i class="fa-solid fa-triangle-exclamation"></i> ${esc(comps.map(c => c.type).join(', '))}</span>` : ''}
            ${bar(p.weeks, max)}
        </div>
    `;
}

// ─── Строка кладки ───
function clutchRow(clutch, preset) {
    const t = termsOf(preset);
    const comps = activeComplications(clutch);
    return `
        <div class="lw-ib-row">
            <span class="lw-ib-label"><i class="fa-solid fa-egg"></i> ${esc(t.clutch)}</span>
            <span>${clutch.weeks}/${clutch.totalWeeks} нед. · ${clutch.offspringCount} ${esc((preset.offspringLabel || '').toLowerCase())} · от ${esc(carrierDisplayName(clutch.parentWho))}</span>
            ${comps.length ? `<span class="lw-ib-warn"><i class="fa-solid fa-triangle-exclamation"></i> ${esc(comps.map(c => c.type).join(', '))}</span>` : ''}
            ${bar(clutch.weeks, clutch.totalWeeks)}
        </div>
    `;
}

// ─── Строка ребёнка ───
function childRow(child) {
    const days = childAgeDays(child);
    const stage = getGrowthStage(days);
    const needs = getCareNeeds(days, getTimeForCare(), child, getRpDay());
    const alerts = [needs.feeding, needs.diaper].filter(v => /Хочет есть|Требует смены/.test(v || ''));
    const sexIcon = child.sex === 'M' ? 'fa-mars' : child.sex === 'F' ? 'fa-venus' : 'fa-genderless';
    return `
        <div class="lw-ib-row lw-ib-child">
            <span class="lw-ib-label"><i class="fa-solid ${sexIcon}"></i> ${esc(child.name || 'Малыш')}</span>
            <span class="lw-ib-dim">${esc(formatAge(days))}${stage ? ` · ${esc(stage.label)}` : ''}</span>
            <span>${esc(needs.sleep)}</span>
            ${alerts.length ? `<span class="lw-ib-warn">${esc(alerts.join(', '))}</span>` : ''}
        </div>
    `;
}

// ─── Сборка блока целиком. Пусто → блок не показывается вовсе ───
export function buildInfoblockHtml() {
    const s = getSettings();
    if (!s.isEnabled) return '';
    const preset = getActivePreset();

    const rows = [];
    for (const who of ['user', 'char']) rows.push(carrierRow(who, preset));
    for (const c of getClutches()) rows.push(clutchRow(c, preset));

    const children = getChildren();
    const maxChildren = 4; // больше — сворачиваем, иначе блок занимает пол-экрана
    for (const child of children.slice(0, maxChildren)) rows.push(childRow(child));
    if (children.length > maxChildren) {
        rows.push(`<div class="lw-ib-row lw-ib-dim">…и ещё ${children.length - maxChildren}</div>`);
    }

    for (const who of ['user', 'char']) {
        const pp = getPostpartum(who);
        if (!pp || pp.days > 60) continue; // после двух месяцев это уже не новость
        rows.push(`<div class="lw-ib-row"><span class="lw-ib-label"><i class="fa-solid fa-hand-holding-heart"></i> ${esc(carrierDisplayName(who))}</span>
            <span class="lw-ib-dim">${esc(pp.label)}${pp.healing ? ` · ${esc(pp.healing)}` : ''}</span></div>`);
    }

    const body = rows.filter(Boolean).join('');
    if (!body) return '';
    return `<div class="lw-infoblock">${body}</div>`;
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
    } catch (e) {
        console.warn('[Lifeweaver] Ошибка отрисовки инфоблока:', e);
    }
}
