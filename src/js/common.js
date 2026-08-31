/* ===========================================================================
 *  מנוע משותף לשלושת המוקאפים — ביוגרפיות תנאים ואמוראים
 *  (קוד הדגמה לבחירת פריסה; בתוסף האמיתי ההגיון יעבור ל-js/app.js)
 * ========================================================================= */

const DATA = (window.BIO_DATA || []);
const DATA_BY_ID = new Map(DATA.map(entry => [entry.i, entry]));
const HEBREW_ALPHABET = [
  '\u05D0', '\u05D1', '\u05D2', '\u05D3', '\u05D4', '\u05D5', '\u05D6',
  '\u05D7', '\u05D8', '\u05D9', '\u05DB', '\u05DC', '\u05DE', '\u05E0',
  '\u05E1', '\u05E2', '\u05E4', '\u05E6', '\u05E7', '\u05E8', '\u05E9',
  '\u05EA'
];
const HEBREW_RANK = new Map(HEBREW_ALPHABET.map((letter, index) => [letter, index]));
const FINAL_LETTERS = new Map([
  ['\u05DA', '\u05DB'], ['\u05DD', '\u05DE'], ['\u05DF', '\u05E0'],
  ['\u05E3', '\u05E4'], ['\u05E5', '\u05E6']
]);

function compareHebrewNames(left, right) {
  const a = left.n, b = right.n;
  const length = Math.min(a.length, b.length);
  for (let index = 0; index < length; index++) {
    const aChar = FINAL_LETTERS.get(a[index]) || a[index];
    const bChar = FINAL_LETTERS.get(b[index]) || b[index];
    const aRank = HEBREW_RANK.has(aChar) ? HEBREW_RANK.get(aChar) : 99;
    const bRank = HEBREW_RANK.has(bChar) ? HEBREW_RANK.get(bChar) : 99;
    if (aRank !== bRank) return aRank - bRank;
    if (aChar !== bChar) return aChar.localeCompare(bChar, 'he');
  }
  return a.length - b.length;
}

/* ----- נרמול שם לצורך התאמת הפניות "ע"ע" ----- */
function normName(s) {
  return String(s)
    .replace(/\([^)]*\)/g, '')                 // הסרת מספר בסוגריים (7)
    .replace(/["'’]/g, '')                      // הסרת גרשיים/גרש
    .replace(/^(רבי|רבנא|רבן|רב|ר|מר)\s+/, '')   // הסרת תואר מוביל
    .replace(/\s+/g, ' ')
    .trim();
}

/* אינדקס שם -> מזהה ערך */
const NAME_INDEX = new Map();
DATA.forEach(e => {
  const plain = String(e.n).replace(/\([^)]*\)/g, '').trim();
  [normName(e.n), plain].forEach(k => {
    if (k && !NAME_INDEX.has(k)) NAME_INDEX.set(k, e.i);
  });
});

function findEntryByName(raw) {
  const t = String(raw).trim().replace(/[.;,]+$/, '');
  if (NAME_INDEX.has(t)) return NAME_INDEX.get(t);
  const n = normName(t);
  return NAME_INDEX.has(n) ? NAME_INDEX.get(n) : null;
}

/* ----- escape בסיסי (משאיר גרשיים, מטפל ב-< > &) ----- */
function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/* ----- זיהוי מקור ש"ס בתוך סוגריים ----- */
function isSource(inner) {
  const s = inner.trim();
  if (/^\d+$/.test(s)) return false;                       // (7)
  if (/^ע"ע/.test(s)) return false;                        // (ע"ע)
  if (/^(שם|עיין שם|ע"ש|וכו'?|כנ"ל|וע"ע)$/.test(s)) return false;
  if (!/[א-ת]/.test(s)) return false;
  // קישור רק אם נראה כמו ציטוט אמיתי: כולל סימן דף/פרק/הלכה (גרשיים) או גרש
  // (כך הערה מסבירה כמו "כי חשב שמצווה..." לא תהפוך לקישור)
  return /["']/.test(s);
}

/* ----- קישור-אוטומטי לשמות חכמים המוזכרים בטקסט -----
   (א) שמות-כינוי ללא שם-אב  -> התאמה מדויקת (לפחות 2 מילים).
   (ב) שמות עם שם-אב (בן/בר/בריה דְ…) -> התאמה גמישה על השם הפרטי
       (עד 2 שינויי-אות, כולל חילוף אותיות סמוכות), בתנאי ששם-האב זהה במדויק.
   כך מקושרים וריאנטים של כתיב (חנניה≈חנינא, יהושוע≈יהושע) בלי לקשר שמות שונים.
   שמות נפוצים בני מילה אחת (אביי, רבא, "רבי יוחנן", "רב הונא") לא מקושרים. */
const TITLE_RE = /^(רבי|רבנא|רבן|רב|ר'|ר|מר)\s+/;
const TITLE_OPT = '(?:(?:רבי|רבנא|רבן|רב|ר\'|ר|מר)\\s+)?';
const MARKERS = new Set(['בן', 'בר', 'ברבי', 'בריה', 'אבוה', 'אחוה', 'בני', 'ברת', 'ברתיה']);

const EXACT_MAP = new Map();    // גרעין-שם -> id  (ללא שם-אב)
const PATRON_MAP = new Map();   // שם-אב -> [{ first, id }]

DATA.forEach(e => {
  const disp = String(e.n).replace(/\([^)]*\)/g, '').trim();
  const core = disp.replace(TITLE_RE, '').trim();
  const words = core.split(/\s+/);
  let mi = -1;
  for (let k = 1; k < words.length; k++) { if (MARKERS.has(words[k])) { mi = k; break; } }
  if (mi >= 1) {
    const first = words[mi - 1];
    const remainder = words.slice(mi).join(' ');
    if (first.length >= 3 && remainder.length >= 4) {
      if (!PATRON_MAP.has(remainder)) PATRON_MAP.set(remainder, []);
      PATRON_MAP.get(remainder).push({ first, id: e.i });
    }
  } else if (core.length >= 9 && words.length >= 2) {
    if (!EXACT_MAP.has(core)) EXACT_MAP.set(core, e.i);
  }
});

function reAlt(keys) {
  return keys.sort((a, b) => b.length - a.length)
    .map(k => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
}
const EXACT_RE = EXACT_MAP.size
  ? new RegExp('(?<![א-ת"\'])' + TITLE_OPT + '(' + reAlt([...EXACT_MAP.keys()]) + ')(?![א-ת"\'])', 'g')
  : null;
const PATRON_RE = PATRON_MAP.size
  ? new RegExp('(?<![א-ת"\'])(' + TITLE_OPT + '[א-ת\'"]{2,})\\s+(' + reAlt([...PATRON_MAP.keys()]) + ')(?![א-ת"\'])', 'g')
  : null;

/* מרחק עריכה (Optimal String Alignment): חילוף אותיות סמוכות נחשב שינוי אחד */
function osaDist(a, b) {
  if (a === b) return 0;
  const m = a.length, n = b.length;
  if (Math.abs(m - n) > 2) return 9;
  const d = [];
  for (let i = 0; i <= m; i++) d[i] = [i];
  for (let j = 0; j <= n; j++) d[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
      }
    }
  }
  return d[m][n];
}

/* ----- הפיכת גוף הביוגרפיה ל-HTML עם קישורים ----- */
function renderBody(raw) {
  let s = esc(raw);
  const store = [];
  const hold = html => { store.push(html); return '' + (store.length - 1) + ''; };

  // 1) מקורות ש"ס בסוגריים -> קישור לאוצריא  (מוגנים מקישור-אוטומטי)
  s = s.replace(/\(([^)]+)\)/g, (m, inner) => {
    if (!isSource(inner)) return m;
    return '(' + hold('<a class="src" data-src="' + encodeURIComponent(inner) + '">' + inner + '</a>') + ')';
  });

  // 2) הפניות מפורשות:  ע"ע <שם>; <שם>  (מקשר גם שמות קצרים)
  s = s.replace(/ע"ע\s+([^.()]+)/g, (m, names) => {
    const parts = names.split(/;/).map(p => {
      const t = p.trim();
      if (!t) return p;
      const id = findEntryByName(t);
      return id != null ? hold('<a class="xref" data-goto="' + id + '">' + t + '</a>') : t;
    });
    return 'ע"ע ' + parts.join('; ');
  });

  // 3) שמות עם שם-אב: התאמה גמישה על השם הפרטי, כששם-האב זהה במדויק
  if (PATRON_RE) {
    s = s.replace(PATRON_RE, (m, namePart, remainder) => {
      const cand = namePart.replace(TITLE_RE, '').trim();
      const list = PATRON_MAP.get(remainder) || [];
      let best = null, bestD = 99;
      for (const o of list) { const d = osaDist(cand, o.first); if (d < bestD) { bestD = d; best = o; } }
      const ok = best && (bestD === 0 || (cand.length >= 4 && bestD <= 2));
      return ok ? hold('<a class="xref" data-goto="' + best.id + '">' + m + '</a>') : m;
    });
  }

  // 4) שמות-כינוי ללא שם-אב: התאמה מדויקת
  if (EXACT_RE) {
    s = s.replace(EXACT_RE, (m, core) => {
      const id = EXACT_MAP.get(core);
      return id != null ? hold('<a class="xref" data-goto="' + id + '">' + m + '</a>') : m;
    });
  }

  // שחזור העוגנים השמורים
  s = s.replace(/(\d+)/g, (_, i) => store[+i]);
  return s;
}

/* פיצול שם ל-(תצוגה, מספר) */
function splitName(n) {
  const m = String(n).match(/^(.*?)\s*\((\d+)\)\s*$/);
  return m ? { name: m[1], count: m[2] } : { name: String(n), count: null };
}

/* ===========================================================================
 *  שם האב מתוך השם עצמו
 *  רוב השמות במאגר הם שמות פטרונימיים — "אבא בר איבו", "רבי אבא בריה דרב
 *  ביבי", "רבי שמעון בן יוחאי". גם כשאין רשומת קשר מפורשת ב-BIO_RELATIONS,
 *  שם האב כתוב בשם עצמו, ולכן אפשר להסיק אותו במקום להציג "לא ידועים במאגר".
 * ========================================================================= */

const DERIVED_PARENT_LABEL = 'הורה (לפי השם)';

/* תארים שאפשר להתעלם מהם בתחילת השם. "רבה"/"רבא" אינם ברשימה — אלה שמות
   פרטיים בפני עצמם ("רבה בר בר חנה"), והסרתם הייתה מוחקת את בעל הערך. */
const NAME_TITLE_RE = /^(?:רבינו|רבנא|רבן|רבי|רב|מרי|מר|ר['׳]?)\s+/;

/* מחברים פטרונימיים: "בר X" \ "בן X" \ "בריה דX" \ "ברבי X" */
const PATRONYM_RE = /(?:^|\s)(?:בריה|ברי['׳])\s*ד|(?:^|\s)(?:בר|בן|ברבי)\s+/;

/* מתארי קרבה שמצביעים על אדם אחר — "אבוה דפלוני" (אביו של), "אחוה דפלוני"
   (אחיו של). כשאלה מופיעים לפני המחבר הפטרונימי, ה"בר" שאחריהם שייך לאותו
   אדם אחר ולא לבעל הערך, ולכן אין להסיק ממנו כלום. */
const OTHER_PERSON_RE = /(?:^|\s)(?:אבוה|אחוה|אחוי|חתניה|בריה\s*דבריה|חמוה|אמיה|דבי)\s*ד/;

/* אינדקס שמות מנורמלים -> ערך, לזיהוי האב כערך קיים במאגר */
let _nameIndex = null;
function nameIndex() {
  if (_nameIndex) return _nameIndex;
  _nameIndex = new Map();
  for (const entry of DATA) {
    const key = normSearchText(splitName(entry.n).name);
    if (key && !_nameIndex.has(key)) _nameIndex.set(key, entry);
  }
  return _nameIndex;
}

/* מחזיר את שם האב כפי שהוא כתוב בתוך השם, או null אם אי אפשר להסיק */
function parentNameFromName(fullName) {
  const name = splitName(fullName).name.replace(NAME_TITLE_RE, '').trim();
  if (!name) return null;

  const match = PATRONYM_RE.exec(name);
  if (!match) return null;
  /* שם שמתחיל במחבר עצמו ("בר קפרא", "בן עזאי") אינו פטרונימי */
  if (match.index === 0) return null;

  const other = OTHER_PERSON_RE.exec(name);
  if (other && other.index < match.index) return null;

  const father = name.slice(match.index + match[0].length).trim();
  if (father.length < 2) return null;
  /* "בר בריה דפלוני" — נכדו של; האב עצמו אינו נקוב בשם, ואין מה להציג */
  if (/^(?:בריה|ברי['׳])\s*ד/.test(father)) return null;
  return father;
}

/* קשר "הורה" שנגזר מהשם — עם id כשהאב קיים כערך במאגר, אחרת טקסט בלבד */
function derivedParentRelation(entry) {
  if (!entry) return null;
  const father = parentNameFromName(entry.n);
  if (!father) return null;
  const match = nameIndex().get(normSearchText(father));
  if (match && match.i === entry.i) return null;
  return { name: match ? splitName(match.n).name : father, label: DERIVED_PARENT_LABEL, id: match ? match.i : null };
}

/* כל הקשרים של ערך: הרשומים ב-BIO_RELATIONS, ובנוסף האב שנגזר מהשם —
   רק כשאין כבר הורה רשום ושהשם אינו מופיע ברשימה ממילא. */
function relationsFor(id) {
  const listed = (window.BIO_RELATIONS || {})[id] || [];
  if (listed.some(r => r.label === 'הורה')) return listed;
  const derived = derivedParentRelation(DATA_BY_ID.get(id));
  if (!derived) return listed;
  const already = listed.some(r =>
    (derived.id != null && r.id === derived.id) || normSearchText(r.name) === normSearchText(derived.name));
  return already ? listed : listed.concat([derived]);
}

/* ----- דירוג חיפוש: שם מדויק קודם, ואחריו התאמה קרובה בשם -----
   החיפוש סובלני לניקוד, גרשיים, אותיות סופיות ותארים (רב/רבי), אך אינו
   "מנחש" איות אחר. כך תוצאות רלוונטיות נשארות קרובות ככל האפשר למה שהוקלד. */
function normSearchText(value) {
  return String(value || '')
    .replace(/\([^)]*\)/g, '')
    .replace(/[\u0591-\u05C7]/g, '')
    .replace(/[׳״"'`]/g, '')
    .replace(/[-–—.,;:!?/\\]/g, ' ')
    .replace(/^(?:רבי|רבנא|רבן|רב|ר|מר)\s+/, '')
    .replace(/[ךםןףץ]/g, c => ({ ך:'כ', ם:'מ', ן:'נ', ף:'פ', ץ:'צ' })[c])
    .replace(/\s+/g, ' ')
    .trim();
}

function searchScore(entry, query, options) {
  const rawQuery = String(query || '').trim();
  const q = normSearchText(rawQuery);
  if (!q) return -1;
  const name = splitName(entry.n).name;
  const normalizedName = normSearchText(name);
  if (name === rawQuery) return 12000;
  if (normalizedName === q) return 11000;
  if (normalizedName.startsWith(q)) return 9000 - Math.min(800, normalizedName.length - q.length);
  const wordAt = normalizedName.indexOf(' ' + q);
  if (wordAt !== -1) return 8000 - Math.min(800, normalizedName.length - q.length + wordAt);
  const inName = normalizedName.indexOf(q);
  if (inName !== -1) return 7000 - Math.min(900, inName * 10 + normalizedName.length - q.length);
  if (options && options.namesOnly) return -1;

  const enrich = (window.BIO_ENRICH || {})[entry.i];
  const fields = [entry.b, enrich && enrich.place, enrich && enrich.dor, enrich && enrich.type];
  for (const field of fields) {
    const at = normSearchText(field).indexOf(q);
    if (at !== -1) return 3000 - Math.min(900, at);
  }
  return -1;
}

function rankSearchEntries(entries, query, options) {
  return entries.map((entry, index) => ({ entry, index, score: searchScore(entry, query, options) }))
    .filter(result => result.score >= 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map(result => result.entry);
}

/* ----- פתיחת מקור: במוקאפ רק טוסט; בתוסף -> reader.openBookAtRef ----- */
function openInOtzaria(src) {
  toast('🔗 ייפתח באוצריא:  ' + src);
  /* בתוסף האמיתי:
     const book = parseCitation(src);                       // book + ref
     const { data } = await Otzaria.call('library.findBooks', { query: book.title, limit: 1 });
     if (data && data[0]) await Otzaria.call('reader.openBookAtRef', { bookId: data[0].bookId, ref: book.ref });
  */
}

/* ===========================================================================
 *  גלילה אופקית עם משטח מגע
 *  בעמוד RTL כמו זה, ה-WebView של אוצריא מספק לעיתים deltaX בסימן הפוך,
 *  והתוצאה היא גלילה לצד הנגדי לזה שאליו מזיזים את האצבעות. במקום להישען
 *  על התנהגות ברירת המחדל, אנחנו מטפלים בגלילה האופקית בעצמנו: הגדלת
 *  scrollLeft פירושה תמיד תזוזה ימינה פיזית — גם במיכל LTR (0..max) וגם
 *  במיכל RTL (‎-max..0) — ולכן המיפוי הזה נכון בשתי התצוגות.
 * ========================================================================= */
function scrollableXAncestor(node) {
  for (let el = node; el && el !== document.documentElement; el = el.parentElement) {
    if (el.nodeType !== 1) continue;
    if (el.scrollWidth - el.clientWidth <= 1) continue;
    const overflowX = getComputedStyle(el).overflowX;
    if (overflowX === 'auto' || overflowX === 'scroll') return el;
  }
  return null;
}

function installHorizontalScrollFix() {
  window.addEventListener('wheel', ev => {
    const dx = ev.deltaX || (ev.shiftKey ? ev.deltaY : 0);
    if (!dx || ev.ctrlKey) return;
    const el = scrollableXAncestor(ev.target);
    if (!el) return;
    const max = el.scrollWidth - el.clientWidth;
    /* במיכל RTL הטווח הוא ‎-max..0 ובמיכל LTR הוא 0..max.
       בקצה — משאירים את האירוע לדפדפן כדי לא לחסום גלילה של ההורה. */
    const rtl = getComputedStyle(el).direction === 'rtl';
    const next = Math.max(rtl ? -max : 0, Math.min(rtl ? 0 : max, el.scrollLeft + dx));
    if (next === el.scrollLeft) return;
    el.scrollLeft = next;
    ev.preventDefault();
  }, { passive: false });
}

/* ----- טוסט ----- */
let _toastT = null;
function toast(msg) {
  let el = document.getElementById('toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast';
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(_toastT);
  _toastT = setTimeout(() => el.classList.remove('show'), 2600);
}

/* ===========================================================================
 *  מנוע רשימה עם חיפוש, כותרות אותיות וגלילה אינסופית (windowing)
 * ========================================================================= */
function createList(scrollEl, listEl, onOpen) {
  // מרנדרים את כל הערכים המסוננים בבת אחת — כך פס הגלילה משקף את גובה התוכן האמיתי
  // (במקום גלילה אינסופית/windowing שבה הגלילן "קפץ" כשנטענו עוד שורות).
  const BATCH = Infinity;
  let cat = 'sage';   // קטגוריה נוכחית: 'sage' (תנאים/אמוראים) או 'biblical' (דמויות תנ"כיות)
  let filtered = DATA.filter(e => e.cat === cat);
  let rendered = 0;
  let lastLetter = null;

  function setCategory(c) { cat = c; }

  function reset(q) {
    q = (q || '').trim();
    const base = DATA.filter(e => e.cat === cat);
    filtered = q ? rankSearchEntries(base, q) : base;
    // Biblical records originate in a database whose row order is not
    // alphabetical.  Sort at display time as well, so the UI stays correct
    // even if the source data is rebuilt in a different order.
    if (cat === 'biblical') filtered = filtered.slice().sort(compareHebrewNames);
    rendered = 0;
    lastLetter = null;
    listEl.innerHTML = '';
    if (!filtered.length) {
      listEl.innerHTML = '<div class="empty">לא נמצאו ערכים</div>';
    }
    renderMore();
    scrollEl.scrollTop = 0;
    updateCount();
  }

  function renderMore() {
    const frag = document.createDocumentFragment();
    const end = Math.min(rendered + BATCH, filtered.length);
    for (let i = rendered; i < end; i++) {
      const e = filtered[i];
      if (e.l !== lastLetter) {
        lastLetter = e.l;
        const h = document.createElement('div');
        h.className = 'letter';
        h.textContent = 'אות ' + e.l;
        frag.appendChild(h);
      }
      const sp = splitName(e.n);
      const row = document.createElement('div');
      row.className = 'row';
      row.dataset.id = e.i;
      row.innerHTML = '<span class="nm">' + esc(sp.name) + '</span>';
      frag.appendChild(row);
    }
    rendered = end;
    listEl.appendChild(frag);
    sentinel(); // ודא שה-sentinel בסוף
  }

  let sEl = null, io = null;
  function sentinel() {
    if (sEl) sEl.remove();
    if (rendered >= filtered.length) return;
    sEl = document.createElement('div');
    sEl.style.height = '1px';
    listEl.appendChild(sEl);
    if (!io) {
      io = new IntersectionObserver(es => {
        if (es.some(x => x.isIntersecting)) renderMore();
      }, { root: scrollEl, rootMargin: '600px' });
    }
    io.observe(sEl);
  }

  function updateCount() {
    const c = document.getElementById('count');
    if (c) c.textContent = filtered.length.toLocaleString('he') + ' ערכים';
  }

  // לחיצה
  listEl.addEventListener('click', ev => {
    const row = ev.target.closest('.row');
    if (row) onOpen(parseInt(row.dataset.id, 10), row);
  });

  function jumpToLetter(L) {
    const idx = filtered.findIndex(e => e.l === L);
    if (idx < 0) return;
    while (rendered <= idx && rendered < filtered.length) renderMore();
    const target = listEl.querySelector('.row[data-id="' + filtered[idx].i + '"]');
    if (!target) return;
    // כותרות-האות הן position:sticky, ולכן offsetTop שלהן אינו אמין (מחזיר את מיקום
    // ההצמדה הנוכחי) — מה שגרם לקפיצה אחורה לא לעבוד. לכן נשענים על offsetTop של
    // השורה (אלמנט סטטי, אמין בשני הכיוונים) ומפחיתים את גובה הכותרת.
    const prev = target.previousElementSibling;
    const headerH = (prev && prev.classList.contains('letter')) ? prev.offsetHeight : 0;
    scrollEl.scrollTop = Math.max(0, target.offsetTop - headerH);
  }

  function scrollToId(id) {
    const idx = filtered.findIndex(e => e.i === id);
    if (idx < 0) return null;
    while (rendered <= idx && rendered < filtered.length) renderMore();
    const target = listEl.querySelector('.row[data-id="' + id + '"]');
    if (target) target.scrollIntoView({ block: 'center' });
    return target;
  }

  /* השכן ברשימה (לפי הסדר המוצג / מסונן): dir=+1 הבא, dir=-1 הקודם */
  function neighbor(id, dir) {
    const idx = filtered.findIndex(e => e.i === id);
    if (idx < 0) return null;
    const j = idx + dir;
    return (j >= 0 && j < filtered.length) ? filtered[j].i : null;
  }

  return { reset, jumpToLetter, scrollToId, neighbor, setCategory };
}

/* רשימת האותיות לפי סדר האלפבית העברי עבור קטגוריה נתונה. */
function lettersFor(cat) {
  const present = new Set(DATA.filter(e => e.cat === cat).map(e => e.l));
  return HEBREW_ALPHABET.filter(letter => present.has(letter));
}

/* גלילה אל ערך לפי מזהה (להפניות פנימיות בתצוגת פאנל/מודאל) */
function entryById(id) { return DATA_BY_ID.get(Number(id)); }

/* ===========================================================================
 *  ערכת נושא (מדמה את צבעי אוצריא; כפתור החלפה רק להדגמה)
 * ========================================================================= */
const THEMES = {
  light: {
    '--c-primary': '#6750A4', '--c-on-primary': '#FFFFFF',
    '--c-surface': '#FFFBFE', '--c-on-surface': '#1C1B1F',
    '--c-surface-2': '#F3EDF7', '--c-outline': '#CAC4D0',
    '--c-primary-subtle': 'rgba(103,80,164,.10)', '--c-error': '#B3261E',
  },
  dark: {
    '--c-primary': '#D0BCFF', '--c-on-primary': '#381E72',
    '--c-surface': '#1C1B1F', '--c-on-surface': '#E6E1E5',
    '--c-surface-2': '#2B2930', '--c-outline': '#49454F',
    '--c-primary-subtle': 'rgba(208,188,255,.14)', '--c-error': '#F2B8B5',
  }
};
function applyTheme(mode) {
  const t = THEMES[mode] || THEMES.light;
  const r = document.documentElement;
  Object.entries(t).forEach(([k, v]) => r.style.setProperty(k, v));
  document.body.classList.toggle('dark', mode === 'dark');
  try { localStorage.setItem('bio-theme', mode); } catch (e) {}
}
function initThemeToggle(btn) {
  let mode = 'light';
  try { mode = localStorage.getItem('bio-theme') || 'light'; } catch (e) {}
  applyTheme(mode);
  if (btn) {
    btn.textContent = mode === 'dark' ? '☀' : '☾';
    btn.addEventListener('click', () => {
      mode = mode === 'dark' ? 'light' : 'dark';
      applyTheme(mode);
      btn.textContent = mode === 'dark' ? '☀' : '☾';
    });
  }
}

/* טיפול בלחיצות על קישורים בתוך גוף ביוגרפיה (delegation) */
function wireBodyLinks(container, onGoto) {
  container.addEventListener('click', ev => {
    const x = ev.target.closest('.xref');
    if (x) { ev.preventDefault(); onGoto(parseInt(x.dataset.goto, 10)); return; }
    const s = ev.target.closest('.src');
    if (s) { ev.preventDefault(); openInOtzaria(decodeURIComponent(s.dataset.src)); }
  });
}
