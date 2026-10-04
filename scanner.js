// ═══════════════════════════════════════════
// SCANNER — парсинг тегов модели (DAYS_PASSED, CONCEPTION_CHECK, LAY_CLUTCH,
// BIRTH, MISCARRIAGE, ABORTION, PREGNANCY_KNOWN)
// ═══════════════════════════════════════════
//
// Как у вдохновителя: теги распознаются ТОЛЬКО внутри HTML-комментариев
// <!-- ... -->. Если модель просто упомянет название тега в prose — это
// не должно сработать. Никакого keyword-фоллбэка: нет тега — нет события,
// это безопаснее для РП, чем гадать по ключевым словам.
//
// ИСПРАВЛЕНО (баг с обрезанием сообщений): раньше каждый тег искался своим
// regex вида /<!--[\s\S]*?\[TAG\][\s\S]*?-->/. Это ловило деструктивный
// краевой случай — если где-то РАНЬШЕ в тексте встречался ЛЮБОЙ другой
// "<!--" (от другого расширения, случайная последовательность), regex
// цеплялся за НЕГО и тянулся через весь текст до нашего тега; при вырезании
// тегов всё содержимое между ними стиралось вместе с ним. Теперь сначала
// безопасно находим КАЖДЫЙ отдельный HTML-комментарий (нежадно до ПЕРВОГО
// "-->", перепрыгнуть через него невозможно), и только потом смотрим, что
// внутри конкретно него — снаружи комментария regex больше не гуляет.
//
// Отличия от вдохновителя (адаптация под конструктор вселенных):
//  - Один тег зачатия/родов на любую вселенную вместо специфичных полей —
//    механика определяется активным пресетом (cycleSystem/gestationType),
//    не хардкодом "омегаверс".
//  - Новый тег LAY_CLUTCH — событие кладки/нереста, которого у вдохновителя
//    нет вообще (там только обычная беременность). Разделяет фазы вручную:
//    формирование заканчивается явным событием, а не истечением недель.
//  - Нет CYCLE_DAY/RP_DATE (календарная дата) — вместо этого один лёгкий
//    DAYS_PASSED, от которого мы сами считаем и цикл, и недели, и возраст
//    детей.
//  - Нет SEX_REVEAL/BABY_TRAITS пока — вернутся отдельным заходом вместе
//    с полями пола/черт в данных ребёнка.

const KNOWN_TAGS = ['DAYS_PASSED', 'CONCEPTION_CHECK', 'LAY_CLUTCH', 'BIRTH', 'MISCARRIAGE', 'ABORTION', 'PREGNANCY_KNOWN', 'SEX_REVEAL', 'BABY_TRAITS', 'CHILD_TRAITS', 'TIME_OF_DAY', 'PREGNANCY_TEST', 'DOCTOR_VISIT', 'RP_STATUS'];
// После имени тега может идти произвольная нагрузка: число (DAYS_PASSED:14),
// список полов (SEX_REVEAL:M,F) или целый JSON (BABY_TRAITS:{...}).
// Раньше тут допускались только цифры — теги с буквами и JSON не
// распознавались вообще и оставались торчать в тексте сообщения.
const TAG_NAME_RE = new RegExp(`\\[(${KNOWN_TAGS.join('|')})\\b(:CHAR)?([^\\]]*)\\]`, 'i');
// Безопасный поиск ОДНОГО HTML-комментария: нежадно до первого "-->",
// поэтому не может перепрыгнуть через "-->" чужого комментария.
const COMMENT_RE = /<!--[\s\S]*?-->/g;

// Разбирает текст на отдельные HTML-комментарии и для тех, что содержат
// один из наших тегов, возвращает {name, isChar, value, raw}.
// ─── Кому адресован тег ───
// Модель адресует по-разному: `:CHAR`, настоящим именем ({{char}} в промпте
// разворачивается в имя, и она копирует именно его), иногда своим кастомным.
// Понимаем все варианты, иначе тег уезжает не тому: именно так зачатие
// омеги-{{char}} пыталось применяться к альфе-{{user}} и отклонялось.
//
// resolveWho принимается извне (из state.js), чтобы сканер остался чистым
// и тестируемым без SillyTavern.
let _whoResolver = null;

export function setWhoResolver(fn) {
    _whoResolver = typeof fn === 'function' ? fn : null;
}

function resolveTarget(payload) {
    const raw = String(payload || '').replace(/^[:\s]+/, '').trim();
    if (!raw) return 'user';               // без адреса — юзер, как раньше
    // Чисто числовая нагрузка — это не адрес, а значение (DAYS_PASSED:14)
    if (/^\d+$/.test(raw)) return 'user';
    const upper = raw.toUpperCase();
    if (upper === 'CHAR') return 'char';
    if (upper === 'USER') return 'user';
    if (_whoResolver) {
        const found = _whoResolver(raw);
        if (found) return found;
    }
    return null;                            // имя не опознано
}

function extractTagComments(text) {
    if (!text) return [];
    const comments = text.match(COMMENT_RE) || [];
    const found = [];
    for (const raw of comments) {
        const m = raw.match(TAG_NAME_RE);
        if (!m) continue;
        const payload = m[3] || '';
        const num = payload.match(/(\d+)/);
        // Теги без адресата: относятся к сцене целиком, не к персонажу
        const NON_ADDRESSED = ['DAYS_PASSED', 'TIME_OF_DAY', 'CHILD_TRAITS', 'RP_STATUS'];
        const tagName = m[1].toUpperCase();
        const target = NON_ADDRESSED.includes(tagName) ? 'user'
            : m[2] ? 'char'
            : resolveTarget(payload);
        found.push({
            name: tagName,
            isChar: target === 'char',
            target,                 // 'user' | 'char' | null (не опознан)
            value: num ? parseInt(num[1]) : null,
            payload,
            raw,
        });
    }
    return found;
}

// Убирает ТОЛЬКО те HTML-комментарии, что реально содержат наши теги —
// остальные комментарии (чужие, случайные) не трогает вообще.
export function stripOurTags(text) {
    if (!text) return text;
    return text.replace(COMMENT_RE, (whole) => (TAG_NAME_RE.test(whole) ? '' : whole));
}

export function hasOurTags(text) {
    return extractTagComments(text).length > 0;
}

// Диагностика: что именно сканер увидел в тексте. Возвращает список
// найденных тегов и все HTML-комментарии, чтобы было видно, ставила ли
// модель что-то похожее, но не то.
export function describeScan(text) {
    const comments = (text || '').match(COMMENT_RE) || [];
    const tags = extractTagComments(text);
    return {
        commentsFound: comments.length,
        allComments: comments.map(c => c.length > 160 ? c.slice(0, 160) + '…' : c),
        recognizedTags: tags.map(t => t.name + (t.isChar ? ':CHAR' : '') + (t.payload ? ` (${t.payload.slice(0, 60)})` : '')),
    };
}

// Вырезает содержимое think/reasoning-блоков ПЕРЕД сканом — портировано у
// вдохновителя почти дословно. Модели-ризонеры иногда "репетируют" тег в
// думалке, не решаясь на него в самом ответе; без этой чистки сканер видел
// бы репетицию как настоящее срабатывание.
//  • Закрытый <think>...</think> — точно мысли, вырезается целиком.
//  • Незакрытый <think> в САМОМ НАЧАЛЕ сообщения (префилл-обёртка вокруг
//    всего ответа) — маркер убираем, содержимое СКАНИРУЕТСЯ (там могут быть
//    настоящие теги, вынесенные автопрефиллом за пределы think).
//  • Незакрытый <think> в середине (оборванная генерация) — режем до конца.
export function stripThink(text) {
    if (!text) return '';
    let res = String(text);
    res = res.replace(/<(think|thinking|reasoning|analysis|reflection)[^>]*>[\s\S]*?<\/\1>/gi, '');
    const unclosed = res.match(/<(think|thinking|reasoning)[^>]*>/i);
    if (unclosed) {
        const isPrefillWrapper = res.slice(0, unclosed.index).trim() === '';
        const inner = res.slice(unclosed.index + unclosed[0].length);
        if (isPrefillWrapper && /<!--\s*\[/.test(inner)) {
            res = res.slice(0, unclosed.index) + inner;
        } else {
            res = res.slice(0, unclosed.index);
        }
    }
    return res;
}

// Sanity-фильтры прерывания беременности — портированы у вдохновителя,
// расширены словарём для двухстадийных вселенных (кладка/икра могут
// «погибнуть», а не «выкидышем выйти»).
// Смысл тот же, что у CONCEPTION_CHECK: тег валиден только если в тексте
// сцены есть соответствующий контекст, иначе это галлюцинация модели.
const MISCARRIAGE_CONTEXT_RE = /(выкидыш|miscarr|кровотеч|кров(?:ь|и|ью)|потер(?:я|ял|яла|яли)|схватк|спазм|боль|скорая|больниц|врач|плод|срыв|тянущ|замерш|погиб|мертв|мёртв|не выжил|раздавл|разбит|треснул|остыл|кладк|икр|яйц|гнезд)/i;
const ABORTION_CONTEXT_RE = /(аборт|abortion|прерыв|клиник|процедур|вакуум|таблетк|гинеколог|операц|избавит|уничтож|раздавил|разбил|выброс|утопил)/i;

// ─── BABY_TRAITS: JSON с данными новорождённых от модели ───
// Портировано у вдохновителя вместе с их «щадящим» парсером: модели любят
// оставлять висячие запятые и одинарные кавычки, из-за чего строгий JSON.parse
// падает и данные теряются. Тег живёт вне общей схемы KNOWN_TAGS, потому что
// несёт полезную нагрузку в фигурных скобках, а не просто флаг.
// Между именем тега и JSON может стоять адресат: [BABY_TRAITS:Veyne:{...}].
// Захватываем всё до скобки отдельно, чтобы определить, кому адресовано.
const BABY_TRAITS_RE = /<!--\s*\[BABY_TRAITS([^{\]]*?):?\s*(\{[\s\S]*?\})\s*\]\s*-->/gi;

function safeParseJson(raw) {
    try {
        return JSON.parse(raw);
    } catch (e) {
        try {
            const fixed = raw.replace(/,\s*([}\]])/g, '$1').replace(/'/g, '"');
            return JSON.parse(fixed);
        } catch (e2) {
            return null;
        }
    }
}

// CHILD_TRAITS — дозаполнение черт уже родившихся детей. Нужен там, где
// вдохновителю он не требовался: при кладке потомство вылупляется в несколько
// сообщений, и у тех, кто вылупился позже, характер/внешность ещё неизвестны.
const CHILD_TRAITS_RE = /<!--\s*\[CHILD_TRAITS:\s*(\{[\s\S]*?\})\s*\]\s*-->/i;

// RP_STATUS — живая динамика сцены от модели. В отличие от наших таблиц
// симптомов (предсказание по сроку), это то, что происходит с конкретным
// героем прямо сейчас, глазами модели, которая только что писала сцену.
const RP_STATUS_RE = /<!--\s*\[RP_STATUS:\s*(\{[\s\S]*?\})\s*\]\s*-->/i;

export function scanStatus(text) {
    if (!text) return null;
    const m = text.match(RP_STATUS_RE);
    if (!m) return null;
    const json = safeParseJson(m[1]);
    return (json && typeof json === 'object') ? json : null;
}

export function scanChildTraits(text) {
    if (!text) return null;
    const m = text.match(CHILD_TRAITS_RE);
    if (!m) return null;
    const json = safeParseJson(m[1]);
    if (!json) return null;
    if (Array.isArray(json.children)) return json.children;
    if (Array.isArray(json)) return json;
    return [json];
}

export function scanBabyTraits(text, forChar = false) {
    if (!text) return null;
    const want = forChar ? 'char' : 'user';
    BABY_TRAITS_RE.lastIndex = 0;
    let m;
    while ((m = BABY_TRAITS_RE.exec(text)) !== null) {
        const addr = String(m[1] || '').replace(/^[:\s]+/, '').trim();
        const upper = addr.toUpperCase();
        const target = !addr ? 'user'
            : upper === 'CHAR' ? 'char'
            : upper === 'USER' ? 'user'
            : (_whoResolver ? _whoResolver(addr) : null);
        if (target !== want) continue;
        const json = safeParseJson(m[2]);
        if (!json) continue;
        if (Array.isArray(json.babies)) return json;
        if (Array.isArray(json)) return { babies: json };
        return { babies: [json] };
    }
    return null;
}

// Полы, названные моделью в теге SEX_REVEAL — например [SEX_REVEAL:M,F]
// Полы берём из ПОСЛЕДНЕЙ секции тега: между именем тега и ними может
// стоять адресат — [SEX_REVEAL:Veyne:M,F]. Раньше регулярка ждала полы
// сразу после :CHAR и на имени посередине ломалась.
const SEX_REVEAL_RE = /\[SEX_REVEAL([^\]]*)\]/i;

export function extractRevealedSexes(text) {
    if (!text) return null;
    const m = text.match(SEX_REVEAL_RE);
    if (!m) return null;
    const sections = String(m[1] || '').split(':').filter(s => s.trim());
    const last = sections[sections.length - 1] || '';
    // В последней секции должны быть только буквы полов и разделители
    if (!/^[MFМЖДmfмжд,\s]+$/.test(last)) return null;
    const parts = last.split(/[,\s]+/).filter(Boolean);
    const sexes = parts.map(p => {
        const c = p.trim().toUpperCase();
        if (c === 'M' || c === 'М') return 'M';
        if (c === 'F' || c === 'Ж' || c === 'D' || c === 'Д') return 'F';
        return null;
    }).filter(Boolean);
    return sexes.length > 0 ? sexes : null;
}

// Время суток из тега [TIME_OF_DAY:evening]. Принимаем и русские слова —
// модель нет-нет да и переведёт, ронять из-за этого событие незачем.
const TIME_WORDS = {
    night: 'night', ночь: 'night', ночью: 'night',
    morning: 'morning', утро: 'morning', утром: 'morning',
    day: 'day', день: 'day', днем: 'day', днём: 'day', noon: 'day', afternoon: 'day',
    evening: 'evening', вечер: 'evening', вечером: 'evening',
};

// Возвращает { rpTime: 'HH:MM'|null, bucket: 'night'|'morning'|'day'|'evening'|null }.
// Точное время приоритетнее — оно у игрока и так есть в сообщениях; слово
// принимаем как запасной вариант, если модель времени не знает.
export function extractTimeOfDay(text) {
    const tag = extractTagComments(text).find(t => t.name === 'TIME_OF_DAY');
    if (!tag) return null;
    const payload = String(tag.payload || '').trim();

    const hhmm = payload.match(/(\d{1,2})\s*[:.]\s*(\d{2})/);
    if (hhmm) {
        const h = parseInt(hhmm[1]);
        const m = parseInt(hhmm[2]);
        if (h >= 0 && h <= 23 && m >= 0 && m <= 59) {
            return { rpTime: `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`, bucket: null };
        }
    }

    const word = payload.replace(/[:\s]/g, '').toLowerCase();
    const bucket = TIME_WORDS[word] || null;
    return bucket ? { rpTime: null, bucket } : null;
}

// Похоже ли на реальное семяизвержение ВНУТРЬ — как у вдохновителя. Модель
// иногда вешает тег по инерции (сцена с игрушкой, чужой секс, тег просто
// мелькал в контексте) — слов "секс"/"член" недостаточно, они есть в любой сцене.
export function looksLikeInternalRelease(text) {
    if (!text) return false;
    const releaseInside = /(?:сперм|семен|семя|creampie|cum(?:s|ming|med)?\s+(?:in|inside|into)|(?:came|come|coming)\s+(?:in|inside|into)|fill(?:s|ed|ing)?\s+(?:her|you|me)\b|конч(?:ил|ила|ает|аю|аешь|ая)\s+(?:в|внутр)|изли(?:в|л)[а-яё]*\s+(?:в|внутр)|залива(?:л|ла|ет)\s+(?:в|внутр)|заполн(?:ил|ила|яет)\s+(?:её|ее|тебя|меня|лоно|матк)|внутри\s+(?:неё|нее|тебя|меня))/i;
    const knotting = /(?:узл[аоеы]м?|узел|knot(?:s|ted|ting)?)\b/i.test(text)
        && /(?:внутр|inside|изли|сперм|семен|cum)/i.test(text);
    if (!releaseInside.test(text) && !knotting) return false;

    const toys = /(?:секс[- ]?игрушк|игрушк[иауео]?\s|дилдо|dildo|вибратор|vibrator|strap[- ]?on|страпон|фаллоимитатор|plug\b|пробк[ауи])/i;
    const semen = /(?:сперм|семен|семя|creampie|cum|конч(?:ил|ила|ает)\s+(?:в|внутр))/i;
    if (toys.test(text) && !semen.test(text)) return false;

    return true;
}

// Дни, прошедшие в истории за этот ответ. 0, если тег не найден — значит
// действие продолжается в той же сцене, время не двигаем без явного сигнала.
// Потолок на один тег. Раньше стоял 365 — и скип «прошло два года» (730)
// молча резался вдвое. Оставляем предохранитель от явного бреда, но с запасом.
export const MAX_DAYS_PER_TAG = 3650;

export function scanDaysPassed(text) {
    const tag = extractTagComments(text).find(t => t.name === 'DAYS_PASSED');
    if (!tag || tag.value === null || isNaN(tag.value) || tag.value < 0) return 0;
    if (tag.value > MAX_DAYS_PER_TAG) {
        console.warn(`[Lifeweaver] DAYS_PASSED:${tag.value} превышает потолок ${MAX_DAYS_PER_TAG}, обрезано`);
        return MAX_DAYS_PER_TAG;
    }
    return tag.value;
}

// Основной скан одного сообщения. Возвращает null, если вообще ничего не найдено.
export function scanMessage(text) {
    if (!text) return null;
    const tags = extractTagComments(text);
    if (tags.length === 0) return null;

    const has = (name, isChar) => tags.some(t => t.name === name && t.target === (isChar ? 'char' : 'user'));
    // Теги, адресат которых не распознан — чтобы сообщить об этом в диагностике
    const unresolved = tags.filter(t => t.target === null).map(t => `${t.name}${t.payload}`);
    const plain = stripOurTags(text); // для sanity-проверки зачатия — без самих тегов

    let conception = has('CONCEPTION_CHECK', false);
    if (conception && !looksLikeInternalRelease(plain)) conception = false;
    let charConception = has('CONCEPTION_CHECK', true);
    if (charConception && !looksLikeInternalRelease(plain)) charConception = false;

    // Прерывание беременности: тег + подтверждающий контекст в сцене
    const miscarriageOk = MISCARRIAGE_CONTEXT_RE.test(plain);
    const abortionOk = ABORTION_CONTEXT_RE.test(plain);

    const result = {
        conception,
        charConception,
        layClutch: has('LAY_CLUTCH', false),
        charLayClutch: has('LAY_CLUTCH', true),
        birth: has('BIRTH', false),
        charBirth: has('BIRTH', true),
        miscarriage: has('MISCARRIAGE', false) && miscarriageOk,
        charMiscarriage: has('MISCARRIAGE', true) && miscarriageOk,
        abortion: has('ABORTION', false) && abortionOk,
        charAbortion: has('ABORTION', true) && abortionOk,
        known: has('PREGNANCY_KNOWN', false),
        charKnown: has('PREGNANCY_KNOWN', true),
        sexRevealed: has('SEX_REVEAL', false),
        charSexRevealed: has('SEX_REVEAL', true),
        revealedSexes: extractRevealedSexes(text),
        babyTraits: scanBabyTraits(text, false),
        charBabyTraits: scanBabyTraits(text, true),
        childTraits: scanChildTraits(text),
        timeOfDay: extractTimeOfDay(text),
        status: scanStatus(text),
        test: has('PREGNANCY_TEST', false),
        charTest: has('PREGNANCY_TEST', true),
        doctor: has('DOCTOR_VISIT', false),
        charDoctor: has('DOCTOR_VISIT', true),
        daysPassed: scanDaysPassed(text),
        unresolved,
    };

    const anyEvent = result.conception || result.charConception || result.layClutch || result.charLayClutch
        || result.birth || result.charBirth || result.miscarriage || result.charMiscarriage
        || result.abortion || result.charAbortion || result.known || result.charKnown
        || result.sexRevealed || result.charSexRevealed || (result.childTraits && result.childTraits.length) || result.timeOfDay
        || result.test || result.charTest || result.doctor || result.charDoctor || result.status;
    if (!anyEvent && result.daysPassed === 0) return null;

    return result;
}
