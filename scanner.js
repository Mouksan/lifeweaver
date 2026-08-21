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
// Отличия от вдохновителя (адаптация под конструктор вселенных):
//  - Один тег зачатия/родов на любую вселенную вместо специфичных полей —
//    механика определяется активным пресетом (cycleSystem/gestationType),
//    не хардкодом "омегаверс".
//  - Новый тег LAY_CLUTCH — событие кладки/нереста, которого у вдохновителя
//    нет вообще (там только обычная беременность). Разделяет фазы вручную,
//    как договорились: формирование заканчивается явным событием, а не
//    просто истечением недель.
//  - Нет CYCLE_DAY/RP_DATE (календарная дата) — вместо этого один лёгкий
//    DAYS_PASSED, от которого we сами считаем и цикл, и недели, и возраст
//    детей. Меньше форматов дат — меньше способов всё сломать.
//  - Нет SEX_REVEAL/BABY_TRAITS — у нас нет поля "пол ребёнка" и модель не
//    придумывает характер/внешность; имя и заметки заполняются вручную в
//    разделе "Ребёнок" уже после родов.

const TAG = (name) => new RegExp(`<!--[\\s\\S]*?\\[${name}\\][\\s\\S]*?-->`, 'i');

const DAYS_PASSED_RE = /<!--[\s\S]*?\[DAYS_PASSED[:\s]+(\d+)\][\s\S]*?-->/i;

const CONCEPTION_RE = TAG('CONCEPTION_CHECK');
const CONCEPTION_CHAR_RE = TAG('CONCEPTION_CHECK:CHAR');
const LAY_CLUTCH_RE = TAG('LAY_CLUTCH');
const LAY_CLUTCH_CHAR_RE = TAG('LAY_CLUTCH:CHAR');
const BIRTH_RE = TAG('BIRTH');
const BIRTH_CHAR_RE = TAG('BIRTH:CHAR');
const LOSS_RE = TAG('PREGNANCY_LOSS');
const LOSS_CHAR_RE = TAG('PREGNANCY_LOSS:CHAR');
const KNOWN_RE = TAG('PREGNANCY_KNOWN');
const KNOWN_CHAR_RE = TAG('PREGNANCY_KNOWN:CHAR');

// Убирает наши теги из текста — используется и для sanity-проверки (чтобы не
// ловить слово "секс" внутри самого тега), и для очистки сообщения после скана.
export function stripOurTags(text) {
    if (!text) return text;
    return text.replace(/<!--[\s\S]*?\[(?:DAYS_PASSED|CONCEPTION_CHECK|LAY_CLUTCH|BIRTH|PREGNANCY_LOSS|PREGNANCY_KNOWN)(?::CHAR)?[^\]]*\][\s\S]*?-->/gi, '');
}

export function hasOurTags(text) {
    if (!text) return false;
    return /<!--[\s\S]*?\[(?:DAYS_PASSED|CONCEPTION_CHECK|LAY_CLUTCH|BIRTH|PREGNANCY_LOSS|PREGNANCY_KNOWN)/i.test(text);
}

// Похоже ли на реальное семяизвержение ВНУТРЬ — та же sanity-проверка, что у
// вдохновителя. Модель иногда вешает тег по инерции (сцена с игрушкой, чужой
// секс, тег просто мелькал в контексте) — слов "секс"/"член" недостаточно,
// они есть в любой сцене.
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
    if (!text) return 0;
    const m = text.match(DAYS_PASSED_RE);
    if (!m) return 0;
    const days = parseInt(m[1]);
    if (isNaN(days) || days < 0) return 0;
    return Math.min(days, 365); // sanity cap — не даём одному тегу перекрутить год за раз
}

// Основной скан одного сообщения. Возвращает null, если вообще ничего не найдено.
export function scanMessage(text) {
    if (!text) return null;

    const plain = stripOurTags(text); // для sanity-проверки зачатия — без самих тегов

    let conception = CONCEPTION_RE.test(text);
    if (conception && !looksLikeInternalRelease(plain)) conception = false;

    let charConception = CONCEPTION_CHAR_RE.test(text);
    if (charConception && !looksLikeInternalRelease(plain)) charConception = false;

    const result = {
        conception,
        charConception,
        layClutch: LAY_CLUTCH_RE.test(text),
        charLayClutch: LAY_CLUTCH_CHAR_RE.test(text),
        birth: BIRTH_RE.test(text),
        charBirth: BIRTH_CHAR_RE.test(text),
        loss: LOSS_RE.test(text),
        charLoss: LOSS_CHAR_RE.test(text),
        known: KNOWN_RE.test(text),
        charKnown: KNOWN_CHAR_RE.test(text),
        daysPassed: scanDaysPassed(text),
    };

    const anyEvent = result.conception || result.charConception || result.layClutch || result.charLayClutch
        || result.birth || result.charBirth || result.loss || result.charLoss || result.known || result.charKnown;
    if (!anyEvent && result.daysPassed === 0) return null;

    return result;
}
