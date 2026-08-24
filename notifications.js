// ═══════════════════════════════════════════
// NOTIFICATIONS — тосты и диалог рождения
// ═══════════════════════════════════════════
//
// По образцу notifications.js вдохновителя: при родах показывается модалка
// с карточкой на каждого новорождённого (пол, характер, внешность, отец) и
// полем для имени — фокус сразу в первом поле. Плюс лёгкие тосты на события.

import { sexLabel } from './baby-care.js';

// Русское склонение по числу: 1 малыш, 2 малыша, 5 малышей
export function plural(n, one, few, many) {
    const abs = Math.abs(n) % 100;
    const last = abs % 10;
    if (abs > 10 && abs < 20) return many;
    if (last > 1 && last < 5) return few;
    if (last === 1) return one;
    return many;
}

function escapeHtml(str) {
    return String(str ?? '').replace(/[&<>"']/g, c => (
        { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
}

// ─── Тост ───
const MAX_TOASTS = 4;

export function showNotification(html, type = 'info', timeout = 5000) {
    let $wrap = $('#lw_toasts');
    if (!$wrap.length) {
        $wrap = $('<div id="lw_toasts"></div>').appendTo('body');
    }
    // Больше нескольких тостов разом экран не переживает: лишние старые
    // снимаем сразу, иначе при большом скипе их набегает десяток.
    const $existing = $wrap.children('.lw-toast');
    if ($existing.length >= MAX_TOASTS) {
        $existing.slice(0, $existing.length - MAX_TOASTS + 1).remove();
    }
    const $toast = $(`<div class="lw-toast lw-toast-${type}">${html}</div>`);
    $wrap.append($toast);
    try { document.dispatchEvent(new CustomEvent('lifeweaver:appearance')); } catch (e) { /* ignore */ }
    setTimeout(() => $toast.addClass('lw-toast-in'), 10);
    setTimeout(() => {
        $toast.removeClass('lw-toast-in');
        setTimeout(() => $toast.remove(), 300);
    }, timeout);
}

// ─── Диалог рождения ───
// children — массив уже созданных записей, onConfirm(names[]) — коллбэк.
export function showBirthDialog(children, preset, onConfirm) {
    $('#lw_birth_overlay').remove();
    if (!children || children.length === 0) return;

    const isClutch = preset?.gestationType === 'staged';
    const title = isClutch ? 'Потомство вылупилось!' : 'Роды!';
    const n = children.length;
    const noun = plural(n, 'малыш', 'малыша', 'малышей');

    const cardsHtml = children.map((child, i) => {
        const traits = [];
        if (child.personality?.length) {
            traits.push(`<div class="lw-bd-trait"><span class="lw-dim">Характер:</span> ${escapeHtml(child.personality.join(', '))}</div>`);
        }
        if (child.appearance?.length) {
            traits.push(`<div class="lw-bd-trait"><span class="lw-dim">Внешность:</span> ${escapeHtml(child.appearance.join(', '))}</div>`);
        }
        if (child.fatherName) {
            traits.push(`<div class="lw-bd-trait"><span class="lw-dim">Отец:</span> ${escapeHtml(child.fatherName)}</div>`);
        }
        // При поэтапном вылуплении модель описывает только тех, кто уже вылупился.
        // «неизвестно» выглядит как сбой — честнее сказать, что будет дальше.
        if (!traits.length) {
            traits.push('<div class="lw-bd-trait lw-dim">Ещё не описан — характер и внешность появятся, когда о нём напишут в истории.</div>');
        }
        const sexMark = child.sex === 'F' ? '♀' : child.sex === 'M' ? '♂' : '?';
        return `
            <div class="lw-bd-card">
                <div class="lw-bd-head">
                    <span class="lw-bd-sex lw-bd-sex-${child.sex || 'unknown'}">${sexMark}</span>
                    <span class="lw-bd-sex-label">${sexLabel(child.sex)}</span>
                </div>
                <input type="text" class="lw-input lw-bd-name" data-idx="${i}"
                       placeholder="Имя ${children.length > 1 ? `(${i + 1}-й)` : ''}"
                       value="${escapeHtml(child.name || '')}">
                ${traits.join('')}
            </div>
        `;
    }).join('');

    const $overlay = $(`
        <div id="lw_birth_overlay" class="lw-overlay lw-open">
            <div class="lw-bd-panel">
                <h2 class="lw-bd-title">${title}</h2>
                <p class="lw-bd-sub">${n} ${noun} — можно дать имена сразу или позже в разделе «Ребёнок».</p>
                <div class="lw-bd-list">${cardsHtml}</div>
                <div class="lw-bd-actions">
                    <button type="button" class="lw-btn" id="lw_bd_confirm">Сохранить</button>
                    <button type="button" class="lw-btn lw-btn-muted" id="lw_bd_skip">Позже</button>
                </div>
            </div>
        </div>
    `);

    $('body').append($overlay);
    // Диалог создан после панели — оформление надо применить и к нему
    try { document.dispatchEvent(new CustomEvent('lifeweaver:appearance')); } catch (e) { /* ignore */ }
    setTimeout(() => $overlay.find('.lw-bd-name').first().focus(), 100);

    const collect = () => {
        const names = [];
        $overlay.find('.lw-bd-name').each(function () {
            names.push($(this).val().trim());
        });
        return names;
    };

    const close = (names) => {
        $overlay.remove();
        if (typeof onConfirm === 'function') onConfirm(names);
    };

    $overlay.find('#lw_bd_confirm').on('click', () => close(collect()));
    $overlay.find('#lw_bd_skip').on('click', () => close(null));
    $overlay.on('click', function (e) {
        if (e.target === this) close(null);
    });
    $overlay.find('.lw-bd-name').on('keydown', function (e) {
        if (e.key === 'Enter') close(collect());
    });
}

// ─── Диалог выпуска: дети выросли и уходят в архив ───
// По образцу showGraduationDialog вдохновителя, включая конфетти.
export function showGraduationDialog(graduates, onConfirm) {
    if (!graduates || graduates.length === 0) {
        if (typeof onConfirm === 'function') onConfirm();
        return;
    }
    $('#lw_grad_overlay').remove();

    const n = graduates.length;
    const noun = plural(n, 'ребёнок', 'ребёнка', 'детей');
    const verb = plural(n, 'вырос', 'выросли', 'выросли');
    const namesHtml = graduates.map(c => {
        const mark = c.sex === 'F' ? '♀' : c.sex === 'M' ? '♂' : '·';
        return `<div class="lw-gr-name"><span class="lw-bd-sex-${c.sex || 'unknown'}">${mark}</span> ${escapeHtml(c.name || 'Без имени')}</div>`;
    }).join('');

    const $overlay = $(`
        <div id="lw_grad_overlay" class="lw-overlay lw-open">
            <div class="lw-gr-card">
                <div class="lw-gr-icon"><i class="fa-solid fa-graduation-cap"></i></div>
                <div class="lw-gr-title">${n} ${noun} ${verb}</div>
                <div class="lw-gr-sub">Переезжают в архив — из активного трекинга уходят, но в семье и в памяти остаются.</div>
                <div class="lw-gr-names">${namesHtml}</div>
                <button type="button" class="lw-btn" id="lw_gr_ok">Понятно</button>
            </div>
        </div>
    `);
    $('body').append($overlay);
    try { document.dispatchEvent(new CustomEvent('lifeweaver:appearance')); } catch (e) { /* ignore */ }

    // Конфетти
    const colors = ['#ff9eb4', '#b478ff', '#82c8ff', '#ffd64a', '#82e878'];
    const card = $overlay.find('.lw-gr-card')[0];
    for (let i = 0; i < 50; i++) {
        const conf = document.createElement('div');
        conf.className = 'lw-gr-confetti';
        conf.style.left = Math.random() * 100 + '%';
        conf.style.background = colors[Math.floor(Math.random() * colors.length)];
        conf.style.animationDuration = (1.5 + Math.random() * 2) + 's';
        conf.style.animationDelay = (Math.random() * 0.5) + 's';
        card.appendChild(conf);
    }
    setTimeout(() => card.querySelectorAll('.lw-gr-confetti').forEach(c => c.remove()), 4500);

    const close = () => {
        $overlay.remove();
        if (typeof onConfirm === 'function') onConfirm();
    };
    $overlay.find('#lw_gr_ok').on('click', close);
    $overlay.on('click', function (e) { if (e.target === this) close(); });
    $(document).one('keydown.lwgrad', (e) => { if (e.key === 'Escape' || e.key === 'Enter') close(); });
}
