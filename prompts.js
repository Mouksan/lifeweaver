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
import { getSettings, getActivePreset, getCharacterData, currentStageMaxWeeks, getCycleSettings, getLastLoss, getChildren, isPregnancyObvious, getChildrenMissingTraits, getChildrenMissingNames, getTimeOfDay, getRpDay } from './state.js';
import { getHeatPhase, getRutPhase } from './cycle.js';
import { childAgeDays, getGrowthStage, getCareNorms, getCareNeeds, timeBucket, formatAge, sexLabel } from './baby-care.js';

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
        const loss = getLastLoss(who);
        if (loss) {
            const what = loss.reason === 'abortion' ? 'terminated' : 'lost';
            return `${name}: NOT pregnant — the previous pregnancy was ${what}. Never write or imply ${name} is still pregnant; do not resurrect it from earlier context.\n`;
        }
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

        // Скрытая беременность действует только пока срок не стал очевидным:
        // на 20-й неделе или после отложенной кладки скрывать уже нечего.
        const hiddenGate = getSettings().hiddenPregnancy && !isPregnancyObvious(who);
        if (hiddenGate) {
            b += `${name} does NOT consciously know yet — never state or imply the pregnancy is confirmed, only vague early signs once past the first couple of weeks. If ${name} definitively confirms it (test, doctor) THIS reply, add: <!-- [PREGNANCY_KNOWN${tagSuffix}] -->\n`;
        }

        // ВАЖНО (как у вдохновителя): инструкция висит ВСЁ ВРЕМЯ, пока идёт
        // беременность, а не только по достижении полного срока. Событие и
        // достижение срока происходят в ОДНОМ ответе — если показывать
        // инструкцию только по факту полного срока, она опаздывает на ход,
        // и модель уже не станет заново описывать то, что описала абзацем выше.
        // Плюс роды/кладка могут случиться раньше срока по сюжету.
        const nearTerm = pregnancy.weeks >= Math.floor(stageMax * 0.85);
        const urgency = nearTerm ? ' — DUE NOW, this is expected any moment' : '';

        // Раскрытие пола — пока не раскрыт
        if (!pregnancy.sexRevealed) {
            b += `If the sex of the offspring is definitively revealed THIS reply (scan, healer, magic, hatching), add: <!-- [SEX_REVEAL${tagSuffix}:M] --> — list one letter per offspring, M or F, comma-separated (${pregnancy.offspringCount} total).\n`;
        }

        if (preset.gestationType === 'staged' && pregnancy.stage === 'formation') {
            b += `If ${name} actually lays/spawns the clutch THIS reply${urgency} (the ${preset.offspringLabel.toLowerCase()} come out — not just contractions or the urge), add: <!-- [LAY_CLUTCH${tagSuffix}] -->\n`;
        } else {
            const verb = preset.gestationType === 'staged' ? 'hatch' : 'are born';
            b += `If the offspring actually ${verb} THIS reply${urgency} (out and separate — not just labor or contractions), add: <!-- [BIRTH${tagSuffix}] --> — this single short tag is what matters most; never skip it because a longer optional tag felt like too much.\n`;
            b += `OPTIONAL, only if the birth tag is already there: <!-- [BABY_TRAITS${tagSuffix}:{"babies":[{"name":"","personality":["…"],"appearance":["…"]}]}] --> (values in Russian, up to ${pregnancy.offspringCount} entr${pregnancy.offspringCount === 1 ? 'y' : 'ies'}).\n`;
            if (pregnancy.offspringCount > 1) {
                b += `They are not all born at once — describe only the ones actually out in this reply and leave the rest for later replies; the tracker will ask for the others by name.\n`;
            }
        }

        // Прерывание: формулировки зависят от стадии — на инкубации теряют
        // уже отложенную кладку, а не вынашиваемый плод.
        const inClutch = preset.gestationType === 'staged' && pregnancy.stage === 'clutch';
        const lossWhat = inClutch
            ? `the clutch is destroyed or dies (crushed, gone cold, confirmed dead — not merely at risk)`
            : `the pregnancy is LOST (confirmed loss — heavy bleeding with loss, doctor confirms it, not mere pain, fear or a threat)`;
        const endWhat = inClutch
            ? `the clutch is deliberately destroyed or discarded THIS reply (actually done, not just discussed or threatened)`
            : `an abortion is actually performed on ${name} THIS reply (procedure completed — not discussed, planned, or on the way to the clinic)`;

        b += `If ${lossWhat} THIS reply, add: <!-- [MISCARRIAGE${tagSuffix}] -->\n`;
        b += `If ${endWhat}, add instead: <!-- [ABORTION${tagSuffix}] -->\n`;
        b += `Never combine either with a birth/lay tag in the same reply.\n`;
    } else if (character.canCarry) {
        b += `If in THIS reply semen is released INSIDE ${name} (internal release / creampie${preset.cycleSystem === 'abo' ? ' / knotting' : ''}) — real semen from a body, happening now — add: <!-- [CONCEPTION_CHECK${tagSuffix}] -->. NEVER for toys, fingers, oral, anal without internal release, a condom that held, or a scene that merely mentions sex.\n`;
        b += contraceptionLine(who, name, tagSuffix);
    }
    return b;
}

// ─── Контекст: живые дети (возраст, стадия, что сейчас актуально) ───
function childrenContext(preset) {
    const children = getChildren();
    if (children.length === 0) return '';

    const tod = timeBucket(getTimeOfDay());
    let b = `\nChildren currently in the family (${children.length}) — #N is the tracker's reference number for each. Current time of day: ${tod.id}.\n`;
    for (let i = 0; i < children.length; i++) {
        const child = children[i];
        const ref = i + 1;
        const ageDays = childAgeDays(child);
        const stage = getGrowthStage(ageDays);
        const norms = getCareNorms(ageDays, child);
        const who = child.parentWho === 'char' ? '{{char}}' : '{{user}}';

        const bits = [];
        bits.push(`${formatAge(ageDays)}`);
        if (stage) bits.push(stage.label);
        if (child.sex && child.sex !== 'unknown') bits.push(sexLabel(child.sex));
        const name = child.name || 'NOT NAMED YET';
        b += `#${ref} ${name} (born to ${who}): ${bits.join(', ')}.\n`;

        if (child.personality?.length) b += `  personality: ${child.personality.join(', ')}.\n`;
        if (child.appearance?.length) b += `  looks: ${child.appearance.join(', ')}.\n`;
        if (!child.personality?.length || !child.appearance?.length) {
            b += `  (not described yet — invent it when this one first gets narrative attention)\n`;
        }

        // Состояние ПРЯМО СЕЙЧАС — то, что модель должна отыгрывать в сцене
        const needs = getCareNeeds(ageDays, getTimeOfDay(), child, getRpDay());
        const nowBits = [needs.feeding, needs.sleep, needs.diaper && `подгузник: ${needs.diaper}`]
            .filter(Boolean).join(', ');
        b += `  RIGHT NOW: ${nowBits}.${needs.careNote ? ` (${needs.careNote})` : ''}\n`;

        const care = [];
        care.push(norms.feeding);
        care.push(norms.sleep);
        if (ageDays < 1095) care.push(norms.diaper);
        if (norms.teething) care.push(norms.teething);
        if (norms.colic) care.push('колики — вечерний плач без причины');
        b += `  age norms: ${care.filter(Boolean).join('; ')}.\n`;
        if (norms.upcoming) b += `  may soon: ${norms.upcoming}.\n`;
    }
    b += `Keep each child's behaviour and abilities consistent with the age above — a newborn cannot walk or talk.\n`;
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
    prompt += childrenContext(preset);

    // ── Реальные теги, которые нужно ПОСТАВИТЬ ──
    prompt += `\n=== REQUIRED TAGS FOR THIS REPLY ===\n`;
    prompt += `1. ALWAYS: state how many in-story days passed THIS reply (0 = same moment; 1 = next morning; 7 = a week later): <!-- [DAYS_PASSED:N] --> — replace N with a plain number.\n`;
    prompt += characterTagBlock('user', preset);
    prompt += characterTagBlock('char', preset);

    // Время суток нужно только пока есть малыши — от него зависят их потребности
    if (getChildren().some(c => (c.ageWeeks || 0) * 7 < 1095)) {
        prompt += `If the time of day in the scene is different from "${timeBucket(getTimeOfDay()).id}" or changes this reply, state it (one word: night, morning, day, evening): <!-- [TIME_OF_DAY:day] -->\n`;
    }

    // Поэтапное вылупление: у детей, появившихся позже первого, черт ещё нет
    const children = getChildren();
    const undescribed = getChildrenMissingTraits();
    const unnamed = getChildrenMissingNames();
    if (undescribed.length > 0 || unnamed.length > 0) {
        const refOf = (c) => `#${children.indexOf(c) + 1}`;
        const pending = [];
        if (undescribed.length) pending.push(`not described yet: ${undescribed.map(refOf).join(', ')}`);
        if (unnamed.length) pending.push(`still unnamed: ${unnamed.map(refOf).join(', ')}`);
        prompt += `\nPending children — ${pending.join('; ')}. Offspring arrive one at a time, and parents often name a child only days later, so this is normal — never invent a name the parents have not actually chosen in the story.\n`;
        prompt += `When a pending child is genuinely described, or the parents finally settle on a name for one, record it (omit fields you have nothing for):\n`;
        prompt += `<!-- [CHILD_TRAITS:{"children":[{"ref":1,"name":"…","personality":["…","…"],"appearance":["…","…"]}]}] -->\n`;
        prompt += `"ref" is the #N number above — always include it. Values in Russian. Describe them as people first — eye colour, hair, face, build, temperament — since every species here has a largely human body; add species-specific details (tail, fins, scales, horns) alongside, not instead.\n`;
    }

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
