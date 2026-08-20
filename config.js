// ═══════════════════════════════════════════
// CONFIG — константы и настройки по умолчанию
// ═══════════════════════════════════════════
//
// Этап 2: модель вселенных-конструктор.
// Две независимые оси вместо захардкоженных отдельных "миров":
//   cycleSystem:   'none' (нет цикла, мпрег)  | 'abo' (течка/гон)
//   gestationType: 'live' (одна фаза, обычная беременность)
//                | 'staged' (две фазы: внутреннее формирование → кладка/нерест + инкубация)
//
// Кастомный 5-й слот (свой пресет) приезжает на Этапе 8 — там же
// будет UI-конструктор поверх этих же двух осей, без нового кода.

export const extensionName = 'third-party/lifeweaver';

export const UNIVERSE_PRESETS = {
    mpreg: {
        id: 'mpreg',
        label: 'Обычный (MPREG)',
        cycleSystem: 'none',
        gestationType: 'live',
    },
    omegaverse: {
        id: 'omegaverse',
        label: 'Омегаверс',
        cycleSystem: 'abo',
        gestationType: 'live',
    },
    dragon: {
        id: 'dragon',
        label: 'Драконы',
        cycleSystem: 'abo',
        gestationType: 'staged',
        stages: {
            first:  { key: 'formation', label: 'Формирование', weeks: 20 },
            second: { key: 'clutch',    label: 'Кладка и инкубация', weeks: 20 },
        },
    },
    merfolk: {
        id: 'merfolk',
        label: 'Рыбки',
        cycleSystem: 'abo',
        gestationType: 'staged',
        // Длительности — плейсхолдер, донастроим числа на Этапе 8 (конструктор).
        stages: {
            first:  { key: 'formation', label: 'Вынашивание', weeks: 20 },
            second: { key: 'clutch',    label: 'Нерест и инкубация', weeks: 20 },
        },
    },
};

export const DEFAULT_UNIVERSE = 'mpreg';

export function getPreset(universeId) {
    return UNIVERSE_PRESETS[universeId] || UNIVERSE_PRESETS[DEFAULT_UNIVERSE];
}

// Короткая читаемая сводка пресета — временно используется в тестовом
// readout'е на Этапе 2, потом перекочует в промпт-модуль (Этап 9).
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

export const defaultSettings = {
    isEnabled: true,
    chatData: {},
};

// Дефолтная форма per-chat данных.
export const defaultChatData = {
    universe: DEFAULT_UNIVERSE,
};
