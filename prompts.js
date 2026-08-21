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
//
// ИСПРАВЛЕНО (модель не ставила теги, эхом повторяла заголовки): раньше
// собственные информационные заголовки промпта тоже были в квадратных
// скобках ([LIFEWEAVER TRACKER...], [{{name}} STATUS...]) — визуально
// неотличимо от настоящих тегов. Модель путала одно с другим: повторяла
// наши заголовки в комментарии, а настоящие требуемые теги не ставила.
// Теперь контекст — без скобок (стиль "==="/обычные предложения), явно
// помечен "не повторяй", а реальные теги вынесены в отдельный блок и
// продублированы усиленным напоминанием в самом конце (там модель следует
// инструкциям надёжнее всего — эффект недавности).

import { setExtensionPrompt, extension_prompt_types, extension_prompt_roles } from '../../../../script.js';
import { extensionName, CONTRACEPTION_TYPES } from './config.js';
import { getSettings, getActivePreset, getCharacterData, currentStageMaxWeeks, getCycleSettings } from './state.js';
import { getHeatPhase, getRutPhase } from './cycle.js';

function designationLabelEn(d) {
    if (d === 'omega') return 'OMEGA';
    if (d === 'alpha') return 'ALPHA';
    return 'BETA';
}

// ─── Контекст: цикл/designation (пусто для mpreg-подобных вселенных без цикла) ───
function universeContext(preset) {
    if (preset.cycleSystem !== 'abo') return '';
    const cfg = getCycleSettings();
    let b = `Setting uses alpha/beta/omega dynamics. Alphas: dominant instinct, go into RUT, CANNOT get pregnant themselves. Omegas: go into HEAT, CAN conceive regardless of body type. Betas: no heat/rut cycle at all. Play heat/rut physically through behaviour — scent, instinct, possessiveness — not as a spoken label.\n`;

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
    return b;
}

// ─── Контекст: текущий статус персонажа (просто предложение, не заголовок в скобках) ───
function characterStatusContext(who, preset) {
    const character = getCharacterData(who);
    const name = who === 'char' ? '{{char}}' : '{{user}}';
    const pregnancy = character.pregnancy;

    if (pregnancy?.isPregnant) {
        const stageMax = currentStageMaxWeeks(preset, pregnancy);
        const stageLabel = preset.gestationType === 'staged'
            ? (pregnancy.stage === 'clutch' ? preset.stages.second.label : preset.stages.first.label)
            : 'pregnant';
        return `${name}: currently ${stageLabel.toLowerCase()}, ${pregnancy.weeks}/${stageMax} weeks, carrying ${pregnancy.offspringCount} ${preset.offspringLabel.toLowerCase()}.\n`;
    }
    if (character.canCarry) {
        return `${name}: can conceive, not currently pregnant.\n`;
    }
    return '';
}

function contraceptionLine(who, name, suffix) {
    const character = getCharacterData(who);
    const c = CONTRACEPTION_TYPES[character.contraception] || CONTRACEPTION_TYPES.none;
    if (c.id === 'none') return '';
    const failChance = 100 - c.chance;
    return `${name} is using ${c.label.toLowerCase()} (~${failChance}% failure chance) — only add the conception tag${suffix ? ` (${suffix})` : ''} if it narratively fails.\n`;
}

// ─── Реальные условные теги по одному персонажу — отдельно от контекста выше ───
function characterTagBlock(who, preset) {
    const character = getCharacterData(who);
    const name = who === 'char' ? '{{char}}' : '{{user}}';
    const tagSuffix = who === 'char' ? ':CHAR' : '';
    const pregnancy = character.pregnancy;
    let b = '';

    if (pregnancy?.isPregnant) {
        const stageMax = currentStageMaxWeeks(preset, pregnancy);

        const hiddenGate = getSettings().hiddenPregnancy && !pregnancy.pregnancyKnown;
        if (hiddenGate) {
            b += `${name} does NOT consciously know yet — never state or imply the pregnancy is confirmed, only vague early signs once past the first couple of weeks. If ${name} definitively confirms it (test, doctor) THIS reply, add: <!-- [PREGNANCY_KNOWN${tagSuffix}] -->\n`;
        }

        const isFullTerm = pregnancy.weeks >= stageMax;
        if (preset.gestationType === 'staged' && pregnancy.stage === 'formation') {
            if (isFullTerm) {
                b += `${name}'s formation phase is complete — if the clutch is actually laid/spawned THIS reply (not just contractions or urge), add: <!-- [LAY_CLUTCH${tagSuffix}] -->\n`;
            }
        } else if (isFullTerm) {
            const verb = preset.gestationType === 'staged' ? 'hatch' : 'be born';
            b += `${name} is at full term — if the offspring actually ${verb} THIS reply (delivered/out, not just labor), add: <!-- [BIRTH${tagSuffix}] -->\n`;
        }

        b += `If ${name}'s pregnancy is narratively LOST this reply (miscarriage, failed clutch, abortion — an actual completed loss, not fear or discussion), add instead: <!-- [PREGNANCY_LOSS${tagSuffix}] --> (never combine with a birth/lay tag).\n`;
    } else if (character.canCarry) {
        b += `If in THIS reply semen is released INSIDE ${name} (internal release / creampie${preset.cycleSystem === 'abo' ? ' / knotting' : ''}) — real semen from a body, happening now — add: <!-- [CONCEPTION_CHECK${tagSuffix}] -->. NEVER for toys, fingers, oral, anal without internal release, a condom that held, or a scene that merely mentions sex.\n`;
        b += contraceptionLine(who, name, tagSuffix);
    }
    return b;
}

export function buildPrompt() {
    const s = getSettings();
    if (!s.isEnabled) return '';
    const preset = getActivePreset();

    // ── Контекст: только для понимания сцены, НЕ для повторения обратно ──
    let prompt = `=== LIFEWEAVER TRACKER — context only, do NOT repeat these lines back in any form (not as prose, not as a comment) ===\n`;
    prompt += `Active setting: ${preset.label}. Call the offspring "${preset.offspringLabel.toLowerCase()}" specifically in narration, not a generic/different word.\n`;
    prompt += universeContext(preset);
    prompt += characterStatusContext('user', preset);
    prompt += characterStatusContext('char', preset);

    // ── Реальные теги, которые нужно ПОСТАВИТЬ ──
    prompt += `\n=== REQUIRED TAGS FOR THIS REPLY ===\n`;
    prompt += `1. ALWAYS: state how many in-story days passed THIS reply (0 = same moment; 1 = next morning; 7 = a week later): <!-- [DAYS_PASSED:N] --> — replace N with a plain number.\n`;
    prompt += characterTagBlock('user', preset);
    prompt += characterTagBlock('char', preset);

    // ── Compliance — последним, чтобы модель держала это в фокусе ──
    prompt += `\n=== COMPLIANCE (read last, applies above everything else) ===\n`;
    prompt += `The DAYS_PASSED tag is MANDATORY in every single reply, no exceptions — even with other status/summary systems already active in this chat, even if other instructions ask to minimize OOC content. It is an invisible HTML comment, not visible narration — it never breaks formatting or immersion. A reply missing it is malformed. The other tags above are conditional — add them ONLY when their trigger condition is actually met this reply.\n`;
    prompt += `Every tag is an HTML comment (\`<!--\` ... \`-->\`), placed at the very end of your reply after all prose and after any other extension's blocks, each appearing at most once. Never paraphrase a tag into visible text, never translate tag names, never use a different bracket style. If you use <think> or any reasoning block, never write the literal marker syntax there — plan in plain words only; the real tags belong solely in the final reply body.\n`;

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
