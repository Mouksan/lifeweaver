// ═══════════════════════════════════════════
// SCANNER — парсинг тегов модели (DAYS_PASSED, CONCEPTION_CHECK, LAY_CLUTCH,
// BIRTH, PREGNANCY_LOSS, PREGNANCY_KNOWN)
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

const KNOWN_TAGS = ['DAYS_PASSED', 'CONCEPTION_CHECK', 'LAY_CLUTCH', 'BIRTH', 'PREGNANCY_LOSS', 'PREGNANCY_KNOWN'];
const TAG_NAME_RE = new RegExp(`\\[(${KNOWN_TAGS.join('|')})(:CHAR)?(?:[:\\s]+(\\d+))?\\]`, 'i');
// Безопасный поиск ОДНОГО HTML-комментария: нежадно до первого "-->",
// поэтому не может перепрыгнуть через "-->" чужого комментария.
const COMMENT_RE = /<!--[\s\S]*?-->/g;

// Разбирает текст на отдельные HTML-комментарии и для тех, что содержат
// один из наших тегов, возвращает {name, isChar, value, raw}.
function extractTagComments(text) {
    if (!text) return [];
    const comments = text.match(COMMENT_RE) || [];
    const found = [];
    for (const raw of comments) {
        const m = raw.match(TAG_NAME_RE);
        if (!m) continue;
        found.push({
            name: m[1].toUpperCase(),
            isChar: !!m[2],
            value: m[3] !== undefined ? parseInt(m[3]) : null,
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
export function scanDaysPassed(text) {
    const tag = extractTagComments(text).find(t => t.name === 'DAYS_PASSED');
    if (!tag || tag.value === null || isNaN(tag.value) || tag.value < 0) return 0;
    return Math.min(tag.value, 365); // sanity cap — не даём одному тегу перекрутить год за раз
}

// Основной скан одного сообщения. Возвращает null, если вообще ничего не найдено.
export function scanMessage(text) {
    if (!text) return null;
    const tags = extractTagComments(text);
    if (tags.length === 0) return null;

    const has = (name, isChar) => tags.some(t => t.name === name && t.isChar === isChar);
    const plain = stripOurTags(text); // для sanity-проверки зачатия — без самих тегов

    let conception = has('CONCEPTION_CHECK', false);
    if (conception && !looksLikeInternalRelease(plain)) conception = false;
    let charConception = has('CONCEPTION_CHECK', true);
    if (charConception && !looksLikeInternalRelease(plain)) charConception = false;

    const result = {
        conception,
        charConception,
        layClutch: has('LAY_CLUTCH', false),
        charLayClutch: has('LAY_CLUTCH', true),
        birth: has('BIRTH', false),
        charBirth: has('BIRTH', true),
        loss: has('PREGNANCY_LOSS', false),
        charLoss: has('PREGNANCY_LOSS', true),
        known: has('PREGNANCY_KNOWN', false),
        charKnown: has('PREGNANCY_KNOWN', true),
        daysPassed: scanDaysPassed(text),
    };

    const anyEvent = result.conception || result.charConception || result.layClutch || result.charLayClutch
        || result.birth || result.charBirth || result.loss || result.charLoss || result.known || result.charKnown;
    if (!anyEvent && result.daysPassed === 0) return null;

    return result;
}
