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
         getDynamic, getChildDynamic } from './state.js';
import { termsOf } from './config.js';
import { childAgeDays, getGrowthStage, getCareNeeds, formatAge, sexLabel } from './baby-care.js';
import { activeComplications, bodyPoolFor } from './health.js';
import { getSymptoms } from './symptoms.js';

function esc(str) {
    return String(str ?? '').replace(/[&<>"']/g, c => (
        { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
}

// Состояние свёрнутости блоков переживает перерисовку
const _collapsed = new Set();

export function toggleCollapsed(key, isOpen) {
    if (isOpen) _collapsed.delete(key); else _collapsed.add(key);
}

function bar(value, total, tone) {
    const pct = Math.max(0, Math.min(100, Math.round((value / Math.max(1, total)) * 100)));
    return `<div class="lw-ib-bar"><div class="lw-ib-bar-fill ${tone}" style="width:${pct}%"></div></div>`;
}

// Карточка-стат: иконка + подпись + значение
function stat(icon, tone, label, value, wide = false, warn = false) {
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

// Сворачиваемая секция в стиле вдохновителя: шапка с иконкой, бейджем
// и шевроном, тело с полосой прогресса и сеткой статов.
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

function healthBadgeHtml(holder) {
    const comps = activeComplications(holder);
    if (!comps.length) return '';
    const critical = comps.some(c => c.severity === 'critical');
    return `<div class="lw-ib-note lw-ib-warnnote"><i class="fa-solid ${critical ? 'fa-circle-exclamation' : 'fa-triangle-exclamation'}"></i> ${esc(comps.map(c => c.type).join(', '))}</div>`;
}

// ─── Секция носителя ───
function carrierSection(who, preset) {
    const character = getCharacterData(who);
    const p = character.pregnancy;
    if (!p?.isPregnant) return '';
    const name = carrierDisplayName(who);

    // Скрытая беременность: пока не очевидна — не выдаём срок, иначе блок
    // проспойлерит то, чего героиня ещё не знает.
    if (getSettings().hiddenPregnancy && !isPregnancyObvious(who)) {
        return section(`p:${who}`, 'pregnancy', 'fa-heart', name, 'самочувствие', '',
            stat('fa-question', 'purple', 'Состояние', 'что-то не так', true));
    }

    const max = currentStageMaxWeeks(preset, p);
    const stageLabel = preset.gestationType === 'staged' ? preset.stages.first.label : 'Беременность';
    const pct = Math.round((p.weeks / Math.max(1, max)) * 100);
    const t = termsOf(preset);

    let stats = stat('fa-hourglass-half', 'pink', 'Срок', `${p.weeks} / ${max} нед.`);
    stats += stat('fa-egg', 'orange', preset.offspringLabel || 'Потомство', String(p.offspringCount));
    if (p.sexRevealed && p.offspringSex?.length) {
        stats += stat('fa-venus-mars', 'purple', 'Пол', p.offspringSex.map(sexLabel).join(', '), true);
    }
    // Динамика от модели важнее табличных симптомов — показываем её
    const dyn = getDynamic(who);
    if (dyn.fetus_size || dyn.clutch_size) {
        stats += stat('fa-ruler', 'blue', 'Размер', dyn.fetus_size || dyn.clutch_size, true);
    }
    if (dyn.mood) stats += stat('fa-face-smile', 'purple', 'Настроение', dyn.mood);
    if (dyn.movements) stats += stat('fa-wave-square', 'green', 'Шевеления', dyn.movements);

    const symptoms = getSymptoms(bodyPoolFor(preset), pct, p.weeks, t);
    const noteText = dyn.note || symptoms.join(', ');
    const note = `<div class="lw-ib-note">${esc(noteText)}</div>` + healthBadgeHtml(p);

    return section(`p:${who}`, 'pregnancy', 'fa-heart', name, stageLabel,
        bar(p.weeks, max, 'pregnancy'), stats, note);
}

// ─── Секция кладки ───
function clutchSection(clutch, preset) {
    const t = termsOf(preset);
    const pct = Math.round((clutch.weeks / Math.max(1, clutch.totalWeeks)) * 100);
    let stats = stat('fa-hourglass-half', 'orange', 'Инкубация', `${clutch.weeks} / ${clutch.totalWeeks} нед.`);
    stats += stat('fa-egg', 'orange', preset.offspringLabel || 'Кладка', String(clutch.offspringCount));
    stats += stat('fa-user', 'purple', 'От', carrierDisplayName(clutch.parentWho), true);
    const note = `<div class="lw-ib-note">${esc(getSymptoms('clutch', pct, clutch.weeks, t).join(', '))}</div>` + healthBadgeHtml(clutch);
    return section(`c:${clutch.id}`, 'clutch', 'fa-egg', t.clutch, `${pct}%`,
        bar(clutch.weeks, clutch.totalWeeks, 'clutch'), stats, note);
}

// ─── Секция детей ───
function childrenSection() {
    const children = getChildren();
    if (children.length === 0) return '';
    let stats = '';
    for (const child of children.slice(0, 6)) {
        const days = childAgeDays(child);
        const stage = getGrowthStage(days);
        const needs = getCareNeeds(days, getTimeForCare(), child, getRpDay());
        const alerts = [needs.feeding, needs.diaper].filter(v => /Хочет есть|Требует смены/.test(v || ''));
        const icon = child.sex === 'M' ? 'fa-mars' : child.sex === 'F' ? 'fa-venus' : 'fa-genderless';
        const tone = child.sex === 'F' ? 'pink' : 'blue';
        const cd = getChildDynamic(child.id);
        // Что сказала модель, важнее того, что мы предположили по возрасту
        const sleepText = cd.sleep || needs.sleep;
        const extra = [cd.mood, cd.feeding].filter(Boolean).join(', ');
        const value = `${formatAge(days)} · ${sleepText}${extra ? ` · ${extra}` : ''}${alerts.length && !cd.sleep ? ` · ${alerts.join(', ')}` : ''}`;
        stats += stat(icon, tone, `${child.name || 'Малыш'}${stage ? ` · ${stage.label}` : ''}`, value, true, alerts.length > 0);
    }
    if (children.length > 6) {
        stats += `<div class="lw-ib-note">…и ещё ${children.length - 6}</div>`;
    }
    return section('kids', 'baby', 'fa-baby', 'Дети', String(children.length), '', stats);
}

// ─── Секция послеродового ───
function postpartumSection(who) {
    const pp = getPostpartum(who);
    if (!pp || pp.days > 60) return '';
    let stats = stat('fa-hand-holding-heart', 'green', 'Восстановление', pp.label, true);
    if (pp.healing) stats += stat('fa-bandage', 'orange', 'Заживление', pp.healing, true);
    if (pp.lactating) stats += stat('fa-droplet', 'blue', 'Кормление', 'кормит', true);
    return section(`pp:${who}`, 'baby', 'fa-hand-holding-heart', `${carrierDisplayName(who)} после родов`, `${pp.days} дн.`, '', stats);
}

// ─── Сборка блока целиком. Пусто → блок не показывается вовсе ───
export function buildInfoblockHtml() {
    const s = getSettings();
    if (!s.isEnabled) return '';
    const preset = getActivePreset();

    const parts = [];
    for (const who of ['user', 'char']) parts.push(carrierSection(who, preset));
    for (const c of getClutches()) parts.push(clutchSection(c, preset));
    parts.push(childrenSection());
    for (const who of ['user', 'char']) parts.push(postpartumSection(who));

    const body = parts.filter(Boolean).join('');
    return body ? `<div class="lw-infoblock">${body}</div>` : '';
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

        // Запоминаем, что игрок свернул — иначе при каждой перерисовке
        // все секции снова раскрывались бы.
        wrapper.querySelectorAll('details.lw-ib').forEach(el => {
            el.addEventListener('toggle', () => toggleCollapsed(el.dataset.key, el.open));
        });
    } catch (e) {
        console.warn('[Lifeweaver] Ошибка отрисовки инфоблока:', e);
    }
}
