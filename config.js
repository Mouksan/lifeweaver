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
        offspringRange: { min: 1, max: 3 },
        offspringLabel: 'Детей',
    },
    omegaverse: {
        id: 'omegaverse',
        label: 'Омегаверс',
        sublabel: 'ABO',
        cycleSystem: 'abo',
        gestationType: 'live',
        color: '#8967b0',
        offspringRange: { min: 1, max: 3 },
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

export function summarizePreset(preset) {
    const cycle = preset.cycleSystem === 'abo' ? 'течка/гон (ABO)' : 'без цикла';
    let gestation;
    if (preset.gestationType === 'staged') {
        const s1 = preset.stages.first, s2 = preset.stages.second;
        gestation = `две фазы — ${s1.label} (${s1.weeks} нед.) → ${s2.label} (${s2.weeks} нед.)`;
    } else {
        gestation = 'обычная беременность (одна фаза)';
    }
    return `Цикл: ${cycle} · Вынашивание: ${gestation}`;
}

// Суммарная длительность вынашивания в неделях: у staged — сумма двух фаз,
// у live — своя длительность у кастома (preset._pregnancyDuration), иначе
// общая настройка pregnancyDuration (дефолт 40).
export function getTotalWeeks(preset, pregnancyDuration) {
    if (preset.gestationType === 'staged') {
        return preset.stages.first.weeks + preset.stages.second.weeks;
    }
    if (preset._pregnancyDuration) return preset._pregnancyDuration;
    return Math.max(1, parseInt(pregnancyDuration) || 40);
}

// Собирает кастомный пресет (settings.customPreset) в ту же форму, что и
// встроенные UNIVERSE_PRESETS — чтобы весь остальной код не знал разницы.
export function buildCustomPreset(cp) {
    if (!cp) return UNIVERSE_PRESETS.mpreg;
    const preset = {
        id: 'custom',
        label: cp.label || 'Кастом',
        sublabel: cp.sublabel || '',
        color: cp.color || '#5a5850',
        cycleSystem: cp.cycleSystem === 'abo' ? 'abo' : 'none',
        gestationType: cp.gestationType === 'staged' ? 'staged' : 'live',
        offspringRange: {
            min: Math.max(1, parseInt(cp.offspringRange?.min) || 1),
            max: Math.max(1, parseInt(cp.offspringRange?.max) || 1, parseInt(cp.offspringRange?.min) || 1),
        },
        offspringLabel: cp.offspringLabel || 'Детей',
    };
    if (preset.gestationType === 'staged') {
        preset.stages = {
            first:  { key: 'formation', label: cp.stages?.first?.label || 'Формирование', weeks: Math.max(1, parseInt(cp.stages?.first?.weeks) || 20) },
            second: { key: 'clutch',    label: cp.stages?.second?.label || 'Кладка и инкубация', weeks: Math.max(1, parseInt(cp.stages?.second?.weeks) || 20) },
        };
    } else {
        preset._pregnancyDuration = Math.max(1, parseInt(cp.pregnancyDuration) || 40);
    }
    return preset;
}

// ── Розыгрыш количества потомства: не равномерный рандом по диапазону,
// а затухающий шанс "ещё один" — как twinsChance/tripletsChance у вдохновителя,
// только обобщённый на любой диапазон (1-3 у людей/драконов, 3-12 у мерфолка).
// Шанс на первого "лишнего" — OFFSPRING_STEP_CHANCE, на каждого следующего —
// в OFFSPRING_STEP_DECAY раз меньше предыдущего.
export const OFFSPRING_STEP_CHANCE = 0.16;
export const OFFSPRING_STEP_DECAY = 0.3;

export function rollOffspringCount(range) {
    let count = range.min;
    let chance = OFFSPRING_STEP_CHANCE;
    while (count < range.max) {
        if (Math.random() < chance) {
            count++;
            chance *= OFFSPRING_STEP_DECAY;
        } else {
            break;
        }
    }
    return count;
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

// Виды контрацепции и их надёжность — как у вдохновителя. Пока только
// хранится и показывается; сама механика зачатия (Этап 9) будет её учитывать.
export const CONTRACEPTION_TYPES = {
    none:   { id: 'none',   label: 'Нет защиты', chance: 0 },
    condom: { id: 'condom', label: 'Презерватив', chance: 85 },
    pill:   { id: 'pill',   label: 'Таблетки', chance: 91 },
    iud:    { id: 'iud',    label: 'ВМС', chance: 99 },
};

export const defaultSettings = {
    isEnabled: true,
    chatData: {},
    // Длины циклов течки/гона — общие на все ABO-вселенные. Разбивка по видам
    // (у драконов гон может идти иначе, чем у людей) — конструктор кастома.
    heatCycleLength: 42,
    heatDuration: 5,
    rutCycleLength: 70,
    rutDuration: 3,
    // Длительность обычной (live) беременности в неделях — для mpreg/омегаверса.
    pregnancyDuration: 40,
    // Показывать ли уведомления о событиях (Этап 10 — сама механика уведомлений).
    showNotifications: true,
    // Скрытая беременность — герой не знает о зачатии, пока не заметит сам
    // (Этап 9 — сама механика скрытия).
    hiddenPregnancy: true,
    // Кастомная вселенная (5-й слот) — конструктор в разделе "Настройки".
    // isConfigured: false — вкладка задизейблена, пока не сохранили хотя бы раз.
    customPreset: {
        isConfigured: false,
        label: 'Кастом',
        sublabel: '',
        color: '#5a5850',
        cycleSystem: 'none',
        gestationType: 'live',
        pregnancyDuration: 40,
        stages: {
            first: { label: 'Формирование', weeks: 20 },
            second: { label: 'Кладка и инкубация', weeks: 20 },
        },
        offspringRange: { min: 1, max: 1 },
        offspringLabel: 'Детей',
    },
};

// Дефолт беременности одного персонажа.
export const defaultPregnancyData = {
    isPregnant: false,
    weeks: 0,
    stage: 'formation', // используется только при gestationType: 'staged'
    offspringCount: 1,
    // Знает ли персонаж о беременности (актуально только если settings.hiddenPregnancy = true).
    pregnancyKnown: false,
    // Пол потомства: массив 'M'|'F'|'unknown' длиной offspringCount.
    // Разыгрывается при зачатии, но СКРЫТ до раскрытия (тег SEX_REVEAL или вручную).
    offspringSex: [],
    sexRevealed: false,
    // Остаток дней < 7 между автоматическими продвижениями времени — чтобы
    // не терять точность, накапливая дробные недели от DAYS_PASSED тегов.
    _dayRemainder: 0,
};

// Дефолт для одного персонажа (заполняется лениво под ключами user/char).
export const defaultCharacterData = {
    designation: 'beta',
    cycleDay: 1,
    canCarry: false,
    // Своя контрацепция на персонажа и на чат — не глобальная настройка,
    // потому что один и тот же герой может быть на таблетках в одной истории
    // и без защиты в другой.
    contraception: 'none',
    pregnancy: { ...defaultPregnancyData },
};

export const defaultChatData = {
    universe: DEFAULT_UNIVERSE,
    characters: {
        user: { designation: 'omega', cycleDay: 1, canCarry: false, pregnancy: { ...defaultPregnancyData } },
        char: { designation: 'alpha', cycleDay: 1, canCarry: false, pregnancy: { ...defaultPregnancyData } },
    },
    // Дети общие на семью, не привязаны к конкретному родителю-носителю.
    children: [],
    grownChildren: [],
    // Счётчик прошедших в истории дней (двигается тегом DAYS_PASSED от модели).
    rpDay: 0,
    // Остаток дней < 7 для взросления детей отдельно от беременностей.
    _ageDayRemainder: 0,
    // Последняя потеря беременности по каждому носителю — для UI и промпта:
    // { reason: 'miscarriage'|'abortion'|'manual', stage, offspringCount, rpDay }
    lastLoss: { user: null, char: null },
    // Анти-воскрешение (как у вдохновителя): после потери модель не должна
    // «вернуть» беременность из старого контекста. Числа — длина чата, до
    // которой соответствующие теги игнорируются.
    _conceptionBlockedUntil: { user: 0, char: 0 },
    _birthBlockedUntil: { user: 0, char: 0 },
};
