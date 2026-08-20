// ═══════════════════════════════════════════
// CONFIG — константы и настройки по умолчанию
// ═══════════════════════════════════════════

export const extensionName = 'third-party/lifeweaver';

// Каждой вселенной — свой акцентный цвет (используется в UI как маркер вкладки),
// диапазон количества потомства и его название в UI.
export const UNIVERSE_PRESETS = {
    mpreg: {
        id: 'mpreg',
        label: 'Обычный',
        sublabel: 'MPREG',
        cycleSystem: 'none',
        gestationType: 'live',
        color: '#8a9490',
        offspringRange: { min: 1, max: 1 },
        offspringLabel: 'Детей',
    },
    omegaverse: {
        id: 'omegaverse',
        label: 'Омегаверс',
        sublabel: 'ABO',
        cycleSystem: 'abo',
        gestationType: 'live',
        color: '#8967b0',
        offspringRange: { min: 1, max: 1 },
        offspringLabel: 'Детей',
    },
    dragon: {
        id: 'dragon',
        label: 'Драконы',
        sublabel: 'Кладка',
        cycleSystem: 'abo',
        gestationType: 'staged',
        color: '#c1552f',
        offspringRange: { min: 1, max: 3 },
        offspringLabel: 'Яиц',
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
        offspringRange: { min: 3, max: 12 },
        offspringLabel: 'Икринок',
        // Длительности — плейсхолдер, донастроим числа на Этапе 8 (конструктор).
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

// Суммарная длительность вынашивания в неделях: у staged — сумма двух фаз,
// у live — общая настройка pregnancyDuration (дефолт 40).
export function getTotalWeeks(preset, pregnancyDuration) {
    if (preset.gestationType === 'staged') {
        return preset.stages.first.weeks + preset.stages.second.weeks;
    }
    return Math.max(1, parseInt(pregnancyDuration) || 40);
}

// Разделы левого сайдбара. Контент появится постепенно (Этапы 4–8);
// пока каждый раздел, кроме "Обзор"/"Цикл"/"Беременность", — заглушка.
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
    // Длины циклов течки/гона — общие на все ABO-вселенные. Разбивка по видам
    // (у драконов гон может идти иначе, чем у людей) — Этап 8, конструктор.
    heatCycleLength: 42,
    heatDuration: 5,
    rutCycleLength: 70,
    rutDuration: 3,
    // Длительность обычной (live) беременности в неделях — для mpreg/омегаверса.
    pregnancyDuration: 40,
};

// Дефолт беременности одного персонажа.
export const defaultPregnancyData = {
    isPregnant: false,
    weeks: 0,
    stage: 'formation', // используется только при gestationType: 'staged'
    offspringCount: 1,
};

// Дефолт для одного персонажа (заполняется лениво под ключами user/char).
export const defaultCharacterData = {
    designation: 'beta',
    cycleDay: 1,
    // Явный флаг "может забеременеть" — не выводится из designation/пола,
    // выставляется руками один раз на чат/карточку.
    canCarry: false,
    pregnancy: {
        isPregnant: false,
        weeks: 0,
        stage: 'formation',
        offspringCount: 1,
    },
};

export const defaultChatData = {
    universe: DEFAULT_UNIVERSE,
    characters: {
        user: { designation: 'omega', cycleDay: 1, canCarry: false, pregnancy: { isPregnant: false, weeks: 0, stage: 'formation', offspringCount: 1 } },
        char: { designation: 'alpha', cycleDay: 1, canCarry: false, pregnancy: { isPregnant: false, weeks: 0, stage: 'formation', offspringCount: 1 } },
    },
};
