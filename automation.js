// ═══════════════════════════════════════════
// AUTOMATION — подписка на события ST + применение результатов скана
// ═══════════════════════════════════════════
//
// Логика портирована с message-handler.js вдохновителя: история снапшотов
// по позициям, откат при удалении, stripThink перед сканом, исходник тегов
// в msg.extra, подчистка отрисованного DOM.
//
// ── (2.10.1) Сверка с календарём Hearthtide ──
// Если у ответа и у предыдущего ответа модели есть тег Hearthtide с датой
// (<!-- HT date=0142-05-17 ... -->), разница дат — это сколько дней прошло.
// Не совпала с DAYS_PASSED — берём календарь. Порядок главенства:
// ручная правка > календарь > число модели. Без Hearthtide ничего не
// происходит: читается только текст сообщений, к самому расширению мы не
// обращаемся.
//
// ── (2.10) Ручная правка дней ──
// Если модель ошиблась в DAYS_PASSED, число можно поправить в диагностике.
// Правка (lifeweaverDaysOverride) хранится на варианте сообщения рядом с его
// тегами и подменяет модельное число при любом пересчёте — живом, при
// листании, в ретроскане. Модельные теги не трогаются: «Как у модели»
// просто убирает правку.
//
// ── (2.9) Броски зачатия привязаны к варианту сообщения ──
// Исход броска записывается в extra варианта (lifeweaverRolls). Пересчёт
// того же варианта — перелистывание, ретроскан — исход воспроизводит, а не
// бросает кубик заново: иначе листание свайпов включало бы и выключало
// беременность.
//
// ── Главное правило (переделано в 2.7, баг со стаканием дней на свайпах) ──
// Состояние ПОСЛЕ сообщения на позиции P = состояние ДО него + теги ЭТОГО
// варианта сообщения. Ровно один раз, сколько бы событий Таверна ни прислала.
//
// Как это обеспечивается:
//  • Теги, снятые с сообщения, хранятся в msg.extra вместе с номером свайпа,
//    к которому они относятся (lifeweaverTags + lifeweaverSwipe). Таверна при
//    новом свайпе может протащить extra от прошлого варианта — чужие теги по
//    номеру свайпа отсекаются и в скан больше не попадают.
//  • На сообщении стоит отметка «применено» (lifeweaverApplied: свайп +
//    подпись тегов). Она лежит в файле чата и переживает перезагрузку, поэтому
//    повторные события (MESSAGE_RECEIVED + GENERATION_ENDED, чужие тихие
//    генерации, F5) больше ничего не применяют второй раз.
//  • Если вариант сообщения сменился (свайп, реген, continue с новыми тегами),
//    состояние сначала откатывается к «до» — и берётся оно из сохранённой
//    истории позиций, а не из памяти вкладки. Снимок в памяти остался только
//    запасным вариантом.
//  • (2.8) В данных чата лежит журнал _lastApplied: какая позиция, какой
//    свайп и какие теги сейчас отражены в состоянии. Перелистнула к другому
//    свайпу — журнал не совпал, состояние пересчитывается под показанный
//    вариант. Отметка на самом сообщении теперь нужна только для чатов,
//    обработанных до появления журнала.

import { eventSource, event_types, saveSettingsDebounced } from '../../../../script.js';
import {
    getSettings, getChatData, getCurrentChatId,
    advanceTimeByDays, applyConception, applyLayClutch, applyBirth,
    applyMiscarriage, applyAbortion, setPregnancyKnown, revealOffspringSex, getActivePreset,
    getCharacterData, isBlocked, applyChildTraits, setTimeOfDay, setRpTime, autoArchiveGrownChildren, applyStatus,
    migrateLegacyClutch, getClutches, takeTest, doctorVisit, createUndoCheckpoint, takeMilestoneEvents, isConceptionCancelled,
    resolveWhoByName,
} from './state.js';
import { scanMessage, stripOurTags, hasOurTags, stripThink, describeScan, setWhoResolver, MAX_DAYS_PER_TAG } from './scanner.js';
import { updatePromptInjection } from './prompts.js';
import { showNotification, showBirthDialog, showGraduationDialog } from './notifications.js';
import { TEST_LABELS, seededRandom } from './health.js';
import { renderInfoblock } from './infoblock.js';

export const HISTORY_CAP = 25;
// Печатается в консоль при загрузке — видно, какая версия реально работает
// (браузер любит держать старый файл в кэше).
const AUTOMATION_BUILD = '2.10.2';

// ── Состояние обработки (живёт в памяти, не в настройках) ──
let _isRegeneration = false;
// Идёт ли сейчас основная генерация (не тихая чужая). Пока идёт — листание и
// контрольные проверки не трогают состояние: показанный вариант ещё пишется.
// Метка времени, а не флаг — чтобы не залипнуть, если Таверна не пришлёт конец.
let _mainGenSince = 0;
const MAIN_GEN_STALE_MS = 15 * 60 * 1000;
function mainGenActive() {
    return _mainGenSince > 0 && Date.now() - _mainGenSince < MAIN_GEN_STALE_MS;
}
// Запасной снимок «до последнего обработанного сообщения» — на случай, если
// в сохранённой истории нужной позиции почему-то нет.
let _preRegenSnapshot = null;
let _snapshotChatId = null;
let _snapshotPos = null;
// Позиции, по которым уже предупреждали «откатиться некуда» — тост не чаще
// одного раза на позицию, сколько ни свайпай.
const _warnedPositions = new Set();

// Быстрый хэш текста
function simpleHash(str) {
    let h = 0;
    for (let i = 0; i < str.length; i++) {
        h = ((h << 5) - h + str.charCodeAt(i)) | 0;
    }
    return h;
}

function getStContext() {
    return typeof SillyTavern?.getContext === 'function' ? SillyTavern.getContext() : null;
}

// ═══════════════════════════════════════════
// ТЕКСТ ДЛЯ СКАНА: проза + теги ЭТОГО варианта
// ═══════════════════════════════════════════

const COMMENT_RE = /<!--[\s\S]*?-->/g;

// Наши теги из текста — целыми HTML-комментариями, по порядку, без дублей
function ourTagComments(text) {
    const all = String(text || '').match(COMMENT_RE) || [];
    return [...new Set(all.filter(c => hasOurTags(c)).map(c => c.trim()))];
}

function swipeIdOf(msg) {
    return typeof msg?.swipe_id === 'number' ? msg.swipe_id : null;
}

// Видимый текст без наших тегов — так же, как его чистит stampMessage
function cleanText(text) {
    return stripOurTags(text || '').replace(/\n{3,}/g, '\n\n').trimEnd();
}

// Старый формат (до 2.7): в extra лежал только сырой текст, без номера свайпа.
// Верим ему, если видимый текст начинается с него же без тегов. Если он
// совпадает с ДРУГИМ свайпом этого сообщения — это исходник чужого варианта,
// протащенный Таверной, и в скан он не идёт. Если не совпадает ни с чем
// (текст поправило другое расширение) — улик против нет, верим.
function legacyRawBelongsHere(msg, raw) {
    const clean = cleanText(raw);
    const mes = msg.mes || '';
    const swipes = Array.isArray(msg.swipes) ? msg.swipes : [];
    const cur = swipeIdOf(msg);
    if (!clean) return swipes.length <= 1;
    if (mes.startsWith(clean)) return true;
    const otherMatches = swipes.some((s, i) => i !== cur && typeof s === 'string' && s.startsWith(clean));
    return !otherMatches;
}

// Наши данные, относящиеся ИМЕННО к показанному свайпу. Сначала смотрим
// msg.extra (Таверна при перелистывании подставляет туда extra свайпа), потом
// swipe_info этого свайпа — на случай, если подстановки не было.
// null — данных этого варианта нет (новый свайп или чат старой версии).
function variantExtraOf(msg) {
    const swipe = swipeIdOf(msg);
    const candidates = [msg?.extra];
    if (swipe !== null && Array.isArray(msg?.swipe_info)) candidates.push(msg.swipe_info[swipe]?.extra);
    for (const ex of candidates) {
        if (ex && Array.isArray(ex.lifeweaverTags) && (ex.lifeweaverSwipe ?? null) === swipe) return ex;
    }
    return null;
}

// Теги, снятые с этого же варианта сообщения при прошлом скане
function storedTagsOf(msg) {
    const ve = variantExtraOf(msg);
    if (ve) return ve.lifeweaverTags.slice();
    const ex = msg?.extra;
    if (ex && !Array.isArray(ex.lifeweaverTags) && typeof ex.lifeweaverRaw === 'string' && ex.lifeweaverRaw
        && legacyRawBelongsHere(msg, ex.lifeweaverRaw)) {
        return ourTagComments(stripThink(ex.lifeweaverRaw));
    }
    return [];
}

// Собирает текст для скана. Сохранённые теги идут ПЕРВЫМИ: у одиночных тегов
// вроде DAYS_PASSED побеждает первый, и continue, дописавший свежий
// «DAYS_PASSED:0», не перебьёт исходное число дней.
// Экспортируется — тем же способом читает историю ретроскан.
// tags — модельные теги (их и храним), sig и text — с учётом ручной правки
// дней: правка меняет подпись, поэтому пересчёт срабатывает сам.
// index — номер сообщения в чате; без него сверка с календарём не делается.
export function composeScanText(msg, index = null) {
    const visible = stripThink(msg?.mes || '');
    const tags = modelTagsOf(msg);
    const model = modelDaysOf(tags);
    const override = daysOverrideOf(msg);
    const calendar = Number.isInteger(index) ? calendarDaysFor(index) : { status: 'none' };
    // Подставляем число только когда оно ОТЛИЧАЕТСЯ от модельного: если всё
    // сходится, подпись не меняется и лишнего пересчёта не будет.
    let days = null;
    let calendarUsed = false;
    if (override !== null) days = override;
    else if (calendar.status === 'ok' && calendar.days !== model) { days = calendar.days; calendarUsed = true; }
    const effective = days === null
        ? tags
        : [`<!-- [DAYS_PASSED:${days}] -->`, ...tags.filter(t => !DAYS_TAG_RE.test(t))];
    const prose = stripOurTags(visible);
    const text = effective.length ? `${prose}\n${effective.join('\n')}` : prose;
    return { text, tags, override, model, calendar, calendarUsed, sig: simpleHash(effective.join('\n')) };
}

// Модельные теги варианта: сохранённые + те, что ещё в тексте
function modelTagsOf(msg) {
    const visible = stripThink(msg?.mes || '');
    return [...new Set([...storedTagsOf(msg), ...ourTagComments(visible)])];
}

// ── Календарь Hearthtide ──
const HT_DATE_RE = /<!--\s*HT\b[^>]*?\bdate\s*=\s*(\d{1,6})-(\d{1,2})-(\d{1,2})/gi;
const MAX_CALENDAR_GAP = 366;

// Последняя дата Hearthtide в тексте сообщения: { y, m, d, n } или null
function htDateOf(msg) {
    const text = String(msg?.mes || '');
    let last = null;
    for (const mm of text.matchAll(HT_DATE_RE)) last = mm;
    if (!last) return null;
    const y = parseInt(last[1], 10), m = parseInt(last[2], 10), d = parseInt(last[3], 10);
    if (m < 1 || m > 12 || d < 1 || d > 31) return null;
    return { y, m, d, n: dayNumber(y, m, d) };
}

// Порядковый номер дня (григорианский календарь, работает и для 142 года)
function dayNumber(y, m, d) {
    y -= m <= 2 ? 1 : 0;
    const era = Math.floor(y / 400);
    const yoe = y - era * 400;
    const doy = Math.floor((153 * (m + (m > 2 ? -3 : 9)) + 2) / 5) + d - 1;
    const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
    return era * 146097 + doe;
}

function fmtHtDate(dt) {
    return `${String(dt.d).padStart(2, '0')}.${String(dt.m).padStart(2, '0')}.${String(dt.y).padStart(4, '0')}`;
}

// Сколько дней прошло по календарю Hearthtide в ответе под номером index.
// status: 'ok' (days, from, to) | 'none' (сверять не с чем) | 'weird' (дата
// выглядит неправдоподобно, не используем) | 'skip' (между ответами было
// сообщение со своим сдвигом дней — разница дат относится не только к этому
// ответу). reason — пояснение для диагностики.
function calendarDaysFor(index) {
    try {
        const chat = getStContext()?.chat;
        const msg = chat?.[index];
        if (!msg || msg.is_user || msg.is_system) return { status: 'none' };
        const to = htDateOf(msg);
        if (!to) return { status: 'none', reason: 'в ответе нет даты Hearthtide' };
        for (let j = index - 1; j >= 0; j--) {
            const prev = chat[j];
            if (!prev || prev.is_system) continue;
            if (prev.is_user) {
                if ((modelDaysOf(modelTagsOf(prev)) || 0) > 0) {
                    return { status: 'skip', reason: 'между ответами было твоё сообщение со своим сдвигом дней' };
                }
                continue;
            }
            const from = htDateOf(prev);
            if (!from) return { status: 'none', reason: 'у прошлого ответа нет даты Hearthtide' };
            const days = to.n - from.n;
            const span = `${fmtHtDate(from)} → ${fmtHtDate(to)}`;
            if (days < 0) return { status: 'weird', reason: `дата раньше прошлой (${span})`, span };
            if (days > MAX_CALENDAR_GAP) return { status: 'weird', reason: `скачок больше года (${span})`, span };
            return { status: 'ok', days, span };
        }
        return { status: 'none', reason: 'это первый ответ с датой' };
    } catch (e) {
        return { status: 'none' };
    }
}

function describeCalendar(cal) {
    if (!cal || cal.status === 'none') return cal?.reason ? `нет сверки — ${cal.reason}` : 'нет сверки';
    if (cal.status === 'ok') return `${cal.days} дн. (${cal.span})`;
    return `не учитываю — ${cal.reason}`;
}

const DAYS_TAG_RE = /\[\s*DAYS_PASSED\b/i;

// Ручная правка дней показанного варианта (число) или null
function daysOverrideOf(msg) {
    const v = variantExtraOf(msg)?.lifeweaverDaysOverride;
    return Number.isInteger(v) && v >= 0 ? v : null;
}

// Сколько дней написала модель в этом варианте; null — тега нет
function modelDaysOf(tags) {
    for (const t of tags) {
        const m = t.match(/\[\s*DAYS_PASSED\s*:\s*(\d+)/i);
        if (m) return Math.min(parseInt(m[1], 10), MAX_DAYS_PER_TAG);
    }
    return null;
}

// Записывает на сообщение (и в его свайп): какие теги сняты, с какого
// варианта, что они применены. Убирает теги из видимого текста.
function stampMessage(msg, swipe, tags, sig, rolls, daysOverride = daysOverrideOf(msg)) {
    if (!msg) return;
    msg.extra = msg.extra || {};
    const clean = cleanText(msg.mes);
    const fields = {
        lifeweaverTags: tags.slice(),
        lifeweaverSwipe: swipe,
        lifeweaverApplied: { swipe, sig },
    };
    const hasRolls = rolls && typeof rolls === 'object' && Object.keys(rolls).length > 0;
    // Сырой текст — для ретроскана и совместимости со старыми версиями
    const raw = tags.length ? `${clean}\n${tags.join('\n')}` : null;

    const write = (extra) => {
        Object.assign(extra, structuredClone(fields));
        if (raw) extra.lifeweaverRaw = raw;
        else delete extra.lifeweaverRaw; // иначе остался бы исходник чужого варианта
        if (hasRolls) extra.lifeweaverRolls = structuredClone(rolls);
        else delete extra.lifeweaverRolls;
        if (daysOverride !== null) extra.lifeweaverDaysOverride = daysOverride;
        else delete extra.lifeweaverDaysOverride;
    };
    write(msg.extra);
    // Тот же набор — в swipe_info этого свайпа: при перелистывании Таверна
    // восстанавливает extra оттуда, и у каждого варианта будут свои теги.
    if (swipe !== null && Array.isArray(msg.swipe_info) && msg.swipe_info[swipe]) {
        const si = msg.swipe_info[swipe];
        if (!si.extra || typeof si.extra !== 'object') si.extra = {};
        write(si.extra);
    }

    if (clean !== msg.mes) {
        msg.mes = clean;
        if (Array.isArray(msg.swipes) && swipe !== null && msg.swipes[swipe] !== undefined) {
            msg.swipes[swipe] = clean;
        }
    }
}

const OUR_FIELDS = ['lifeweaverTags', 'lifeweaverSwipe', 'lifeweaverApplied', 'lifeweaverRaw', 'lifeweaverRolls', 'lifeweaverDaysOverride'];

// ═══════════════════════════════════════════
// РУЧНАЯ ПРАВКА ДНЕЙ (диагностика)
// ═══════════════════════════════════════════

// Данные для строки «Дни в этом ответе». Читается с самого сообщения, а не
// из последнего скана — поэтому работает и после F5.
// Править можно только последнее сообщение чата и только ответ модели:
// после него нечего пересчитывать заново.
export function getDaysFixInfo() {
    const ctx = getStContext();
    const chat = ctx?.chat;
    if (!chat?.length) return { ok: false, reason: 'В чате пока нет сообщений.' };
    const idx = chat.length - 1;
    const msg = chat[idx];
    if (!msg || msg.is_system) return { ok: false, reason: 'Последнее сообщение — системное, править нечего.' };
    if (msg.is_user) return { ok: false, reason: 'Последнее сообщение — твоё. Править дни можно только у ответа модели, который стоит последним в чате.' };
    const { model, override, calendar } = composeScanText(msg, idx);
    const calendarDays = calendar.status === 'ok' ? calendar.days : null;
    const auto = calendarDays ?? model ?? 0;
    return {
        ok: true,
        mesIndex: idx,
        swipe: swipeIdOf(msg),
        model,
        override,
        calendar,
        calendarDays,
        calendarText: describeCalendar(calendar),
        auto,
        effective: override ?? auto,
        max: MAX_DAYS_PER_TAG,
    };
}

// Поставить (число) или снять (null) правку дней у последнего ответа и
// сразу пересчитать состояние. Возвращает { ok, message }.
export function setDaysOverride(value) {
    try {
        const info = getDaysFixInfo();
        if (!info.ok) return { ok: false, message: info.reason };
        let v = null;
        if (value !== null && value !== undefined && value !== '') {
            v = parseInt(value, 10);
            if (!Number.isInteger(v) || v < 0) return { ok: false, message: 'Нужно целое число от 0.' };
            v = Math.min(v, MAX_DAYS_PER_TAG);
        }
        // Правка, совпадающая с тем, что и так выходит (календарь или модель), —
        // это просто отсутствие правки
        if (v !== null && v === info.auto) v = null;

        const ctx = getStContext();
        const msg = ctx.chat[info.mesIndex];
        const swipe = swipeIdOf(msg);
        const { tags } = composeScanText(msg, info.mesIndex);
        // Отметка варианта пишется вместе с правкой; подпись «применено»
        // оставляем старой — runScan увидит расхождение и пересчитает.
        const oldApplied = variantExtraOf(msg)?.lifeweaverApplied?.sig ?? null;
        stampMessage(msg, swipe, tags, oldApplied, recordedRollsOf(msg), v);

        runScan(v === null ? 'ПРАВКА ДНЕЙ: как у модели' : `ПРАВКА ДНЕЙ: ${v}`);
        try { ctx.saveChat?.(); } catch (e) { /* ignore */ }
        return {
            ok: true,
            message: v === null
                ? `Правка снята: ${info.auto} дн. (${info.calendarDays !== null ? 'по календарю Hearthtide' : 'как у модели'}).`
                : `Поставил ${v} дн. — состояние пересчитано.`,
        };
    } catch (e) {
        console.error('[Lifeweaver] setDaysOverride error:', e);
        return { ok: false, message: 'Не получилось — подробности в консоли.' };
    }
}

// Основа «зерна» для кубиков варианта сообщения. Время отправки варианта
// не меняется ни при перелистывании, ни при удалении других сообщений;
// номер — запасной вариант для сообщений без времени. Одинаковое зерно у
// живого скана и ретроскана — поэтому они получают одних и тех же малышей.
export function variantSeedBase(msg, index) {
    return `${msg?.send_date ?? `#${index}`}|${swipeIdOf(msg) ?? 0}`;
}

// Записанные исходы бросков показанного варианта: { user?: {...}, char?: {...} }
export function recordedRollsOf(msg) {
    const r = variantExtraOf(msg)?.lifeweaverRolls;
    return r && typeof r === 'object' ? structuredClone(r) : {};
}

// Для ретроскана: проставить на сообщение отметки варианта и исходы бросков
export function stampVariant(msg, rolls, index = null) {
    const { tags, sig } = composeScanText(msg, index);
    stampMessage(msg, swipeIdOf(msg), tags, sig, rolls);
}

function scrubOurFields(extra) {
    if (!extra || typeof extra !== 'object') return;
    for (const k of OUR_FIELDS) delete extra[k];
}

function setVariantIndex(extra, i) {
    if (!extra || !Array.isArray(extra.lifeweaverTags)) return;
    extra.lifeweaverSwipe = i;
    if (extra.lifeweaverApplied) extra.lifeweaverApplied.swipe = i;
}

// После удаления свайпа: данные каждого варианта переезжают вместе с ним,
// а записанный в них номер — нет. Переписываем номера по новым местам и
// сдвигаем журнал «что применено».
function reindexAfterSwipeDeleted(data) {
    const ctx = getStContext();
    const chat = ctx?.chat;
    if (!chat?.length) return;
    const messageId = Number(data?.messageId ?? chat.length - 1);
    const removed = Number(data?.swipeId);
    if (messageId !== chat.length - 1 || !Number.isInteger(removed)) return;
    const m = chat[messageId];

    if (Array.isArray(m.swipe_info)) m.swipe_info.forEach((si, i) => setVariantIndex(si?.extra, i));
    // msg.extra пока ещё от показанного до удаления варианта
    const shown = m.extra?.lifeweaverSwipe;
    if (typeof shown === 'number') {
        if (shown === removed) scrubOurFields(m.extra);
        else if (shown > removed) setVariantIndex(m.extra, shown - 1);
    }

    const rec = getChatData()._lastApplied;
    if (rec && rec.pos === chat.length && typeof rec.swipe === 'number') {
        if (rec.swipe === removed) rec.swipe = -1;      // применённый вариант удалён — пересчитать
        else if (rec.swipe > removed) rec.swipe -= 1;
    }
    console.log(`[Lifeweaver] удалён свайп ${removed} — номера вариантов переписаны`);
}

// ═══════════════════════════════════════════
// ИСТОРИЯ СОСТОЯНИЙ ПО ПОЗИЦИЯМ
// ═══════════════════════════════════════════

// Снапшот per-chat состояния без самой истории (иначе она вложится в себя)
export function snapshotOfChatData() {
    const chat = getChatData();
    const copy = structuredClone(chat);
    // Ни история откатов, ни стек отмен внутрь снимка не попадают — иначе
    // каждый снимок тащил бы в себе все предыдущие, и состояние росло бы
    // лавиной с каждым сообщением.
    delete copy._history;
    delete copy._undo;
    return copy;
}

export function pushStateHistory(pos) {
    try {
        const chat = getChatData();
        if (!Array.isArray(chat._history)) chat._history = [];
        const snap = snapshotOfChatData();
        const existing = chat._history.find(h => h.pos === pos);
        if (existing) {
            existing.state = snap;
        } else {
            chat._history.push({ pos, state: snap });
            chat._history.sort((a, b) => a.pos - b.pos);
        }
        if (chat._history.length > HISTORY_CAP) {
            chat._history.splice(0, chat._history.length - HISTORY_CAP);
        }
    } catch (e) { /* ignore */ }
}

// Журнал: какой вариант какого сообщения сейчас отражён в состоянии
function setLastApplied(pos, swipe, sig) {
    getChatData()._lastApplied = { pos, swipe, sig };
}

function hasHistoryAt(pos) {
    const hist = getChatData()._history;
    return Array.isArray(hist) && hist.some(h => h.pos === pos);
}

// Полная замена состояния снимком; стек отмен и история переживают
// Отменённые зачатия — решение игрока, а не состояние сюжета: откат к
// снимку позиции (листание, реген, удаление сообщения) их не трогает.
// Стрелка в шапке восстанавливает их своим путём, вместе со сбросом.
function replaceChatState(state, keepHistory) {
    const chat = getChatData();
    const keptUndo = chat._undo;
    const keptCancelled = Array.isArray(chat.cancelledConceptions) ? chat.cancelledConceptions.slice() : null;
    for (const k of Object.keys(chat)) delete chat[k];
    Object.assign(chat, structuredClone(state));
    if (keptUndo) chat._undo = keptUndo;
    if (keptCancelled) chat.cancelledConceptions = keptCancelled;
    chat._history = keepHistory;
}

// Откат к состоянию ДО сообщения на позиции pos.
// Источник 1 — сохранённая история (последняя запись раньше pos).
// Источник 2 — снимок в памяти, если он снят именно перед этой позицией.
// Возвращает описание для диагностики или null, если откатываться некуда.
function restoreStateBefore(pos, chatIdNow) {
    const chat = getChatData();
    const hist = Array.isArray(chat._history) ? chat._history : [];
    const before = hist.filter(h => h.pos < pos);
    const target = before.length ? before[before.length - 1] : null;
    if (target) {
        replaceChatState(target.state, before);
        return `к позиции ${target.pos} (сохранённая история)`;
    }
    if (_preRegenSnapshot && _snapshotChatId === chatIdNow && _snapshotPos === pos) {
        replaceChatState(_preRegenSnapshot, hist.filter(h => h.pos < pos));
        return 'к снимку в памяти';
    }
    return null;
}

// Откат к моменту, когда в чате было newLen сообщений (удаление сообщения).
export function rollbackToPosition(newLen) {
    try {
        const chat = getChatData();
        if (!Array.isArray(chat._history) || chat._history.length === 0) return false;

        const kept = chat._history.filter(h => h.pos <= newLen);
        const target = kept.length > 0 ? kept[kept.length - 1] : null;
        if (!target) {
            chat._history = kept;
            return false;
        }

        // Полная замена состояния (с удалением ключей, появившихся позже)
        replaceChatState(target.state, kept);

        _preRegenSnapshot = snapshotOfChatData();
        _snapshotChatId = getCurrentChatId();
        _snapshotPos = newLen + 1;

        saveSettingsDebounced();
        notifyStateChanged();
        setTimeout(renderInfoblock, 200);
        return true;
    } catch (e) {
        return false;
    }
}

export function markRegeneration() {
    _isRegeneration = true;
}

// Вызывать после любого РУЧНОГО изменения состояния из интерфейса.
// Правка записывается в историю на текущую позицию: следующее сообщение
// будет считаться уже от неё. Свайп того сообщения, после которого правили,
// правку не сохранит — откат идёт к состоянию ДО него (так договорились).
export function refreshRegenSnapshot() {
    try {
        const ctx = getStContext();
        const len = ctx?.chat?.length ?? 0;
        if (len > 0) pushStateHistory(len);
    } catch (e) { /* ignore */ }
}

export function clearRegenState() {
    _isRegeneration = false;
    _mainGenSince = 0;
    _preRegenSnapshot = null;
    _snapshotChatId = null;
    _snapshotPos = null;
}

function notifyStateChanged() {
    try {
        document.dispatchEvent(new CustomEvent('lifeweaver:state-changed'));
    } catch (e) { /* ignore */ }
}

// Применяет разобранный результат скана. Порядок значим: потеря беременности —
// раньше остальных событий этого персонажа (взаимоисключающе с кладкой/родами).
function applyScanResult(result, debug = null, rolls = null) {
    if (!result) return;
    const log = (msg) => { if (debug) debug.применено.push(msg); };

    if (result.daysPassed > 0) {
        advanceTimeByDays(result.daysPassed);
        log(`время +${result.daysPassed} дн.`);
        // Вехи развития, пройденные за этот отрезок.
        // При большом скипе их набирается десяток — по тосту на каждую
        // подвешивало страницу, поэтому от трёх и больше сводим в одно.
        const milestones = takeMilestoneEvents();
        for (const ev of milestones) log(`веха: ${ev.name} — ${ev.label}`);
        if (milestones.length >= 3) {
            const byChild = {};
            for (const ev of milestones) (byChild[ev.name] ||= []).push(ev.label);
            const summary = Object.entries(byChild)
                .map(([n, list]) => `${n}: ${list.length} ${list.length < 5 ? 'вехи' : 'вех'} (последняя — ${list[list.length - 1]})`)
                .join('; ');
            notify(`<i class="fa-solid fa-star"></i> Дети выросли — ${summary}`, 'success');
        } else {
            for (const ev of milestones) {
                notify(`<i class="fa-solid fa-star"></i> ${ev.name}: ${ev.label}`, 'success');
            }
        }

        const grown = autoArchiveGrownChildren();
        if (grown.length) {
            log(`в архив по возрасту: ${grown.length}`);
            try {
                showGraduationDialog(grown, () => notifyStateChanged());
            } catch (e) { /* ignore */ }
        }
    }
    // Живая динамика от модели — до остальных событий, чтобы роды и кладка
    // уже видели актуальные данные сцены.
    if (result.status) {
        const n = applyStatus(result.status);
        if (n > 0) log(`динамика от модели: ${n} полей`);
    }
    if (result.timeOfDay) {
        if (result.timeOfDay.rpTime) {
            setRpTime(result.timeOfDay.rpTime);
            log(`время: ${result.timeOfDay.rpTime}`);
        } else if (result.timeOfDay.bucket) {
            setTimeOfDay(result.timeOfDay.bucket);
            log(`время суток: ${result.timeOfDay.bucket}`);
        }
    }
    let pendingBirth = null;

    for (const who of ['user', 'char']) {
        const isChar = who === 'char';
        const miscarriageTag = isChar ? result.charMiscarriage : result.miscarriage;
        const abortionTag = isChar ? result.charAbortion : result.abortion;
        const conceptionTag = isChar ? result.charConception : result.conception;
        const layTag = isChar ? result.charLayClutch : result.layClutch;
        const birthTag = isChar ? result.charBirth : result.birth;
        const knownTag = isChar ? result.charKnown : result.known;

        // Прерывание — взаимоисключающе с кладкой/родами, обрабатывается первым
        // Потеря по тегу модели — тоже разрушительное действие: если она
        // ошиблась, игрок должен иметь возможность откатить одной кнопкой.
        if (abortionTag) {
            createUndoCheckpoint('Прерывание беременности (по тегу)');
            if (applyAbortion(who)) notify('<i class="fa-solid fa-heart-crack"></i> Беременность прервана', 'warning');
            continue;
        }
        if (miscarriageTag) {
            createUndoCheckpoint('Потеря беременности (по тегу)');
            if (applyMiscarriage(who)) notify('<i class="fa-solid fa-heart-crack"></i> Беременность потеряна', 'warning');
            continue;
        }
        const sourceKey = rolls?.seedBase ? `${rolls.seedBase}|${who}` : null;
        if (conceptionTag && isConceptionCancelled(sourceKey)) {
            log(`${who}: зачатие из этого сообщения отменено вручную — пропускаю`);
        } else if (conceptionTag) {
            // Исход уже разыгран для этого варианта — воспроизводим его
            const forced = rolls?.recorded?.[who] || null;
            const res = applyConception(who, {
                forced,
                onRoll: (o) => { if (rolls) rolls.made[who] = o; },
                detailRnd: rolls?.seedBase ? seededRandom(`${rolls.seedBase}|${who}|details`) : undefined,
                source: sourceKey ? { key: sourceKey, mes: rolls.mesIndex } : undefined,
            });
            const replay = forced ? ' (повтор записанного броска)' : '';
            if (res === true) {
                const hidden = getSettings().hiddenPregnancy;
                log(`${who}: зачатие применено${replay}`);
                // Повтор — это пересчёт уже случившегося, а не новое событие
                if (!forced) notify(hidden
                    ? '<i class="fa-solid fa-user-secret"></i> Зачатие произошло — но он пока не знает'
                    : '<i class="fa-solid fa-check"></i> Зачатие произошло!', 'success');
            } else if (res && typeof res === 'object') {
                // Бросок не прошёл — это нормальный исход, а не сбой.
                // Показываем цифры, чтобы было видно, что механика работает.
                const detail = res.reason
                    ? `сработала защита (${res.reason})`
                    : `${res.roll} из ${res.chance}%`;
                log(`${who}: зачатия не произошло — ${detail}${replay}`);
                if (!forced) notify(`<i class="fa-solid fa-dice"></i> Зачатия не произошло · ${detail}`, 'info');
            } else {
                const c = getCharacterData(who);
                const why = !c.canCarry ? 'не отмечен носителем'
                    : c.pregnancy?.isPregnant ? 'уже беременен'
                    : isBlocked('conception', who) ? 'блок после недавней потери'
                    : 'неизвестно';
                log(`${who}: ЗАЧАТИЕ ОТКЛОНЕНО — ${why}`);
            }
        }
        // Раскрытие пола — до родов, чтобы дети создались с уже открытым полом
        const sexTag = isChar ? result.charSexRevealed : result.sexRevealed;
        if (sexTag) {
            revealOffspringSex(who, result.revealedSexes);
            log(`${who}: пол раскрыт`);
        }
        if (layTag) {
            if (applyLayClutch(who)) {
                log(`${who}: кладка применена`);
                notify('<i class="fa-solid fa-egg"></i> Кладка отложена — идёт инкубация, тело носителя свободно', 'success');
            } else {
                const c = getCharacterData(who);
                const why = !c.pregnancy?.isPregnant ? 'беременности нет' : 'вселенная без двух фаз';
                log(`${who}: КЛАДКА ОТКЛОНЕНА — ${why}`);
            }
        }
        if (birthTag) {
            const traits = isChar ? result.charBabyTraits : result.babyTraits;
            const created = applyBirth(who, traits);
            if (created && created.length) {
                pendingBirth = created;
                log(`${who}: роды применены, создано детей: ${created.length}`);
            } else {
                const c = getCharacterData(who);
                const hasClutch = getClutches().some(cl => cl.parentWho === who);
                const why = (!c.pregnancy?.isPregnant && !hasClutch) ? 'нет ни беременности, ни кладки'
                    : isBlocked('birth', who) ? 'БЛОК после недавней потери — снимется через несколько сообщений'
                    : 'неизвестно';
                log(`${who}: РОДЫ ОТКЛОНЕНЫ — ${why}`);
                notify(`<i class="fa-solid fa-triangle-exclamation"></i> Тег родов пришёл, но не применён: ${why}`, 'warning');
            }
        }
        if (knownTag) setPregnancyKnown(who, true);

        // Тест на беременность в сцене
        const testTag = isChar ? result.charTest : result.test;
        if (testTag) {
            const r = takeTest(who);
            log(`${who}: тест — ${TEST_LABELS[r] || r}`);
            notify(`<i class="fa-solid fa-vial"></i> Тест: ${TEST_LABELS[r] || r}`, r === 'negative' ? 'info' : 'success');
        }

        // Визит к врачу/целителю: лечим тело и все кладки этого носителя
        const doctorTag = isChar ? result.charDoctor : result.doctor;
        if (doctorTag) {
            let healed = 0, failed = 0;
            const body = doctorVisit(who);
            healed += body.healed; failed += body.failed;
            for (const c of getClutches().filter(cl => cl.parentWho === who)) {
                const r = doctorVisit(c.id);
                healed += r.healed; failed += r.failed;
            }
            if (healed || failed) {
                log(`${who}: лечение — вылечено ${healed}, осталось ${failed}`);
                notify(`<i class="fa-solid fa-stethoscope"></i> Вылечено: ${healed}${failed ? `, осталось: ${failed}` : ''}`, failed ? 'info' : 'success');
            }
        }
    }

    // Дозаполнение черт детей, описанных моделью позже (поэтапное вылупление)
    if (result.childTraits) {
        const filled = applyChildTraits(result.childTraits);
        if (filled > 0) log(`дозаполнены черты детей: ${filled} пол${filled === 1 ? 'е' : 'ей'}`);
    }

    // Диалог рождения — после применения всех событий
    if (pendingBirth) {
        try {
            showBirthDialog(pendingBirth, getActivePreset(), (names) => {
                if (Array.isArray(names)) {
                    names.forEach((n, i) => {
                        if (n && pendingBirth[i]) pendingBirth[i].name = n;
                    });
                    saveSettingsDebounced();
                }
                // ВАЖНО: диалог асинхронный — снапшот для отката уже был записан
                // в runScan, ДО того как игрок вписал имена. Без этой строки любой
                // откат (удаление сообщения, свайп, реген) возвращал детей без имён,
                // хотя черты оставались на месте.
                refreshRegenSnapshot();
                notifyStateChanged();
            });
        } catch (e) { /* ignore */ }
    }
}

function notify(html, type) {
    try {
        if (getSettings().showNotifications) showNotification(html, type);
    } catch (e) { /* ignore */ }
}

function stripTagsFromDom(index) {
    try {
        const el = document.querySelector(`.mes[mesid="${index}"] .mes_text`);
        if (el && hasOurTags(el.innerHTML)) {
            el.innerHTML = stripOurTags(el.innerHTML);
        }
    } catch (e) { /* ignore */ }
}

// ── Диагностика: что произошло на последнем скане (для панели и консоли) ──
let _lastDebug = null;

export function getLastScanDebug() {
    return _lastDebug;
}

function logDebug(entry) {
    _lastDebug = entry;
    console.log('[Lifeweaver] СКАН:', entry);
}

// Сохранить отметку и чат без применения тегов
function persistStamp(ctx, msg, idx, swipe, tags, sig) {
    stampMessage(msg, swipe, tags, sig, recordedRollsOf(msg));
    saveSettingsDebounced();
    try { ctx.saveChat?.(); } catch (e) { /* ignore */ }
    setTimeout(() => stripTagsFromDom(idx), 250);
}

function runScan(trigger = '?') {
    try {
        const settings = getSettings();
        if (!settings.isEnabled) {
            console.log('[Lifeweaver] скан пропущен: расширение выключено');
            return;
        }

        const ctx = getStContext();
        if (!ctx?.chat?.length) return;

        const idx = ctx.chat.length - 1;
        const lastMessage = ctx.chat[idx];
        if (!lastMessage || !lastMessage.mes) return;

        // Свайп ещё не существует (генерация нового варианта только началась
        // или её остановили) либо на его месте заглушка Таверны «...» —
        // сканировать нечего. Флаг регена не трогаем: он нужен настоящему скану.
        if (!lastMessage.is_user) {
            const outOfRange = Array.isArray(lastMessage.swipes) && typeof lastMessage.swipe_id === 'number'
                && lastMessage.swipe_id >= lastMessage.swipes.length;
            if (outOfRange || lastMessage.mes === '...') {
                console.log(`[Lifeweaver] скан пропущен: свайп ещё генерируется (триггер: ${trigger})`);
                return;
            }
        }

        migrateLegacyClutch(); // на случай чатов со старым форматом инкубации

        const positionId = ctx.chat.length;
        const isRegen = _isRegeneration && !lastMessage.is_user;
        _isRegeneration = false;

        const swipe = swipeIdOf(lastMessage);
        const { text, tags, sig, calendar, calendarUsed, model: modelDays } = composeScanText(lastMessage, idx);
        const ve = variantExtraOf(lastMessage);
        const markerMatches = !!ve?.lifeweaverApplied && ve.lifeweaverApplied.sig === sig;
        const rec = getChatData()._lastApplied;
        const recIsHere = !!rec && rec.pos === positionId;
        const chatIdNow = getCurrentChatId();

        // 1. Состояние уже отражает ровно этот вариант — повтор события
        if (recIsHere && (rec.swipe ?? null) === swipe && rec.sig === sig) {
            console.log(`[Lifeweaver] скан пропущен: позиция ${positionId}, свайп ${swipe} уже применён (триггер: ${trigger})`);
            return;
        }

        // 2. Журнала по этой позиции нет, но сообщение уже обрабатывали
        //    (отметка на свайпе или запись в истории) — чат от прошлой версии.
        //    Повторно не применяем, иначе дни сложились бы: только записываем.
        if (!isRegen && !recIsHere && (markerMatches || (!ve && hasHistoryAt(positionId)))) {
            setLastApplied(positionId, swipe, sig);
            persistStamp(ctx, lastMessage, idx, swipe, tags, sig);
            console.log(`[Lifeweaver] позиция ${positionId} уже была обработана раньше — записана без повторного применения (триггер: ${trigger})`);
            return;
        }

        // 3. Свайп из чата старой версии: его теги не сохранились, и что в нём
        //    было — неизвестно. Пересчитывать «в ноль» нельзя (потеряли бы его
        //    дни), поэтому состояние не трогаем.
        if (!isRegen && recIsHere && !ve && tags.length === 0) {
            console.log(`[Lifeweaver] свайп ${swipe} на позиции ${positionId} из старой версии, теги не сохранились — состояние не трогаю (триггер: ${trigger})`);
            return;
        }

        // 4. Вариант сменился (новый свайп, перелистывание, continue с новыми
        //    тегами) — сначала откат к состоянию ДО этого сообщения
        const isReplacement = isRegen || recIsHere || hasHistoryAt(positionId);
        let rollback;
        if (isReplacement) {
            rollback = restoreStateBefore(positionId, chatIdNow);
            if (rollback) {
                console.log(`[Lifeweaver] замена варианта: откат ${rollback}`);
            } else {
                rollback = 'НЕКУДА — применено поверх текущего';
                const key = `${chatIdNow}|${positionId}`;
                if (!_warnedPositions.has(key)) {
                    _warnedPositions.add(key);
                    notify('<i class="fa-solid fa-triangle-exclamation"></i> Не нашёл состояние до этого ответа — дни могли сложиться. Проверь «День истории» и цикл.', 'warning');
                }
                console.warn('[Lifeweaver] замена варианта, но откатиться некуда — состояние «до» не найдено');
            }
        }

        // Запасной снимок «до» — на случай, если история подведёт
        _preRegenSnapshot = snapshotOfChatData();
        _snapshotChatId = chatIdNow;
        _snapshotPos = positionId;

        // ── Диагностика ДО применения ──
        const described = describeScan(text);
        const result = scanMessage(text);
        const debugEntry = {
            триггер: trigger,
            чат: chatIdNow || '(не определён!)',
            позиция: positionId,
            свайп: swipe,
            режим: !isReplacement ? 'новое сообщение'
                : trigger === 'MESSAGE_SWIPED' ? 'перелистывание свайпа' : 'замена варианта',
            откат: rollback,
            откуда: lastMessage.is_user ? 'сообщение игрока' : 'ответ модели',
            комментариевВТексте: described.commentsFound,
            распознаноТегов: described.recognizedTags,
            адресатНеОпознан: result?.unresolved?.length ? result.unresolved : undefined,
            всеКомментарии: described.allComments,
            хвостТекста: text.slice(-400),
            событий: result ? Object.entries(result).filter(([k, v]) => v === true).map(([k]) => k) : [],
            кладки: getClutches().map(c => `${c.offspringCount} шт., ${c.weeks}/${c.totalWeeks} нед. (от ${c.parentWho})`),
            беременности: ['user', 'char'].map(w => {
                const p = getCharacterData(w).pregnancy;
                return p?.isPregnant ? `${w}: ${p.weeks} нед., stage=${p.stage}, ${p.offspringCount} шт.` : `${w}: нет`;
            }),
            днейПрошло: result?.daysPassed || 0,
            правкаДней: daysOverrideOf(lastMessage) ?? undefined,
            календарь: lastMessage.is_user ? undefined
                : (calendarUsed ? `взял ${calendar.days} дн. по календарю Hearthtide (${calendar.span}), модель говорила ${modelDays ?? 'ничего'}`
                    : describeCalendar(calendar)),
            применено: [],
        };

        if (result?.unresolved?.length) {
            console.warn('[Lifeweaver] адресат тега не опознан:', result.unresolved);
            notify(`<i class="fa-solid fa-question"></i> Не понял, к кому относится: ${result.unresolved.join(', ')}`, 'warning');
        }
        // Записанные броски этого варианта + те, что будут сделаны сейчас.
        // Неиспользованные записанные сохраняем: персонаж мог быть уже
        // беременен при этом пересчёте, а при другом — нет.
        const rolls = { recorded: ve?.lifeweaverRolls || {}, made: {}, seedBase: variantSeedBase(lastMessage, idx), mesIndex: idx };
        if (result) {
            applyScanResult(result, debugEntry, rolls);
        }
        const rollsToStore = { ...rolls.recorded, ...rolls.made };
        // Промпт и панель освежаем и после пустого варианта: откат мог
        // изменить состояние, даже если применять было нечего.
        if (result || isReplacement) {
            updatePromptInjection();
            notifyStateChanged();
        }
        logDebug(debugEntry);

        setLastApplied(positionId, swipe, sig);
        pushStateHistory(positionId);
        stampMessage(lastMessage, swipe, tags, sig, rollsToStore);
        saveSettingsDebounced();
        try { ctx.saveChat?.(); } catch (e) { /* ignore */ }
        setTimeout(() => stripTagsFromDom(idx), 250);
        // ST дорисовывает сообщение не мгновенно; двойной проход надёжнее —
        // второй переживает собственную перерисовку Таверны.
        setTimeout(renderInfoblock, 300);
        setTimeout(renderInfoblock, 900);
    } catch (e) {
        console.error('[Lifeweaver] runScan error:', e);
    }
}

export function initAutomation() {
    try {
        console.log(`[Lifeweaver] автоматика ${AUTOMATION_BUILD} загружена`);
        // Сканер сам не знает имён персонажей — отдаём ему сопоставление
        setWhoResolver(resolveWhoByName);
        if (event_types.MESSAGE_RECEIVED) {
            eventSource.on(event_types.MESSAGE_RECEIVED, (i, type) => {
                if (type === 'quiet') return;
                runScan('MESSAGE_RECEIVED');
            });
        }
        if (event_types.MESSAGE_SENT) {
            eventSource.on(event_types.MESSAGE_SENT, (i, type) => {
                if (type === 'quiet') return;
                runScan('MESSAGE_SENT');
            });
        }

        // Реген/свайп с генерацией определяем по явному типу генерации.
        // MESSAGE_SWIPED сюда НЕ ставит флаг: он стреляет и при простом
        // перелистывании, флаг повисал и потом срабатывал на чужой тихой
        // генерации. Перелистывание обрабатывается отдельно, ниже.
        if (event_types.GENERATION_STARTED) {
            eventSource.on(event_types.GENERATION_STARTED, (genType, params, dryRun) => {
                if (dryRun || genType === 'quiet') return;
                _mainGenSince = Date.now();
                if (genType === 'regenerate' || genType === 'swipe') markRegeneration();
                // Новый свайп: Таверна оставляет в extra данные ПРЕДЫДУЩЕГО
                // варианта (их копия уже лежит в его swipe_info) и потом
                // копирует их в swipe_info нового. Снимаем наши поля, чтобы
                // чужие теги не приклеились к новому варианту.
                if (genType === 'swipe') scrubOurFields(getStContext()?.chat?.at(-1)?.extra);
            });
        }

        // Пересчитать состояние под показанный вариант, если он не тот, что
        // применён. Безопасно звать сколько угодно раз: совпало — ничего не
        // происходит. Пока идёт основная генерация, не лезем.
        const reconcile = (trigger, delays) => {
            for (const ms of delays) {
                setTimeout(() => {
                    try {
                        if (mainGenActive()) return;
                        const m = getStContext()?.chat?.at(-1);
                        if (!m || m.is_user) return;
                        runScan(trigger);
                    } catch (e) { /* ignore */ }
                }, ms);
            }
        };

        // Перелистывание к готовому свайпу. Две попытки: сразу и после
        // анимации — на случай версии Таверны, где текст меняется позже.
        if (event_types.MESSAGE_SWIPED) {
            eventSource.on(event_types.MESSAGE_SWIPED, () => reconcile('MESSAGE_SWIPED', [60, 700]));
        }

        // Удаление свайпа: номера свайпов после удалённого сдвигаются на один,
        // а у нас в данных записан номер. Переписываем, потом сверяемся.
        if (event_types.MESSAGE_SWIPE_DELETED) {
            eventSource.on(event_types.MESSAGE_SWIPE_DELETED, (data) => {
                try { reindexAfterSwipeDeleted(data); } catch (e) { /* ignore */ }
                reconcile('MESSAGE_SWIPED', [60, 700]);
            });
        }

        // Редактирование сообщений: могла поменяться дата Hearthtide (в этом
        // ответе или в прошлом), а значит — дни последнего ответа. Сверка
        // ничего не делает, если итоговое число не изменилось.
        for (const evt of ['MESSAGE_EDITED', 'MESSAGE_UPDATED']) {
            if (event_types[evt]) {
                eventSource.on(event_types[evt], () => reconcile('ПРАВКА СООБЩЕНИЯ', [120]));
            }
        }

        // GENERATION_ENDED — хук для стриминговых свайпов/continue
        if (event_types.GENERATION_ENDED) {
            eventSource.on(event_types.GENERATION_ENDED, () => {
                _mainGenSince = 0;
                runScan('GENERATION_ENDED');
            });
        }

        // Стоп. Если остановленный свайп пуст, Таверна молча возвращает
        // прежний вариант — без единого события, примерно через секунду
        // (сначала мигает счётчиком). Поэтому сверяемся сами, с запасом.
        if (event_types.GENERATION_STOPPED) {
            eventSource.on(event_types.GENERATION_STOPPED, () => {
                _mainGenSince = 0;
                reconcile('ПОСЛЕ СТОПА', [1500, 4000]);
            });
        }

        // Удаление сообщения — откат к снапшоту предыдущей позиции.
        // ST эмитит MESSAGE_DELETED с НОВОЙ длиной чата (после удаления).
        if (event_types.MESSAGE_DELETED) {
            eventSource.on(event_types.MESSAGE_DELETED, (newLength) => {
                const ctx = getStContext();
                const len = typeof newLength === 'number' ? newLength : (ctx?.chat?.length ?? 0);
                rollbackToPosition(len);
                updatePromptInjection();
            });
        }

        // Инфоблок живёт в DOM, поэтому его надо возвращать после любой
        // перерисовки ленты — свайпы, удаление, подгрузка истории.
        for (const evt of ['MESSAGE_SWIPED', 'MESSAGE_DELETED', 'MESSAGE_UPDATED', 'CHARACTER_MESSAGE_RENDERED', 'USER_MESSAGE_RENDERED', 'MORE_MESSAGES_LOADED']) {
            if (event_types[evt]) {
                eventSource.on(event_types[evt], () => setTimeout(renderInfoblock, 200));
            }
        }
    } catch (e) {
        console.error('[Lifeweaver] initAutomation error:', e);
    }
}
