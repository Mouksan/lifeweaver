// ═══════════════════════════════════════════
// CONFIG — константы и настройки по умолчанию
// ═══════════════════════════════════════════

export const extensionName = 'third-party/lifeweaver';

// Каждой вселенной — свой акцентный цвет (используется в UI как маркер вкладки).
export const UNIVERSE_PRESETS = {
    mpreg: {
        id: 'mpreg',
        label: 'Обычный',
        sublabel: 'MPREG',
        cycleSystem: 'none',
        gestationType: 'live',
        color: '#8a9490',
    },
    omegaverse: {
        id: 'omegaverse',
        label: 'Омегаверс',
        sublabel: 'ABO',
        cycleSystem: 'abo',
        gestationType: 'live',
        color: '#8967b0',
    },
    dragon: {
        id: 'dragon',
        label: 'Драконы',
        sublabel: 'Кладка',
        cycleSystem: 'abo',
        gestationType: 'staged',
        color: '#c1552f',
        stages: {
            first:  { key: 'formation', label: 'Формирование', weeks: 20 },
            second: { key: 'clutch',    label: 'Кладка и инкубация', weeks: 20 },
        },
    },
    merfolk: {
        id: 'merfolk',
        label: 'Мерфолк',
        sublabel: 'Нерест',
        cycleSystem: 'abo',
        gestationType: 'staged',
        color: '#3f9c92',
        stages: {
            first:  { key: 'formation', label: 'Вынашивание', weeks: 20 },
            second: { key: 'clutch',    label: 'Нерест и инкубация', weeks: 20 },
        },
    },
    custom: {
        id: 'custom',
        label: 'Кастом',
        sublabel: 'Этап 8',
        disabled: true,
        color: '#5a5850',
    },
};

// Порядок вкладок вселенной в UI (фиксированный, custom всегда последним)
export const UNIVERSE_ORDER = ['mpreg', 'omegaverse', 'dragon', 'merfolk', 'custom'];

export const DEFAULT_UNIVERSE = 'mpreg';

export function getPreset(universeId) {
    return UNIVERSE_PRESETS[universeId] || UNIVERSE_PRESETS[DEFAULT_UNIVERSE];
}

export function summarizePreset(universeId) {
    const p = getPreset(universeId);
    const cycle = p.cycleSystem === 'abo' ? 'течка/гон (ABO)' : 'без цикла';
    let gestation;
    if (p.gestationType === 'staged') {
        const s1 = p.stages.first, s2 = p.stages.second;
        gestation = `две фазы — ${s1.label} (${s1.weeks} нед.) → ${s2.label} (${s2.weeks} нед.)`;
    } else {
        gestation = 'обычная беременность (одна фаза)';
    }
    return `Цикл: ${cycle} · Вынашивание: ${gestation}`;
}

// Разделы левого сайдбара. Контент появится постепенно (Этапы 4–8);
// пока каждый раздел, кроме "Обзор", — заглушка.
export const SECTIONS = [
    { id: 'overview',   label: 'Обзор',            icon: 'fa-house' },
    { id: 'cycle',      label: 'Цикл',              icon: 'fa-moon' },
    { id: 'health',     label: 'Здоровье',          icon: 'fa-heart-pulse' },
    { id: 'pregnancy',  label: 'Беременность',      icon: 'fa-egg' },
    { id: 'child',      label: 'Ребёнок',           icon: 'fa-child' },
    { id: 'tree',       label: 'Семейное древо',    icon: 'fa-sitemap' },
    { id: 'settings',   label: 'Настройки',         icon: 'fa-gear' },
];

export const defaultSettings = {
    isEnabled: true,
    chatData: {},
};

export const defaultChatData = {
    universe: DEFAULT_UNIVERSE,
};
