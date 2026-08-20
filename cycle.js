// ═══════════════════════════════════════════
// CYCLE — расчёт фазы течки (омега) и гона (альфа)
// Чистые функции, не трогают ST — легко тестировать/переиспользовать.
// ═══════════════════════════════════════════

export function getHeatPhase(day, cfg) {
    const len = cfg.heatCycleLength;
    const dur = cfg.heatDuration;
    let d = ((parseInt(day) || 1) - 1) % len + 1;
    if (d < 1) d += len;

    if (d <= dur) {
        return { phase: 'heat', day: d, len, label: `Течка · день ${d} из ${dur}`, daysLeft: dur - d + 1 };
    }
    if (d > len - 2) {
        return { phase: 'preheat', day: d, len, label: `Предтечка · начнётся через ${len - d + 1} дн.`, daysLeft: len - d + 1 };
    }
    return { phase: 'normal', day: d, len, label: `Спокойно · до течки ${len - d + 1} дн.`, daysLeft: len - d + 1 };
}

export function getRutPhase(day, cfg) {
    const len = cfg.rutCycleLength;
    const dur = cfg.rutDuration;
    let d = ((parseInt(day) || 1) - 1) % len + 1;
    if (d < 1) d += len;

    if (d <= dur) {
        return { phase: 'rut', day: d, len, label: `Гон · день ${d} из ${dur}`, daysLeft: dur - d + 1 };
    }
    return { phase: 'normal', day: d, len, label: `Вне гона · до гона ${len - d + 1} дн.`, daysLeft: len - d + 1 };
}
