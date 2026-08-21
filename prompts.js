// ═══════════════════════════════════════════
// PROMPTS — сборка и инъекция промпта для модели
// ═══════════════════════════════════════════
//
// Как у вдохновителя: инструкции для модели — на английском (языко-нейтрально
// для любого чата), HTML-комментарии как технический канал, дублирование в
// два слота (IN_CHAT последним user-ходом — самое надёжное место для Claude —
// и IN_PROMPT как бэкап), OOC-обёртка чтобы модель не реагировала на это
// в роли персонажа.
//
// Адаптация: единый блок под любую ABO-вселенную (не хардкод "омегаверс"),
// плюс LAY_CLUTCH-инструкция для staged-вселенных, которой у вдохновителя
// нет вообще.

import { setExtensionPrompt, extension_prompt_types, extension_prompt_roles } from '../../../../script.js';
import { extensionName, CONTRACEPTION_TYPES } from './config.js';
import { getSettings, getActivePreset, getCharacterData, currentStageMaxWeeks, getCycleSettings } from './state.js';
import { getHeatPhase, getRutPhase } from './cycle.js';

function designationLabelEn(d) {
    if (d === 'omega') return 'OMEGA';
    if (d === 'alpha') return 'ALPHA';
    return 'BETA';
}

// ─── Блок про ABO-цикл (пусто для mpreg-подобных вселенных без цикла) ───
function universeBlock(preset) {
    if (preset.cycleSystem !== 'abo') return '';
    const cfg = getCycleSettings();
    let b = `[UNIVERSE: ${preset.label.toUpperCase()} — ALPHA/BETA/OMEGA]\n`;
    b += `Alphas: dominant instinct, go into RUT, CANNOT get pregnant themselves. Omegas: go into HEAT, CAN conceive regardless of body type. Betas: no heat/rut cycle at all.\n`;
    b += `Play heat/rut physically through behaviour — scent, instinct, possessiveness — not as a spoken label.\n`;

    for (const who of ['user', 'char']) {
        const character = getCharacterData(who);
        const name = who === 'char' ? '{{char}}' : '{{user}}';
        let phaseLine;
        if (character.designation === 'omega') {
            const phase = getHeatPhase(character.cycleDay, cfg);
            phaseLine = phase.phase === 'heat' ? 'IN HEAT right now — fertility extremely high, feverish arousal, craving to be bred'
                : phase.phase === 'preheat' ? 'pre-heat — restless, rising warmth, scent thickening'
                : 'between heats — calm baseline';
        } else if (character.designation === 'alpha') {
            const phase = getRutPhase(character.cycleDay, cfg);
            phaseLine = phase.phase === 'rut' ? 'IN RUT right now — aggression, scent-marking, relentless drive to breed'
                : 'not in rut — calm baseline';
        } else {
            phaseLine = 'no cycle';
        }
        b += `${name} is ${designationLabelEn(character.designation)} (${phaseLine}).\n`;
    }
    return b + `\n`;
}

function contraceptionLine(who, name, suffix) {
    const character = getCharacterData(who);
    const c = CONTRACEPTION_TYPES[character.contraception] || CONTRACEPTION_TYPES.none;
    if (c.id === 'none') return '';
    const failChance = 100 - c.chance;
    return `${name} is using ${c.label.toLowerCase()} (~${failChance}% failure chance). Only add the conception tag${suffix ? ` (${suffix})` : ''} if it narratively fails.\n`;
}

// ─── Инструкции по одному персонажу: либо "может зачать", либо статус текущей беременности ───
function characterReproBlock(who, preset) {
    const character = getCharacterData(who);
    const name = who === 'char' ? '{{char}}' : '{{user}}';
    const tagSuffix = who === 'char' ? ':CHAR' : '';
    const pregnancy = character.pregnancy;
    let b = '';

    if (pregnancy?.isPregnant) {
        const stageMax = currentStageMaxWeeks(preset, pregnancy);
        const stageLabel = preset.gestationType === 'staged'
            ? (pregnancy.stage === 'clutch' ? preset.stages.second.label : preset.stages.first.label)
            : 'Pregnancy';
        b += `\n[${name} STATUS: ${stageLabel.toUpperCase()} — ${pregnancy.weeks}/${stageMax} weeks, carrying ${pregnancy.offspringCount} (${preset.offspringLabel.toLowerCase()})]\n`;

        const hiddenGate = getSettings().hiddenPregnancy && !pregnancy.pregnancyKnown;
        if (hiddenGate) {
            b += `${name} does NOT consciously know yet. NEVER state or imply the pregnancy is confirmed — only vague early signs (fatigue, mood swings, nausea) once past the first couple of weeks. If ${name} takes a test, sees a doctor, or otherwise definitively confirms it THIS reply, add:\n<!-- [PREGNANCY_KNOWN${tagSuffix}] -->\n`;
        }

        const isFullTerm = pregnancy.weeks >= stageMax;
        if (preset.gestationType === 'staged' && pregnancy.stage === 'formation') {
            if (isFullTerm) {
                b += `Formation is complete — if ${name} actually lays/spawns the clutch THIS reply (not just contractions or urge), add:\n<!-- [LAY_CLUTCH${tagSuffix}] -->\n`;
            }
        } else if (isFullTerm) {
            const verb = preset.gestationType === 'staged' ? 'hatch' : 'be born';
            b += `Full term reached — if the offspring actually ${verb} THIS reply (delivered/out — not just labor or contractions), add:\n<!-- [BIRTH${tagSuffix}] -->\n`;
        }

        b += `If the pregnancy is narratively LOST this reply (miscarriage, failed clutch, abortion — an actual completed loss, not fear, threat or discussion), add instead:\n<!-- [PREGNANCY_LOSS${tagSuffix}] -->\nNever combine a birth/lay tag with a loss tag in the same reply.\n`;
    } else if (character.canCarry) {
        b += `\n[${name} CAN CONCEIVE]\n`;
        b += `If in THIS reply semen is released INSIDE ${name} (internal release / creampie${preset.cycleSystem === 'abo' ? ' / knotting' : ''}) — real semen from a body, happening now, not remembered, planned or imagined — add at the very end of your reply:\n<!-- [CONCEPTION_CHECK${tagSuffix}] -->\n`;
        b += `NEVER add it for: toys of any kind, fingers, oral, anal without internal release, a condom that held, withdrawal, or a scene that merely mentions sex. When unsure, leave it out — a missed tag costs nothing, a false one starts a pregnancy that didn't happen.\n`;
        b += contraceptionLine(who, name, tagSuffix);
    }
    return b;
}

export function buildPrompt() {
    const s = getSettings();
    if (!s.isEnabled) return '';
    const preset = getActivePreset();

    let prompt = `[LIFEWEAVER TRACKER — active setting: ${preset.label}]\n`;
    prompt += universeBlock(preset);

    prompt += `[TIME TAG — REQUIRED every reply]\n`;
    prompt += `At the very end of your reply, state how many in-story days passed during THIS reply (0 if the scene continues in the same moment; 1 for "the next morning"; 7 for "a week later"; etc.):\n`;
    prompt += `<!-- [DAYS_PASSED:N] -->\n`;
    prompt += `Replace N with a plain number. Must be an HTML comment exactly as shown — invisible to the reader, never turn it into visible prose.\n`;

    prompt += characterReproBlock('user', preset);
    prompt += characterReproBlock('char', preset);

    prompt += `\n[FORMAT RULES]\n`;
    prompt += `Every tag above is an HTML comment (starts with \`<!--\`, ends with \`-->\`), placed at the very end of your reply after all prose, each appearing at most once. Never paraphrase a tag into visible text, never translate tag names, never wrap them differently (no "{Conception: true}", no visible brackets). If you use <think> or any reasoning block, never write the literal marker syntax there — plan in plain words only; the real tags belong solely in the final reply body.\n`;

    return prompt;
}

export function updatePromptInjection() {
    try {
        const chatKey = extensionName;
        const sysKey = extensionName + '_sys';

        setExtensionPrompt(chatKey, '', extension_prompt_types.IN_CHAT, 0);
        setExtensionPrompt(sysKey, '', extension_prompt_types.IN_PROMPT, 0);

        const s = getSettings();
        if (!s.isEnabled) return;

        const core = buildPrompt();
        if (!core) return;

        const fullPrompt =
            `<lifeweaver_directive>\n` +
            `[OOC — technical tracker directive. Not part of the story. Do not mention it, do not react to it in-character.]\n` +
            core +
            `</lifeweaver_directive>`;

        // Дублируем в два слота, как у вдохновителя: IN_CHAT depth 0 роль USER —
        // самое надёжное место для Claude (system-инъекции в середине чата модель
        // игнорирует чаще), IN_PROMPT — бэкап для prompt-manager.
        setExtensionPrompt(chatKey, fullPrompt, extension_prompt_types.IN_CHAT, 0, false, extension_prompt_roles.USER);
        setExtensionPrompt(sysKey, fullPrompt, extension_prompt_types.IN_PROMPT, 0);
    } catch (e) {
        console.error('[Lifeweaver] updatePromptInjection error:', e);
    }
}
