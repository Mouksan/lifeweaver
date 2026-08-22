// ═══════════════════════════════════════════
// HEALTH — осложнения, тесты на беременность, статус здоровья
// ═══════════════════════════════════════════
//
// Портировано с helpers.js / fertility.js вдохновителя. Их ключевая идея,
// которую берём целиком: ВСЕ осложнения разыгрываются ОДИН РАЗ при зачатии,
// каждому назначается неделя раскрытия — либо оно случится тогда, либо не
// случится вовсе. Судьба беременности определена заранее, а не переигрывается
// рулеткой каждую неделю.
//
// Адаптация (те же мозги, своя специфика): их пул чисто человеческий и завязан
// на плаценту, матку и 40 недель. Он остаётся для мпрега и омегаверса как есть.
// Для двухфазных вселенных добавлены два своих пула: осложнения тела до кладки
// и осложнения самой кладки в гнезде. Окна недель хранятся в «родном» масштабе
// пула и масштабируются под фактическую длительность.

// ─── Пулы осложнений ───
export const COMPLICATION_POOLS = {
    // Человеческий пул вдохновителя, один в один (для live-вселенных)
    human: {
        baseWeeks: 40,
        items: [
            { type: 'Угроза выкидыша', severity: 'critical', chance: 8, weekMin: 4, weekMax: 12 },
            { type: 'Сильный токсикоз', severity: 'warning', chance: 15, weekMin: 5, weekMax: 12 },
            { type: 'Низкий прогестерон', severity: 'warning', chance: 10, weekMin: 4, weekMax: 10 },
            { type: 'Гестационный диабет', severity: 'warning', chance: 10, weekMin: 14, weekMax: 26 },
            { type: 'Анемия', severity: 'warning', chance: 12, weekMin: 14, weekMax: 26 },
            { type: 'Предлежание плаценты', severity: 'critical', chance: 5, weekMin: 16, weekMax: 24 },
            { type: 'Истмико-цервикальная недостаточность', severity: 'critical', chance: 4, weekMin: 14, weekMax: 22 },
            { type: 'Преэклампсия', severity: 'critical', chance: 8, weekMin: 28, weekMax: 38 },
            { type: 'Тазовое предлежание', severity: 'warning', chance: 12, weekMin: 30, weekMax: 37 },
            { type: 'Маловодие', severity: 'warning', chance: 7, weekMin: 28, weekMax: 38 },
            { type: 'Многоводие', severity: 'warning', chance: 5, weekMin: 28, weekMax: 38 },
            { type: 'Преждевременные схватки', severity: 'critical', chance: 6, weekMin: 28, weekMax: 36 },
        ],
    },
    // Тело носителя, пока яйца/икра формируются внутри (фаза до кладки)
    stagedBody: {
        baseWeeks: 20,
        items: [
            { type: 'Угроза потерять кладку', severity: 'critical', chance: 8, weekMin: 2, weekMax: 8 },
            { type: 'Истощение носителя', severity: 'warning', chance: 14, weekMin: 4, weekMax: 16 },
            { type: 'Слабая скорлупа', severity: 'warning', chance: 12, weekMin: 8, weekMax: 18 },
            { type: 'Нехватка минералов', severity: 'warning', chance: 11, weekMin: 6, weekMax: 16 },
            { type: 'Застрявшее яйцо', severity: 'critical', chance: 6, weekMin: 16, weekMax: 20 },
            { type: 'Неоплодотворённая часть кладки', severity: 'warning', chance: 9, weekMin: 10, weekMax: 20 },
        ],
    },
    // Кладка в гнезде — своя специфика: температура, скорлупа, внешние угрозы
    clutch: {
        baseWeeks: 20,
        items: [
            { type: 'Кладка остывает', severity: 'critical', chance: 9, weekMin: 1, weekMax: 18 },
            { type: 'Трещина в скорлупе', severity: 'warning', chance: 11, weekMin: 2, weekMax: 16 },
            { type: 'Плесень на кладке', severity: 'warning', chance: 8, weekMin: 4, weekMax: 16 },
            { type: 'Одно яйцо замерло', severity: 'warning', chance: 12, weekMin: 5, weekMax: 18 },
            { type: 'Перегрев гнезда', severity: 'critical', chance: 6, weekMin: 3, weekMax: 17 },
            { type: 'Внимание хищников', severity: 'critical', chance: 5, weekMin: 2, weekMax: 19 },
        ],
    },
};

// Какой пул использовать для тела носителя в этой вселенной
export function bodyPoolFor(preset) {
    return preset.gestationType === 'staged' ? 'stagedBody' : 'human';
}

// ─── Розыгрыш осложнений (один раз, при зачатии/кладке) ───
// Окна недель масштабируются под фактическую длительность: пул написан для
// baseWeeks, а срок может быть настроен игроком.
export function rollPlannedComplications(poolKey, totalWeeks, rnd = Math.random) {
    const pool = COMPLICATION_POOLS[poolKey];
    if (!pool) return [];
    const total = Math.max(1, parseInt(totalWeeks) || pool.baseWeeks);
    const scale = total / pool.baseWeeks;
    const planned = [];

    for (const comp of pool.items) {
        if (rnd() * 100 > comp.chance) continue;
        const lo = Math.max(1, Math.round(comp.weekMin * scale));
        const hi = Math.max(lo, Math.min(total, Math.round(comp.weekMax * scale)));
        planned.push({
            type: comp.type,
            severity: comp.severity,
            revealWeek: lo + Math.floor(rnd() * (hi - lo + 1)),
            revealed: false,
        });
    }
    return planned;
}

// Раскрывает осложнения, чья неделя наступила. Мутирует holder
// (беременность или кладку). Возвращает список раскрытых.
export function revealComplications(holder, oldWeeks, newWeeks) {
    if (!holder || !Array.isArray(holder._plannedComplications)) return [];
    if (!Array.isArray(holder.complications)) holder.complications = [];
    const revealed = [];

    for (const pc of holder._plannedComplications) {
        if (pc.revealed) continue;
        if (pc.revealWeek > oldWeeks && pc.revealWeek <= newWeeks) {
            pc.revealed = true;
            const entry = { type: pc.type, severity: pc.severity, week: pc.revealWeek, resolved: false };
            holder.complications.push(entry);
            revealed.push(entry);
        }
    }
    if (revealed.length) holder.healthStatus = computeHealthStatus(holder);
    return revealed;
}

export function computeHealthStatus(holder) {
    const list = (holder?.complications || []).filter(c => !c.resolved);
    if (list.some(c => c.severity === 'critical')) return 'critical';
    if (list.length > 0) return 'warning';
    return 'normal';
}

export function activeComplications(holder) {
    return (holder?.complications || []).filter(c => !c.resolved);
}

// ─── Визит к врачу/целителю: шансы вдохновителя ───
export const HEAL_CHANCE = { warning: 75, critical: 50 };

export function treatComplications(holder, rnd = Math.random) {
    const list = activeComplications(holder);
    let healed = 0, failed = 0;
    for (const c of list) {
        const chance = c.severity === 'critical' ? HEAL_CHANCE.critical : HEAL_CHANCE.warning;
        if (rnd() * 100 <= chance) { c.resolved = true; healed++; }
        else failed++;
    }
    holder.healthStatus = computeHealthStatus(holder);
    return { healed, failed };
}

export function getHealthInfo(status) {
    if (status === 'critical') return { text: 'Критическое', icon: 'fa-circle-exclamation', tone: 'critical' };
    if (status === 'warning') return { text: 'Требует внимания', icon: 'fa-triangle-exclamation', tone: 'warning' };
    return { text: 'Норма', icon: 'fa-circle-check', tone: 'normal' };
}

// ═══════════════════════════════════════════
// ТЕСТЫ НА БЕРЕМЕННОСТЬ — числа вдохновителя один в один
// ═══════════════════════════════════════════

export function testReliability(daysSinceConception) {
    const d = Math.max(0, parseInt(daysSinceConception) || 0);
    if (d < 8) return 0;      // до имплантации тест слеп
    if (d < 11) return 0.35;
    if (d < 14) return 0.7;
    if (d < 18) return 0.92;
    return 0.99;
}

// Результат: 'positive' | 'faint' | 'negative'
export function rollTest(isPregnant, daysSinceConception, rnd = Math.random) {
    if (!isPregnant) return 'negative';
    const rel = testReliability(daysSinceConception);
    if (rel === 0) return 'negative';
    if (rnd() > rel) return 'negative';
    return daysSinceConception < 14 ? 'faint' : 'positive';
}

export const TEST_LABELS = {
    positive: 'Положительный',
    faint: 'Слабая вторая полоска',
    negative: 'Отрицательный',
};

// Детерминированный «бросок» от сеанса и дня: результат теста не должен
// прыгать при каждой перерисовке промпта — в пределах одного дня истории
// он один и тот же, иначе модель напишет одно, а панель покажет другое.
export function seededRandom(seedStr) {
    let h = 2166136261;
    for (let i = 0; i < String(seedStr).length; i++) {
        h ^= String(seedStr).charCodeAt(i);
        h = Math.imul(h, 16777619);
    }
    return () => {
        h = Math.imul(h ^ (h >>> 15), 2246822507);
        h = Math.imul(h ^ (h >>> 13), 3266489909);
        return ((h ^= h >>> 16) >>> 0) / 4294967296;
    };
}

// ═══════════════════════════════════════════
// ПОСЛЕРОДОВОЕ ВОССТАНОВЛЕНИЕ
// Портировано с fertility.js вдохновителя, числа один в один.
// ═══════════════════════════════════════════

export function postpartumState(daysSinceBirth, lactating = true) {
    const d = Math.max(0, parseInt(daysSinceBirth) || 0);
    const healing = d < 42
        ? (d < 10 ? 'швы свежие, больно' : d < 25 ? 'заживает' : 'почти зажило')
        : null;
    // Лактационная аменорея: пока кормит, цикл не возвращается (грубо до ~6 мес)
    const cycleReturned = lactating ? d >= 180 : d >= 45;
    return {
        days: d,
        healing,
        lactating: lactating && d < 730,
        cycleReturned,
        lochia: d < 35,
        // Пока цикл не вернулся — зачатие крайне маловероятно
        fertilityMul: cycleReturned ? 1 : (lactating ? 0.05 : 0.3),
        label: d < 42 ? 'Ранний послеродовой период'
             : cycleReturned ? 'Восстановление завершено'
             : 'Кормление, цикл не вернулся',
    };
}

// ═══════════════════════════════════════════
// ГЕНЕТИКА ВНЕШНОСТИ
// Менделевская модель вдохновителя: тёмное доминирует над светлым,
// доминантный признак берёт верх в 70% случаев.
// ═══════════════════════════════════════════

const EYE_RANK = { 'карие': 3, 'зелёные': 2, 'серые': 1, 'голубые': 1 };
const HAIR_RANK = { 'чёрные': 4, 'тёмные': 3, 'русые': 2, 'рыжие': 2, 'светлые': 1 };

export const EYE_OPTIONS = Object.keys(EYE_RANK);
export const HAIR_OPTIONS = Object.keys(HAIR_RANK);

function normalizeTrait(v, ranks) {
    if (!v || typeof v !== 'string') return null;
    const low = v.toLowerCase();
    for (const key of Object.keys(ranks)) {
        if (low.includes(key.slice(0, 4))) return key;
    }
    return null;
}

function pickInherited(a, b, ranks, rnd) {
    const na = normalizeTrait(a, ranks);
    const nb = normalizeTrait(b, ranks);
    if (!na && !nb) return null;
    if (!na) return nb;
    if (!nb) return na;
    if (na === nb) return na;
    const dominant = (ranks[na] || 0) >= (ranks[nb] || 0) ? na : nb;
    const recessive = dominant === na ? nb : na;
    return rnd() < 0.7 ? dominant : recessive;
}

// Наследование внешности ребёнка от родителей. Возвращает { eyes, hair }.
export function inheritLooks(parentA, parentB, rnd = Math.random) {
    return {
        eyes: pickInherited(parentA?.eyes, parentB?.eyes, EYE_RANK, rnd),
        hair: pickInherited(parentA?.hair, parentB?.hair, HAIR_RANK, rnd),
    };
}

// Готовые строки для карточки ребёнка: ['карие глаза', 'чёрные волосы']
export function inheritedLooksList(parentA, parentB, rnd = Math.random) {
    const res = inheritLooks(parentA, parentB, rnd);
    const out = [];
    if (res.eyes) out.push(`${res.eyes} глаза`);
    if (res.hair) out.push(`${res.hair} волосы`);
    return out;
}
