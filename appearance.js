// ═══════════════════════════════════════════
// APPEARANCE — оформление панели: стиль отрисовки + цветовая схема
// ═══════════════════════════════════════════
//
// Разделено на две независимые вещи:
//   СТИЛЬ  — как рисуется панель (плоско или многослойным стеклом).
//            Живёт в CSS, переключается атрибутом data-lw-style.
//   СХЕМА  — какими цветами. Набор переменных, подставляется из JS.
// Схемы общие для обоих стилей: одна и та же «Полынь» будет выглядеть
// по-разному в Legacy и в стекле, но останется собой.
//
// Первая схема наследует тему SillyTavern, остальные её перебивают —
// иначе пользовательская тема пролезает сквозь и портит палитру.

export const PANEL_STYLES = {
    legacy: { id: 'legacy', label: 'Обычный', hint: 'Плоские панели, спокойные границы' },
    glass:  { id: 'glass',  label: 'Стекло',  hint: 'Многослойное размытие и подсветка' },
};

// Схемы: акцент, тон подложки, вторичный отсвет, текст, приглушённый, граница.
// Жёлтого и зелёного в акцентах нет — только холодные, лиловые и красные тона.
export const COLOR_SCHEMES = {
    native: {
        id: 'native', label: 'Как в Таверне',
        accent: 'var(--SmartThemeQuoteColor, #9f86ff)',
        tint: 'var(--SmartThemeBlurTintColor, #171522)',
        secondary: 'rgba(120, 130, 200, 0.12)',
        text: 'var(--SmartThemeBodyColor, #ece3d0)',
        muted: 'color-mix(in srgb, var(--SmartThemeBodyColor, #ece3d0) 58%, transparent)',
        border: 'color-mix(in srgb, var(--SmartThemeBodyColor, #ffffff) 24%, transparent)',
    },
    ash: {
        id: 'ash', label: 'Пепел',
        accent: '#9fa8b8', tint: '#16181d', secondary: 'rgba(140, 152, 172, 0.14)',
        text: '#e6e8ec', muted: '#9aa0aa', border: 'rgba(159, 168, 184, 0.28)',
    },
    plum: {
        id: 'plum', label: 'Слива',
        accent: '#a98bd6', tint: '#1a1524', secondary: 'rgba(120, 88, 176, 0.18)',
        text: '#f0eaf8', muted: '#a89cbc', border: 'rgba(169, 139, 214, 0.3)',
    },
    wine: {
        id: 'wine', label: 'Вино',
        accent: '#c97a86', tint: '#221317', secondary: 'rgba(160, 78, 92, 0.18)',
        text: '#f6e9eb', muted: '#b79ba0', border: 'rgba(201, 122, 134, 0.3)',
    },
    frost: {
        id: 'frost', label: 'Иней',
        accent: '#8fb4cc', tint: '#161d24', secondary: 'rgba(102, 138, 170, 0.18)',
        text: '#e6edf3', muted: '#98a6b4', border: 'rgba(143, 180, 204, 0.28)',
    },
    ink: {
        id: 'ink', label: 'Тушь',
        accent: '#7f8fb0', tint: '#111319', secondary: 'rgba(90, 104, 140, 0.16)',
        text: '#dfe3ec', muted: '#8b93a4', border: 'rgba(127, 143, 176, 0.26)',
    },
    custom: { id: 'custom', label: 'Свой цвет' },
};

export const DEFAULT_APPEARANCE = {
    panelStyle: 'legacy',
    scheme: 'native',
    customColor: '#a98bd6',
    glassOpacity: 82,
};

// Собирает схему в набор значений. Для «своего цвета» тон и граница
// выводятся из выбранного акцента, чтобы палитра оставалась связной.
export function resolveScheme(settings) {
    if (settings.scheme === 'custom') {
        const c = settings.customColor || DEFAULT_APPEARANCE.customColor;
        return {
            accent: c,
            tint: `color-mix(in srgb, ${c} 15%, #14151a)`,
            secondary: `color-mix(in srgb, ${c} 22%, transparent)`,
            text: '#eceef4',
            muted: '#a0a6b2',
            border: `color-mix(in srgb, ${c} 32%, rgba(255, 255, 255, 0.14))`,
        };
    }
    return COLOR_SCHEMES[settings.scheme] || COLOR_SCHEMES.native;
}

// Применяет оформление к элементу панели
export function applyAppearance(target, settings) {
    if (!target) return;
    const s = { ...DEFAULT_APPEARANCE, ...(settings || {}) };
    const sc = resolveScheme(s);

    target.style.setProperty('--lw-accent', sc.accent);
    target.style.setProperty('--lw-tint', sc.tint);
    target.style.setProperty('--lw-secondary', sc.secondary);
    target.style.setProperty('--lw-text', sc.text);
    target.style.setProperty('--lw-text-dim', sc.muted);
    target.style.setProperty('--lw-border', sc.border);

    // Прозрачность одним числом: остальные слои выводятся из него,
    // чтобы стекло везде оставалось согласованным.
    const o = Math.max(30, Math.min(100, parseInt(s.glassOpacity) || 82));
    target.style.setProperty('--lw-glass-opacity', `${o}%`);
    target.style.setProperty('--lw-glass-strong-opacity', `${Math.min(100, o + 12)}%`);
    target.style.setProperty('--lw-surface-opacity', `${Math.min(100, o + 6)}%`);


    target.dataset.lwStyle = PANEL_STYLES[s.panelStyle] ? s.panelStyle : 'legacy';
    target.dataset.lwScheme = s.scheme;
    // Родная схема наследует тему Таверны; остальные её перебивают
    if (s.scheme === 'native') delete target.dataset.lwIndependent;
    else target.dataset.lwIndependent = 'true';
}

// Применить ко всем окнам расширения разом
export function applyAppearanceEverywhere(settings) {
    for (const sel of ['#lw_modal_overlay', '#lw_birth_overlay', '#lw_grad_overlay', '#lw_carrier_overlay', '#lw_toasts']) {
        document.querySelectorAll(sel).forEach(el => applyAppearance(el, settings));
    }
}
