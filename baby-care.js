// ═══════════════════════════════════════════
// BABY-CARE — возрастные нормы ухода и вехи развития
// ═══════════════════════════════════════════
//
// Портировано с baby-care.js вдохновителя: их таблицы вех, стадий роста и
// возрастных норм взяты как есть — там всё выверено и работает.
//
// Отличия (адаптация под нашу модель):
//  • Возраст считается от нашего счётчика ageWeeks (двигается DAYS_PASSED),
//    а не от календарной birthRpDate — у нас нет календарных дат.
//  • Джиттер сеется от id ребёнка вместо birthRpDate — тот же смысл
//    (близнецы развиваются чуть по-разному, но стабильно между перезагрузками).
//  • Стадии/нормы применимы к любому виду: у драконов и мерфолка «малыш»
//    остаётся малышом, просто в промпте описывается своими словами.

// ─── Детерминированный «рандом» из строки (FNV-1a) ───
function seedHash(str) {
    let h = 2166136261;
    for (let i = 0; i < String(str).length; i++) {
        h ^= String(str).charCodeAt(i);
        h = Math.imul(h, 16777619);
    }
    return Math.abs(h);
}

// Джиттер от -range до +range дней, стабильный для пары (ребёнок, ключ вехи)
function jitter(child, key, range) {
    if (!range) return 0;
    const h = seedHash(`${child?.id || ''}|${child?.sex || ''}|${key}`);
    return (h % (range * 2 + 1)) - range;
}

export function childAgeDays(child) {
    const weeks = Math.max(0, parseInt(child?.ageWeeks) || 0);
    return weeks * 7;
}

// ─── Вехи развития: base — типичный день, range — персональный разброс ───
export const MILESTONES = [
    { key: 'smile',   label: 'первая улыбка',                base: 40,  range: 12 },
    { key: 'head',    label: 'уверенно держит головку',      base: 75,  range: 15 },
    { key: 'roll',    label: 'переворачивается со спины',    base: 120, range: 20 },
    { key: 'laugh',   label: 'громко смеётся',               base: 130, range: 20 },
    { key: 'sit',     label: 'сидит без поддержки',          base: 185, range: 25 },
    { key: 'solids',  label: 'первый прикорм',               base: 183, range: 10 },
    { key: 'tooth',   label: 'первый зуб',                   base: 195, range: 55 },
    { key: 'crawl',   label: 'ползает',                      base: 250, range: 35 },
    { key: 'stand',   label: 'встаёт у опоры',               base: 290, range: 25 },
    { key: 'babble',  label: 'лепечет первые слоги',         base: 320, range: 40 },
    { key: 'steps',   label: 'первые шаги',                  base: 370, range: 40 },
    { key: 'words',   label: 'первые осознанные слова',      base: 380, range: 45 },
    { key: 'run',     label: 'бегает',                       base: 550, range: 60 },
    { key: 'phrases', label: 'фразы из двух слов',           base: 640, range: 70 },
    { key: 'potty',   label: 'осваивает горшок',             base: 660, range: 90 },
];

export function milestoneDay(child, m) {
    return m.base + jitter(child, m.key, m.range);
}

// Достигнутые и ближайшая вехи для ребёнка
export function getMilestoneProgress(child) {
    const age = childAgeDays(child);
    const reached = [];
    let next = null;
    for (const m of MILESTONES) {
        const d = milestoneDay(child, m);
        if (age >= d) {
            reached.push({ ...m, day: d });
        } else if (!next || d < next.day) {
            next = { ...m, day: d };
        }
    }
    return { reached, next, total: MILESTONES.length };
}

// ─── Стадии взросления (по возрасту в днях) ───
export const GROWTH_STAGES = [
    { key: 'newborn',   label: 'новорождённый', icon: 'fa-baby',          maxDays: 30 },
    { key: 'infant',    label: 'грудничок',     icon: 'fa-baby-carriage', maxDays: 365 },
    { key: 'toddler',   label: 'малыш 1–3',     icon: 'fa-shoe-prints',   maxDays: 1095 },
    { key: 'preschool', label: 'дошкольник',    icon: 'fa-shapes',        maxDays: 2555 },
    { key: 'school',    label: 'школьник',      icon: 'fa-book',          maxDays: 4380 },
    { key: 'teen',      label: 'подросток',     icon: 'fa-headphones',    maxDays: 6570 },
    { key: 'adult',     label: 'взрослый',      icon: 'fa-user',          maxDays: Infinity },
];

export function getGrowthStage(ageDays) {
    if (ageDays === null || ageDays === undefined || isNaN(ageDays)) return null;
    for (const st of GROWTH_STAGES) {
        if (ageDays < st.maxDays) return st;
    }
    return GROWTH_STAGES[GROWTH_STAGES.length - 1];
}

// Человекочитаемый возраст: дни → недели → месяцы → годы
export function formatAge(ageDays) {
    const d = Math.max(0, parseInt(ageDays) || 0);
    if (d < 14) return `${d} дн.`;
    if (d < 60) return `${Math.floor(d / 7)} нед.`;
    if (d < 730) return `${Math.floor(d / 30)} мес.`;
    const years = Math.floor(d / 365);
    return `${years} ${years === 1 ? 'год' : years < 5 ? 'года' : 'лет'}`;
}

// ─── Нормы ухода для возраста (в днях) ───
// Таблицы портированы у вдохновителя без изменений.
export function getCareNorms(ageDays, child) {
    const c = { feeding: '', sleep: '', diaper: '', teething: null, colic: false, upcoming: null };
    const a = Math.max(0, parseInt(ageDays) || 0);

    const solidsDay = milestoneDay(child, MILESTONES.find(m => m.key === 'solids'));
    if (a < 60) c.feeding = 'кормление каждые 2–3 ч, 8–12 раз в сутки (и ночью)';
    else if (a < 120) c.feeding = 'кормление каждые ~3 ч, 7–8 раз';
    else if (a < solidsDay) c.feeding = 'кормление каждые 3.5–4 ч; прикорм ещё рано';
    else if (a < 240) c.feeding = 'первый прикорм с ложки + основное кормление';
    else if (a < 365) c.feeding = 'прикорм 3 раза в день + основное кормление';
    else if (a < 540) c.feeding = 'общий стол (адаптированный), 4–5 раз в день';
    else c.feeding = 'общий стол, 4 раза в день + перекусы';

    if (a < 90) c.sleep = 'сон 16–18 ч/сутки, просыпается каждые 2–4 ч';
    else if (a < 140) c.sleep = 'сон 15–16 ч; возможен регресс сна';
    else if (a < 183) c.sleep = 'сон 14–15 ч, 3 дневных сна';
    else if (a < 365) c.sleep = 'сон 13–14 ч, 2 дневных сна';
    else if (a < 540) c.sleep = 'сон ~13 ч, 1–2 дневных сна';
    else c.sleep = 'сон 12–13 ч, 1 дневной сон';

    const pottyDay = milestoneDay(child, MILESTONES.find(m => m.key === 'potty'));
    if (a < 365) c.diaper = 'подгузники: 6–10 смен в день';
    else if (a < pottyDay) c.diaper = 'подгузники: 4–6 смен в день';
    else c.diaper = 'осваивает горшок, подгузник на сон';

    // Колики: ~3 недели — ~3.5 месяца, пик около 6 недель
    c.colic = a >= 20 && a <= 105;

    const toothDay = milestoneDay(child, MILESTONES.find(m => m.key === 'tooth'));
    if (a >= toothDay - 15 && a < toothDay) c.teething = 'дёсны набухли, слюни, всё тянет в рот — скоро первый зуб';
    else if (a >= toothDay && a < toothDay + 80) c.teething = 'режутся первые зубы: капризы, слюни, возможна температура';
    else if (a >= 390 && a < 480) c.teething = 'режутся боковые резцы';
    else if (a >= 480 && a < 630) c.teething = 'режутся моляры и клыки — самые болезненные';
    else if (a >= 630 && a < 850) c.teething = 'режутся вторые моляры';

    // Ближайшая веха — для промпта («скоро может...»)
    let next = null;
    for (const m of MILESTONES) {
        const d = milestoneDay(child, m);
        if (d > a && (!next || d < next.d)) next = { d, label: m.label };
    }
    if (next && next.d - a <= 45) c.upcoming = next.label;

    return c;
}

// ─── Время суток ───
// У вдохновителя потребности считались от точного RP-времени (HH:MM). У нас
// точного времени нет — только счётчик дней, поэтому берём их алгоритм, но
// кормим его четырьмя грубыми бакетами: модели назвать «вечер» куда проще,
// чем не ошибиться в часах, а для ухода за малышом этой точности хватает.
export const TIME_BUCKETS = {
    night:   { id: 'night',   label: 'Ночь',   hour: 2 },
    morning: { id: 'morning', label: 'Утро',   hour: 7 },
    day:     { id: 'day',     label: 'День',   hour: 13 },
    evening: { id: 'evening', label: 'Вечер',  hour: 20 },
};

export function timeBucket(id) {
    return TIME_BUCKETS[id] || TIME_BUCKETS.day;
}

// ─── Потребности прямо сейчас (адаптация getCareNeeds вдохновителя) ───
// Возвращает { feeding, diaper, sleep, careNote }.
// Час из 'HH:MM' (или null)
export function hourFromRpTime(rpTime) {
    if (!rpTime || typeof rpTime !== 'string') return null;
    const m = rpTime.match(/^(\d{1,2}):(\d{2})$/);
    if (!m) return null;
    const h = parseInt(m[1]);
    return (h >= 0 && h <= 23) ? h + parseInt(m[2]) / 60 : null;
}

// Бакет времени суток по точному часу
export function bucketFromHour(hour) {
    if (hour === null || hour === undefined) return 'day';
    if (hour >= 20 || hour < 6) return 'night';
    if (hour < 11) return 'morning';
    if (hour < 18) return 'day';
    return 'evening';
}

// timeOfDayId — либо 'HH:MM', либо id бакета. Точное время предпочтительнее:
// именно на нём построен алгоритм вдохновителя, бакет — огрубление на случай,
// когда модель времени не знает.
export function getCareNeeds(ageDays, timeOfDayId, child, rpDay = 0) {
    const needs = { feeding: null, diaper: null, sleep: null, careNote: null };
    const a = Math.max(0, parseInt(ageDays) || 0);
    const exactHour = hourFromRpTime(timeOfDayId);
    const bucket = exactHour !== null ? timeBucket(bucketFromHour(exactHour)) : timeBucket(timeOfDayId);
    const hour = exactHour !== null ? exactHour : bucket.hour;

    // Персональный сдвиг расписания + дрейф по дням, чтобы близнецы отличались
    // и картина не застывала намертво в одном и том же состоянии.
    const drift = child ? (seedHash(`${child.id}|${rpDay}`) % 3) - 1 : 0;
    const offset = child ? jitter(child, 'schedule', 1) : 0;
    const adjHour = (hour + 24 - offset + drift) % 24;

    // Интервал кормления по возрасту (часы) — числа вдохновителя
    let feedInterval;
    if (a < 60)       feedInterval = 2.5;
    else if (a < 120) feedInterval = 3;
    else if (a < 180) feedInterval = 3.5;
    else if (a < 365) feedInterval = 4;
    else              feedInterval = 5;

    const sinceFeed = adjHour % feedInterval;
    if (sinceFeed >= feedInterval - 0.8) needs.feeding = 'Хочет есть';
    else if (sinceFeed < 0.8) needs.feeding = 'Только поел';
    else needs.feeding = 'Сыт';

    // Подгузник
    if (a < 1095) {
        const diaperInterval = a < 180 ? 2.5 : 3.5;
        const sinceDiaper = adjHour % diaperInterval;
        needs.diaper = sinceDiaper >= diaperInterval - 0.8 ? 'Требует смены' : 'Чистый';
    }

    // Сон по времени суток и возрасту
    const isNapTime1 = hour >= 10 && hour < 12;
    const isNapTime2 = hour >= 14 && hour < 16;

    if (bucket.id === 'night') {
        needs.sleep = 'Спит';
        if (a < 90 && hour >= 1 && hour < 5) {
            needs.sleep = 'Проснулся';
            needs.feeding = 'Хочет есть';
            needs.careNote = 'Ночное кормление';
        }
    } else if (bucket.id === 'morning' && hour < 8) {
        needs.sleep = 'Просыпается';
    } else if (a < 365 && isNapTime1) {
        needs.sleep = 'Дневной сон';
    } else if (a < 540 && isNapTime2) {
        needs.sleep = 'Дневной сон';
    } else {
        needs.sleep = 'Бодрствует';
    }

    if (!needs.careNote) {
        if (hour >= 19 && hour < 20.5) needs.careNote = 'Пора купать и готовить ко сну';
        else if (hour >= 9 && hour < 11 && a > 30) needs.careNote = 'Хорошее время для прогулки';
        else if (hour >= 16 && hour < 18 && a > 30) needs.careNote = 'Вечерняя прогулка';
        else if (a < 90 && needs.feeding === 'Хочет есть') needs.careNote = 'Кормление по требованию';
    }

    return needs;
}

export const SEX_LABELS = {
    unknown: 'неизвестен',
    M: 'мальчик',
    F: 'девочка',
};

export function sexLabel(sex) {
    return SEX_LABELS[sex] || SEX_LABELS.unknown;
}
