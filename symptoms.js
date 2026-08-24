// ═══════════════════════════════════════════
// SYMPTOMS — телесные признаки и рекомендации по сроку
// ═══════════════════════════════════════════
//
// Портировано с helpers.js вдохновителя. Их идея, которую берём целиком:
// симптомы выбираются по ПРОЦЕНТУ прогресса, а не по абсолютной неделе —
// поэтому таблица одинаково работает и на 40-недельной беременности, и на
// 20-недельной фазе формирования кладки, без пересчёта чисел.
//
// Выбор из пула сеяный (seed = неделя): в пределах одной недели набор
// симптомов не меняется, иначе модель получала бы каждый ход новый список
// и героя мотало бы от токсикоза к отёкам и обратно.
//
// Адаптация: их пул описывает человеческую беременность и остаётся для
// live-вселенных как есть. Для двухфазных добавлены свои — тело, растящее
// яйца, ведёт себя иначе, а у кладки в гнезде «симптомы» вообще не телесные,
// это состояние самой кладки.

// ─── Сеяный выбор: тот же алгоритм, что у вдохновителя ───
export function seededPick(arr, count, seed) {
    const rnd = (s) => {
        const x = Math.sin(s) * 10000;
        return x - Math.floor(x);
    };
    const indexed = arr.map((item, idx) => ({ item, idx }));
    indexed.sort((a, b) => rnd(seed * 1000 + a.idx) - rnd(seed * 1000 + b.idx));
    return indexed.slice(0, count).map(x => x.item);
}

// ─── Пул человеческой беременности (числа и формулировки вдохновителя) ───
const HUMAN_STAGES = [
    { upTo: 10, count: 3, pool: [['лёгкая тошнота по утрам', 'mild morning nausea'], ['повышенная усталость', 'increased fatigue'], ['перепады настроения', 'mood swings'], ['обострение обоняния', 'heightened sense of smell'], ['покалывание в груди', 'tingling in the chest'], ['сонливость днём', 'daytime drowsiness'], ['лёгкие спазмы внизу живота', 'mild cramps low in the belly'], ['изменения аппетита', 'appetite changes']] },
    { upTo: 20, count: 4, pool: [['токсикоз (тошнота/рвота)', 'morning sickness, nausea and vomiting'], ['чувствительность груди', 'chest tenderness'], ['частое мочеиспускание', 'frequent urination'], ['металлический привкус во рту', 'metallic taste in the mouth'], ['отвращение к запахам', 'aversion to smells'], ['головокружение', 'dizziness'], ['запоры', 'constipation'], ['эмоциональная нестабильность', 'emotional volatility']] },
    { upTo: 30, count: 4, pool: [['живот начинает округляться', 'the belly starting to round out'], ['токсикоз ослабевает', 'morning sickness easing'], ['эмоциональные перепады', 'emotional swings'], ['пигментация кожи', 'skin pigmentation'], ['венозная сетка на груди', 'visible veins across the chest'], ['повышенный аппетит', 'increased appetite'], ['одышка при подъёме', 'short of breath climbing stairs']] },
    { upTo: 40, count: 4, pool: [['первые шевеления плода', 'first fetal movements'], ['либидо возрастает', 'rising libido'], ['энергия возвращается', 'energy returning'], ['грудь увеличивается', 'chest swelling'], ['волосы гуще', 'thicker hair'], ['судороги в икрах', 'calf cramps'], ['заложенность носа', 'stuffy nose']] },
    { upTo: 50, count: 5, pool: [['живот заметно увеличен', 'noticeably larger belly'], ['учащённое сердцебиение', 'faster heartbeat'], ['растяжки', 'stretch marks'], ['молозиво из сосков', 'colostrum leaking'], ['судороги в ногах', 'leg cramps'], ['изжога', 'heartburn'], ['потемнение ареол', 'darkened areolas']] },
    { upTo: 70, count: 5, pool: [['тяжесть в животе', 'heaviness in the belly'], ['отёки ног к вечеру', 'legs swelling by evening'], ['боли в пояснице', 'lower back pain'], ['одышка при ходьбе', 'short of breath walking'], ['изжога', 'heartburn'], ['бессонница', 'insomnia'], ['активные толчки плода', 'strong kicks'], ['варикоз', 'varicose veins']] },
    { upTo: 90, count: 6, pool: [['сильная усталость', 'heavy fatigue'], ['частые походы в туалет', 'constant trips to the toilet'], ['тренировочные схватки', 'Braxton-Hicks contractions'], ['тяжело дышать', 'hard to breathe'], ['отёки', 'swelling'], ['бессонница', 'insomnia'], ['боли в тазу', 'pelvic pain'], ['утиная походка', 'waddling gait']] },
    { upTo: 100, count: 5, pool: [['живот опустился', 'the belly has dropped'], ['отхождение пробки', 'the mucus plug passing'], ['схватки учащаются', 'contractions coming closer together'], ['подтекание вод', 'leaking fluid'], ['диарея', 'diarrhoea'], ['тянущие боли', 'dragging pains'], ['синдром гнездования', 'nesting urge']] },
];

// ─── Пул тела, вынашивающего кладку (до нереста) ───
const STAGED_BODY_STAGES = [
    { upTo: 15, count: 3, pool: [['тянущая тяжесть внизу живота', 'dragging heaviness low in the belly'], ['постоянный голод', 'constant hunger'], ['сонливость', 'drowsiness'], ['обострённое обоняние', 'heightened sense of smell'], ['зябкость', 'feeling cold'], ['тяга к минеральной пище', 'craving mineral-rich food']] },
    { upTo: 35, count: 4, pool: [['живот заметно тяжелеет', 'the belly growing noticeably heavier'], ['тяга грызть камень или ракушки', 'urge to chew stone or shells'], ['ломота в костях', 'aching bones'], ['повышенная температура тела', 'raised body temperature'], ['раздражительность', 'irritability'], ['жажда', 'thirst']] },
    { upTo: 60, count: 4, pool: [['{eggs} прощупываются под кожей', 'the {eggs} can be felt under the skin'], ['тело неповоротливо', 'the body is unwieldy'], ['боли в пояснице и бёдрах', 'pain in the lower back and hips'], ['кожа натянута и зудит', 'skin stretched tight and itching'], ['усиленный аппетит', 'sharp appetite'], ['потребность в тепле', 'craving warmth']] },
    { upTo: 85, count: 5, pool: [['инстинкт обустраивать гнездо', 'instinct to build the nest'], ['{clutch} ощутимо смещается', 'the {clutch} shifts noticeably'], ['тяжело двигаться', 'hard to move'], ['бессонница', 'insomnia'], ['тревожность за потомство', 'anxiety over the brood'], ['болезненные спазмы', 'painful cramps']] },
    { upTo: 100, count: 5, pool: [['схватки перед кладкой', 'contractions before laying'], ['тело готовится вытолкнуть {eggs}', 'the body is preparing to push the {eggs} out'], ['острая боль в тазу', 'sharp pelvic pain'], ['полный отказ покидать гнездо', 'refuses to leave the nest at all'], ['агрессия к чужим', 'aggression towards outsiders'], ['частые сокращения', 'frequent contractions']] },
];

// ─── Состояние кладки в гнезде (не телесное — про сами яйца) ───
const CLUTCH_STAGES = [
    { upTo: 25, count: 3, pool: [['{shell} ещё мягкая и уязвимая', 'the {shell} is still soft and vulnerable'], ['{clutch} требует ровного тепла', 'the {clutch} needs steady warmth'], ['{eggs} нужно переворачивать', 'the {eggs} need turning'], ['внутри пока не разглядеть движения', 'no movement visible inside yet']] },
    { upTo: 60, count: 4, pool: [['{shell} затвердела', 'the {shell} has hardened'], ['внутри различимы тени зародышей', 'shadows of the young visible inside'], ['на свет видно кровеносную сетку', 'blood vessels visible against the light'], ['{clutch} тёплая на ощупь', 'the {clutch} is warm to the touch'], ['{eggs} заметно потяжелели', 'the {eggs} have grown noticeably heavier']] },
    { upTo: 85, count: 4, pool: [['зародыши шевелятся внутри', 'the young stirring inside'], ['слышны слабые звуки изнутри', 'faint sounds from inside'], ['{shell} темнеет', 'the {shell} is darkening'], ['{clutch} беспокойно шевелится', 'the {clutch} shifts restlessly']] },
    { upTo: 100, count: 4, pool: [['на {shellPrep} первые трещины', 'first cracks in the {shellPrep}'], ['изнутри стучат', 'tapping from inside'], ['{clutch} вот-вот раскроется', 'the {clutch} is about to open'], ['зародыши отвечают на голос', 'the young respond to a voice']] },
];

const POOLS = { human: HUMAN_STAGES, stagedBody: STAGED_BODY_STAGES, clutch: CLUTCH_STAGES };

// Симптомы для процента прогресса. Возвращает массив строк.
// seed — неделя: набор стабилен в пределах недели.
// Подстановка терминов вселенной: у драконов скорлупа и яйца, у мерфолка
// оболочка и икринки. Формы хранятся в пресете, тексты пула — с плейсхолдерами.
function applyTerms(str, terms) {
    return String(str).replace(/\{(\w+)\}/g, (m, key) => terms[key] ?? m);
}

// Строки пулов хранятся парами ['по-русски', 'in english'].
// Интерфейс берёт русский, промпт — английский: модели уходит ТОЛЬКО
// английский текст, иначе инструкции получаются на смеси языков.
function pick(entry, en) {
    if (Array.isArray(entry)) return (en ? entry[1] : entry[0]) || entry[0];
    return entry;
}

export function getSymptoms(poolKey, progressPercent, seed = 0, terms = {}, en = false) {
    const stages = POOLS[poolKey] || HUMAN_STAGES;
    const pct = Math.max(0, Math.min(120, Number(progressPercent) || 0));
    if (pct > 100) return [en ? 'overdue — risk of complications' : 'перенашивание — риск осложнений'];
    const stage = stages.find(s => pct <= s.upTo) || stages[stages.length - 1];
    return seededPick(stage.pool, stage.count, seed).map(s => applyTerms(pick(s, en), terms));
}

// ─── Рекомендации по сроку (формулировки вдохновителя) ───
const HUMAN_RECOMMENDATIONS = [
    { upTo: 10, text: ['Начальная стадия, отдых, правильное питание', 'Early stage, rest, proper nutrition'] },
    { upTo: 20, text: ['Первый триместр, наблюдение, дробное питание', 'First trimester, monitoring, small frequent meals'] },
    { upTo: 30, text: ['Контроль веса, витамины, избегать перегрева', 'Weight control, vitamins, avoid overheating'] },
    { upTo: 40, text: ['Середина срока, можно определить пол, массаж от растяжек', 'Mid-term, sex can be determined, anti-stretch massage'] },
    { upTo: 50, text: ['Бандаж для живота, железо, крем от растяжек', 'Belly support band, iron, stretch-mark cream'] },
    { upTo: 70, text: ['Сон на левом боку, отдых, регулярное наблюдение', 'Sleep on the left side, rest, regular checkups'] },
    { upTo: 90, text: ['Подготовка к родам, упражнения, частое наблюдение', 'Preparing for birth, exercises, frequent checkups'] },
    { upTo: 100, text: ['РОДЫ СКОРО — быть готовой', 'BIRTH IMMINENT, be ready'] },
];

const STAGED_BODY_RECOMMENDATIONS = [
    { upTo: 20, text: ['Покой и обильная пища, тело только перестраивается', 'Rest and heavy feeding, the body is only just adapting'] },
    { upTo: 45, text: ['Минералы для скорлупы, тепло, избегать нагрузок', 'Minerals for the shell, warmth, avoid strain'] },
    { upTo: 70, text: ['Готовить гнездо заранее, беречь живот от ударов', 'Prepare the nest early, protect the belly'] },
    { upTo: 90, text: ['Гнездо должно быть готово, не отходить далеко', 'The nest must be ready, do not stray far'] },
    { upTo: 100, text: ['КЛАДКА СКОРО — быть в гнезде', 'LAYING IMMINENT, stay in the nest'] },
];

const CLUTCH_RECOMMENDATIONS = [
    { upTo: 25, text: ['Держать ровное тепло, не тревожить лишний раз', 'Keep steady warmth, do not disturb needlessly'] },
    { upTo: 60, text: ['Переворачивать {eggs}, следить за влажностью', 'Turn the {eggs}, watch the humidity'] },
    { upTo: 85, text: ['Охрана гнезда, разговаривать с кладкой', 'Guard the nest, talk to the clutch'] },
    { upTo: 100, text: ['ВЫЛУПЛЕНИЕ СКОРО — не оставлять кладку', 'HATCHING IMMINENT, do not leave the clutch'] },
];

const REC_POOLS = { human: HUMAN_RECOMMENDATIONS, stagedBody: STAGED_BODY_RECOMMENDATIONS, clutch: CLUTCH_RECOMMENDATIONS };

export function getRecommendation(poolKey, progressPercent, terms = {}, en = false) {
    const list = REC_POOLS[poolKey] || HUMAN_RECOMMENDATIONS;
    const pct = Math.max(0, Math.min(120, Number(progressPercent) || 0));
    if (pct > 100) return en ? 'URGENT — the brood is overdue' : 'СРОЧНО — потомство перенашивается';
    const hit = list.find(r => pct <= r.upTo);
    return applyTerms(pick(hit ? hit.text : list[list.length - 1].text, en), terms);
}

// ═══════════════════════════════════════════
// СОСТОЯНИЕ ПО ФАЗЕ ЦИКЛА (течка / гон / покой)
// ═══════════════════════════════════════════
//
// У вдохновителя энергия, либидо и настроение были прописаны только для
// менструальных фаз (cycle-realism.js) — файла, который мы выбросили вместе
// с месячными. Для течки и гона у них нет ничего. Собрано с нуля по той же
// схеме: короткое состояние + пул телесных признаков, сеяный по дню цикла.

export const CYCLE_STATES = {
    // ── ТЕЧКА ──
    // Пик: жар, слик, потребность в узле, гнездование, полное падение
    // самоконтроля. Аналог овуляции, доведённый до предела.
    heat: {
        label: 'Течка', tone: 'heat',
        mood: ['на пределе — всё раздражает и всего мало', 'at breaking point, everything grates and nothing is enough'],
        libido: ['всепоглощающее, не уходит после разрядки', 'all-consuming, does not fade after release'],
        energy: ['лихорадочная, рывками', 'feverish, coming in bursts'],
        pool: [
            ['жар волнами по всему телу, кожа горит', 'heat rolling through the body, skin burning'],
            ['запах густой, сладкий, тяжёлый — слышен через комнату', 'scent thick, sweet and heavy, noticeable across the room'],
            ['смазка не останавливается', 'slick will not stop'],
            ['внутри тянет и пульсирует непрерывно', 'a constant inner ache and pulse'],
            ['мелкая дрожь, трудно держаться прямо', 'fine tremors, hard to stay upright'],
            ['инстинкт найти альфу перебивает любую мысль', 'the instinct to find an alpha overrides every thought'],
            ['потребность в узле', 'need to be knotted'],
            ['обострённая чувствительность кожи', 'skin painfully sensitive'],
            ['запах своего альфы успокаивает ненадолго', 'the scent of their own alpha soothes only briefly'],
            ['стыд накатывает волнами вперемешку с желанием', 'shame washing in together with the want'],
            ['сон урывками, тело не даёт отдохнуть', 'sleep in snatches, the body will not rest'],
            ['температура выше нормы', 'running a temperature'],
            ['тянет забиться в гнездо и никого туда не пускать', 'urge to hole up in the nest and let no one near'],
            ['голос садится, срывается на скулёж', 'voice gone hoarse, breaking into whines'],
            ['мысли путаются', 'thoughts scattered'],
        ],
    },
    // ── ПРЕДТЕЧКА ──
    // Тело готовится: гнездование, смена запаха, раздражительность.
    preheat: {
        label: 'Предтечка', tone: 'preheat',
        mood: ['беспокойное, тревожно-приподнятое', 'restless, anxiously keyed up'],
        libido: ['растёт, ещё под контролем', 'rising, still controllable'],
        energy: ['нервная, не сидится на месте', 'jittery, cannot sit still'],
        pool: [
            ['тело теплее обычного, знобит без причины', 'warmer than usual, shivering for no reason'],
            ['запах меняется — становится слаще и заметнее', 'scent shifting, sweeter and more noticeable'],
            ['инстинкт гнездования: тащит в гнездо всё мягкое', 'nesting instinct: dragging anything soft into the nest'],
            ['раздражают чужие прикосновения', 'other people\'s touch grates'],
            ['обострённая чувствительность к запаху альф', 'acutely aware of alpha scent'],
            ['тянет внизу живота, слабо, но настойчиво', 'a low insistent pull in the belly'],
            ['сон рваный, просыпается среди ночи', 'broken sleep, waking at night'],
            ['аппетит скачет — то не лезет, то не наесться', 'appetite swinging between nothing and never enough'],
            ['вещи с чужим запахом хочется утащить к себе', 'wants to steal things carrying someone else\'s scent'],
            ['вспыльчивость на ровном месте, потом стыдно', 'flares up over nothing, then feels ashamed'],
            ['соски чувствительнее, задевает любое касание', 'nipples oversensitive to any contact'],
            ['первые капли смазки — редко, но уже', 'first traces of slick, rare but there'],
        ],
    },
    // ── ПОСТ-ТЕЧКА ──
    // Взято из твоего omega.js: отдельная фаза с нулевой фертильностью.
    // Тело истощено, эмоционально откатывает.
    postheat: {
        label: 'После течки', tone: 'postheat',
        mood: ['опустошённое, хрупкое, тянет к своему альфе', 'hollowed out, fragile, clinging to their alpha'],
        libido: ['на нуле, тело просит покоя', 'gone, the body wants rest'],
        energy: ['почти нет, всё даётся через силу', 'almost none, everything takes effort'],
        pool: [
            ['всё тело ломит, мышцы будто после драки', 'the whole body aches as if after a fight'],
            ['внутри саднит, любое движение отдаётся', 'raw inside, every movement registers'],
            ['синяки и следы зубов проступают ярче', 'bruises and bite marks showing darker'],
            ['спит по половине суток и всё равно не высыпается', 'sleeps half the day and still wakes tired'],
            ['запах бледнеет, возвращается к обычному', 'scent fading back to normal'],
            ['слёзы близко без всякой причины', 'tears close to the surface for no reason'],
            ['не хочет отпускать от себя альфу ни на шаг', 'will not let their alpha out of reach'],
            ['аппетит зверский — тело восполняет потраченное', 'ravenous, the body replacing what it spent'],
            ['стыдно за то, что творил в течку', 'ashamed of what they did in heat'],
            ['зачатие сейчас практически исключено', 'conception is effectively impossible right now'],
            ['нужны тепло, вода и тишина', 'needs warmth, water and quiet'],
            ['гнездо разбирать пока не даёт', 'will not let the nest be taken apart yet'],
        ],
    },
    // ── ГОН ──
    // Альфа: агрессия, территориальность, потребность метить и удерживать.
    rut: {
        label: 'Гон', tone: 'rut',
        mood: ['взвинченное, собственническое, на грани срыва', 'wound up, possessive, close to snapping'],
        libido: ['неотступное, почти болезненное', 'relentless, almost painful'],
        energy: ['избыточная, требует выхода', 'excess energy demanding an outlet'],
        pool: [
            ['запах тяжелеет, забивает всё вокруг', 'scent turning heavy, drowning out everything else'],
            ['чужие рядом с парой вызывают ярость', 'anyone near his mate provokes fury'],
            ['мышцы напряжены, тянет двигаться', 'muscles tight, restless with it'],
            ['потребность метить свою пару запахом и зубами', 'need to mark his mate with scent and teeth'],
            ['узел набухает от запаха омеги', 'knot swelling at an omega\'s scent'],
            ['терпение на нуле, срывается с полуслова', 'no patience left, snaps mid-sentence'],
            ['сон короткий, чуткий, вполглаза', 'short shallow sleep, half-alert'],
            ['голод сильнее обычного, тянет на мясо', 'hungrier than usual, craving meat'],
            ['территория ощущается физически — границы, чужаки, угрозы', 'territory felt physically: borders, outsiders, threats'],
            ['тянет утащить пару туда, где никто не найдёт', 'urge to haul his mate somewhere no one will find them'],
            ['клыки ноют, хочется сомкнуть их на метке', 'fangs aching to close on the mating mark'],
            ['ревность вспыхивает от пустяка', 'jealousy flaring over nothing'],
            ['голос ниже, срывается на рык', 'voice dropped, breaking into a growl'],
        ],
    },
    // ── ПОСТ-ГОН ──
    postrut: {
        label: 'После гона', tone: 'postheat',
        mood: ['вымотанное, виноватое — вспоминает, каким был', 'drained and guilty, remembering what he was like'],
        libido: ['спало, осталась нежность', 'subsided, tenderness left behind'],
        energy: ['на исходе', 'running out'],
        pool: [
            ['тело ломит, мышцы гудят', 'body aching, muscles humming'],
            ['запах опадает до обычного', 'scent settling back to normal'],
            ['вина за то, каким был в гоне', 'guilt over what he was like in rut'],
            ['бережность вместо напора — проверяет, не поранил ли', 'careful instead of forceful, checking he did no damage'],
            ['спит долго и тяжело', 'sleeps long and heavily'],
            ['аппетит зверский', 'ravenous'],
            ['тянет держать пару рядом, но уже без исступления', 'still wants his mate close, but without the frenzy'],
        ],
    },
    // ── ПОКОЙ ──
    // ── ПОД СУПРЕССАНТАМИ ──
    // Цикл идёт, но фаза не наступает. Тело приглушено, и это ощущается
    // не как здоровье, а как искусственная ровность.
    suppressed: {
        label: 'Под супрессантами', tone: 'calm',
        mood: ['ровное, но плоское — будто под ватой', 'even but flat, as if muffled'],
        libido: ['приглушено', 'dulled'],
        energy: ['ровная, без всплесков', 'steady, without peaks'],
        pool: [
            ['запах почти не читается — чужие не понимают, кто перед ними', 'scent barely reads, others cannot place what they are dealing with'],
            ['тело приглушено, инстинкты как за стеклом', 'the body is muted, instincts as if behind glass'],
            ['течка не наступает, хотя срок подошёл', 'the heat is not coming even though it is due'],
            ['лёгкая тошнота и головная боль — побочка', 'mild nausea and headache, side effects'],
            ['иногда пробивает жаром на секунду и отпускает', 'sometimes a flash of heat breaks through and passes'],
            ['зачатие крайне маловероятно, пока принимает', 'conception is very unlikely while taking them'],
            ['без дозы всё вернётся резче обычного', 'skipping a dose brings it all back harder than usual'],
        ],
    },
    // Цикл остановлен беременностью или послеродовым восстановлением
    paused: {
        label: 'Цикл остановлен', tone: 'calm',
        mood: ['ровное', 'even'],
        libido: ['вне цикла', 'outside the cycle'],
        energy: ['зависит от состояния', 'depends on condition'],
        pool: [
            ['течки не будет, пока тело занято другим', 'no heat while the body is busy with something else'],
            ['запах изменился — читается как «занят»', 'scent has shifted, reads as taken'],
            ['чужие альфы реагируют осторожнее', 'other alphas react more warily'],
        ],
    },
    normal: {
        label: 'Спокойно', tone: 'calm',
        mood: ['ровное', 'even'],
        libido: ['обычное', 'normal'],
        energy: ['обычная', 'normal'],
        pool: [
            ['тело в покое, ничего не беспокоит', 'body at rest, nothing troubling it'],
            ['запах ровный, фоновый', 'scent even, in the background'],
            ['сон нормальный', 'sleeping normally'],
            ['самоконтроль на месте', 'self-control intact'],
            ['чужие феромоны воспринимаются спокойно', 'other people\'s pheromones register calmly'],
            ['до следующей волны далеко, живётся легко', 'the next wave is far off, life is easy'],
        ],
    },
    beta: {
        label: 'Бета', tone: 'calm',
        mood: ['ровное', 'even'],
        libido: ['обычное', 'normal'],
        energy: ['обычная', 'normal'],
        pool: [
            ['цикла нет, состояние стабильное', 'no cycle, state is stable'],
            ['чужие течки и гоны почти не задевают', 'other people\'s heats and ruts barely register'],
            ['запах нейтральный, слабый', 'scent neutral and faint'],
            ['на феромоны реагирует слабее прочих', 'reacts to pheromones less than others'],
        ],
    },
};

// phaseKey: 'heat' | 'preheat' | 'rut' | 'normal' | 'beta'
// Для течки и гона набор сужается к пику: чем ближе день к началу, тем
// острее — берём больше признаков из пула.
export function getCycleState(phaseKey, dayInPhase = 1, seed = 0, en = false) {
    const st = CYCLE_STATES[phaseKey] || CYCLE_STATES.normal;
    const count = (phaseKey === 'heat' || phaseKey === 'rut')
        ? (dayInPhase <= 2 ? 5 : 4)
        : (phaseKey === 'postheat' || phaseKey === 'postrut' || phaseKey === 'preheat')
            ? (dayInPhase <= 2 ? 4 : 3)
            : 3;
    return {
        label: st.label,
        tone: st.tone,
        mood: pick(st.mood, en),
        libido: pick(st.libido, en),
        energy: pick(st.energy, en),
        body: seededPick(st.pool, count, seed).map(s => pick(s, en)),
    };
}
