/**
 * Détection de tableaux dans un PDF à partir de la position du texte.
 * Étapes : fragments -> lignes -> blocs tabulaires -> colonnes (vides verticaux)
 * -> grille de cellules (fusions, lignes continuées) -> typage des valeurs.
 */

export interface Frag { x: number; x2: number; y: number; size: number; str: string; font?: string; color?: string }
export interface Cell { text: string; x: number; x2: number; c0: number; c1: number }
export interface Row { y: number; size: number; cells: Cell[] }
export interface Table {
  page: number;
  rows: string[][];            // texte brut par cellule
  merges: { r: number; c0: number; c1: number }[];
  header: boolean;
  seps: number[];              // positions des séparateurs de colonnes (pt)
  x0: number;
  colPts?: number[];           // largeur des colonnes dans le PDF (pt)
  top?: number;
  page0?: number;
  meta?: RowMeta[];
}

export function fragments(content: { items: any[] }): Frag[] {
  const out: Frag[] = [];
  for (const it of content.items) {
    if (!('str' in it) || !String(it.str).trim()) continue;
    const [a, b, c, d, e, f] = it.transform as number[];
    if (Math.abs(b) > 0.2 * Math.abs(a || 1) && Math.abs(c) > 0.2) { /* texte pivoté : traité comme les autres */ }
    const size = Math.hypot(c, d) || it.height || 10;
    const w = it.width ?? it.str.length * size * 0.5;
    out.push({ x: e, x2: e + w, y: f, size, str: String(it.str).replace(/ /g, ' '), font: it.fontName });
  }
  return out;
}

export function toRows(frags: Frag[]): Row[] {
  const sorted = [...frags].sort((a, b) => b.y - a.y || a.x - b.x);
  const groups: { y: number; size: number; items: Frag[] }[] = [];
  for (const f of sorted) {
    const g = groups.find((g) => Math.abs(g.y - f.y) < Math.min(g.size, f.size) * 0.45);
    if (g) { g.items.push(f); g.y = (g.y * (g.items.length - 1) + f.y) / g.items.length; g.size = Math.max(g.size, f.size); }
    else groups.push({ y: f.y, size: f.size, items: [f] });
  }
  groups.sort((a, b) => b.y - a.y);
  return groups.map((g) => {
    g.items.sort((a, b) => a.x - b.x);
    const cells: Cell[] = [];
    for (const it of g.items) {
      const last = cells[cells.length - 1];
      const gap = last ? it.x - last.x2 : Infinity;
      if (last && gap < g.size * 0.65) {
        last.text += (gap > g.size * 0.12 && !/\s$/.test(last.text) && !/^\s/.test(it.str) ? ' ' : '') + it.str;
        last.x2 = Math.max(last.x2, it.x2);
      } else cells.push({ text: it.str, x: it.x, x2: it.x2, c0: 0, c1: 0 });
    }
    cells.forEach((c) => (c.text = c.text.replace(/\s+/g, ' ').trim()));
    return { y: g.y, size: g.size, cells: cells.filter((c) => c.text) };
  }).filter((r) => r.cells.length);
}

const median = (v: number[]) => { const s = [...v].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : 0; };

/** Découpe les lignes d'une page en blocs de lignes consécutives contenant au moins un tableau. */
export function blocks(rows: Row[], minCols = 2): Row[][] {
  const pitches: number[] = [];
  for (let i = 1; i < rows.length; i++) pitches.push(rows[i - 1].y - rows[i].y);
  const pitch = median(pitches) || 14;
  const maxGap = Math.max(pitch * 2.1, (median(rows.map((r) => r.size)) || 10) * 2.4);
  const res: Row[][] = [];
  let cur: Row[] = [];
  const flush = () => {
    // Lignes de fin (total, note) : conservées si proches du tableau, jusqu'à 2 lignes courtes
    let tail = 0;
    while (cur.length && cur[cur.length - 1].cells.length < minCols) {
      const last = cur[cur.length - 1], prev = cur[cur.length - 2];
      const keep = tail < 2 && prev && prev.y - last.y <= pitch * 1.8 && last.cells.reduce((a, c) => a + c.text.length, 0) < 60 && prev.cells.length >= minCols;
      if (keep) break;
      cur.pop();
    }
    while (cur.length && cur[0].cells.length < minCols) cur.shift();
    if (cur.filter((r) => r.cells.length >= minCols).length >= 1) res.push(cur);
    cur = [];
  };
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (cur.length && cur[cur.length - 1].y - r.y > maxGap) flush();
    cur.push(r);
  }
  flush();
  return res;
}

/** Séparateurs de colonnes : bandes verticales libres dans (presque) toutes les lignes tabulaires. */
export function separators(rows: Row[], minCols = 2): number[] {
  const tab = rows.filter((r) => r.cells.length >= minCols);
  if (!tab.length) return [];
  const x0 = Math.floor(Math.min(...tab.map((r) => r.cells[0].x)));
  const x1 = Math.ceil(Math.max(...tab.map((r) => r.cells[r.cells.length - 1].x2)));
  const n = x1 - x0 + 1;
  const cover = new Array<number>(n).fill(0);
  for (const r of tab) {
    for (const c of r.cells) for (let x = Math.max(0, Math.floor(c.x - x0)); x <= Math.min(n - 1, Math.ceil(c.x2 - x0)); x++) cover[x]++;
  }
  const tol = tab.length >= 8 ? Math.floor(tab.length * 0.1) : 0;
  const size = median(tab.map((r) => r.size)) || 10;
  const gapMin = Math.max(3, size * 0.45);
  const seps: number[] = [];
  let start = -1;
  for (let i = 0; i <= n; i++) {
    const free = i < n && cover[i] <= tol;
    if (free && start < 0) start = i;
    if (!free && start >= 0) {
      if (start > 0 && i < n && i - start >= gapMin) seps.push(x0 + (start + i) / 2);
      start = -1;
    }
  }
  return seps;
}

const colOf = (seps: number[], x: number) => { let c = 0; while (c < seps.length && seps[c] < x) c++; return c; };

export const isNumLike = (s: string) => /^[\s(+\-−–]*[\d][\d\s.,'’]*[)\s%€$£]*$/.test(s) || /^[\s(+\-−–]*[€$£]\s*[\d][\d\s.,]*\)?$/.test(s);

/** Construit un tableau (grille) à partir d'un bloc de lignes. */
export function buildTable(blockRows: Row[], page: number, minCols = 2): Table | null {
  const seps = separators(blockRows, minCols);
  const ncols = seps.length + 1;
  if (ncols < 2) return null;
  const grid: { y: number; size: number; cells: (string | null)[] }[] = [];
  const merges: { r: number; c0: number; c1: number }[] = [];
  for (const row of blockRows) {
    const cells: (string | null)[] = new Array(ncols).fill(null);
    const spans: { c0: number; c1: number }[] = [];
    for (const c of row.cells) {
      const c0 = colOf(seps, c.x + 0.5);
      const c1 = Math.max(c0, colOf(seps, c.x2 - 0.5));
      cells[c0] = cells[c0] ? cells[c0] + ' ' + c.text : c.text;
      if (c1 > c0) spans.push({ c0, c1 });
    }
    grid.push({ y: row.y, size: row.size, cells });
    const ri = grid.length - 1;
    for (const s of spans) merges.push({ r: ri, c0: s.c0, c1: s.c1 });
  }
  // Lignes continuées : texte qui passe à la ligne dans une cellule (cellules numériques vides sur la ligne)
  const out: { cells: (string | null)[]; y: number }[] = [];
  const mapIdx: number[] = [];
  for (let i = 0; i < grid.length; i++) {
    const g = grid[i];
    const prev = out[out.length - 1];
    const filled = g.cells.map((v, c) => (v ? c : -1)).filter((c) => c >= 0);
    let cont = false;
    if (prev && i > 0) {
      const prevFilled = prev.cells.filter(Boolean).length;
      const tight = grid[i - 1].y - g.y <= g.size * 1.5;
      const textOnly = filled.every((c) => !isNumLike(g.cells[c]!) && !!prev.cells[c] && !isNumLike(prev.cells[c]!));
      cont = tight && filled.length > 0 && filled.length < prevFilled && textOnly && !merges.some((m) => m.r === i);
    }
    if (cont) {
      for (const c of filled) prev.cells[c] = prev.cells[c] + '\n' + g.cells[c];
      mapIdx.push(-1);
    } else { out.push({ cells: [...g.cells], y: g.y }); mapIdx.push(out.length - 1); }
  }
  const remapped = merges.filter((m) => mapIdx[m.r] >= 0).map((m) => ({ ...m, r: mapIdx[m.r] }));
  const rows = out.map((r) => r.cells.map((v) => v ?? ''));
  // Colonnes totalement vides : supprimées
  const keep = Array.from({ length: ncols }, (_, c) => rows.some((r) => r[c] !== ''));
  const remap: number[] = []; let k = 0;
  keep.forEach((v, c) => remap.push(v ? k++ : Math.max(0, k - 1)));
  const trimmed = rows.map((r) => r.filter((_, c) => keep[c]));
  if (trimmed.length < 1 || (trimmed[0]?.length ?? 0) < 2) return null;
  const mm = remapped.map((m) => ({ r: m.r, c0: remap[m.c0], c1: remap[m.c1] })).filter((m) => m.c1 > m.c0);
  const first = trimmed[0];
  const header = trimmed.length > 1 && first.filter(Boolean).length >= 2 && first.every((v) => !v || !isNumLike(v)) &&
    trimmed.slice(1).some((r) => r.some((v) => v && isNumLike(v)));
  return { page, rows: trimmed, merges: mm, header, seps, x0: blockRows[0].cells[0].x, top: blockRows[0].y };
}

function mergeMeta(last: RowMeta, g: RowMeta) {
  g.cells.forEach((c, i) => {
    const l = last.cells[i]; if (!l || !c.runs.length) return;
    if (l.runs.length) { l.runs[l.runs.length - 1] = { ...l.runs[l.runs.length - 1], t: l.runs[l.runs.length - 1].t + '\n' }; l.runs.push(...c.runs.map((r) => ({ ...r }))); }
    else { l.runs = c.runs.map((r) => ({ ...r })); l.ah = c.ah; l.av = c.av; }
  });
  last.h = last.h !== undefined && g.h !== undefined ? last.h + g.h : undefined;
}

/** Rassemble les tableaux qui se poursuivent d'une page à l'autre (même grille de colonnes). */
export function joinAcrossPages(tables: Table[]): Table[] {
  const res: Table[] = [];
  const copy = (t: Table): Table => ({ ...t, page0: t.page, rows: t.rows.map((r) => [...r]), merges: [...t.merges], meta: t.meta?.map((m) => ({ ...m, cells: m.cells.map((c) => ({ ...c, runs: c.runs.map((r) => ({ ...r })) })) })) });
  for (const t of tables) {
    const prev = res[res.length - 1];
    const same = prev && t.page === prev.page + 1 && prev.rows[0].length === t.rows[0].length &&
      prev.seps.length === t.seps.length && prev.seps.every((s, i) => Math.abs(s - t.seps[i]) < 10);
    if (!same) { res.push(copy(t)); continue; }
    const tt = copy(t);
    let start = 0;
    if (prev.header && tt.rows[0].join('|') === prev.rows[0].join('|')) start = 1; // en-tête répété
    // ligne de section répétée en haut de page (ex. « A  TERRASSEMENTS »), suivie parfois de la fin de l'article précédent
    const f = tt.rows[start];
    if (f && /^[A-Za-z0-9]{1,3}$/.test(f[0])) {
      const title = (f[1] ?? '').split('\n')[0];
      const sec = prev.rows.find((r) => r[0] === f[0] && (r[1] ?? '').split('\n')[0] === title);
      if (sec) {
        const rest = f.map((v, c) => (c === 1 ? v.split('\n').slice(1).join('\n') : c === 0 ? '' : v));
        const restMeta = tt.meta?.[start];
        start++;
        const last0 = prev.rows[prev.rows.length - 1];
        if (rest.some(Boolean) && last0) {
          rest.forEach((v, c) => { if (v) last0[c] = last0[c] ? last0[c] + '\n' + v : v; });
          // styles : on retire la première ligne (titre de section répété) des séries de la colonne 1
          if (restMeta && prev.meta) {
            const c1 = restMeta.cells[1]; if (c1) { let skip = true; c1.runs = c1.runs.map((r) => { if (skip && r.t.includes('\n')) { skip = false; return { ...r, t: r.t.slice(r.t.indexOf('\n') + 1) }; } return skip ? { ...r, t: '' } : r; }).filter((r) => r.t); }
            restMeta.cells[0].runs = [];
            mergeMeta(prev.meta[prev.meta.length - 1], restMeta);
          }
        }
      }
    }
    // ligne sans numéro : suite de l'article coupé par le saut de page
    const g = tt.rows[start], last = prev.rows[prev.rows.length - 1];
    if (g && !g[0] && last && last[0]) {
      g.forEach((v, c) => { if (v) last[c] = last[c] ? last[c] + '\n' + v : v; });
      if (prev.meta && tt.meta?.[start]) mergeMeta(prev.meta[prev.meta.length - 1], tt.meta[start]);
      start++;
    }
    const off = prev.rows.length - start;
    prev.rows.push(...tt.rows.slice(start));
    if (prev.meta && tt.meta) prev.meta.push(...tt.meta.slice(start));
    prev.merges.push(...tt.merges.filter((m) => m.r >= start).map((m) => ({ ...m, r: m.r + off })));
    prev.page = tt.page;
  }
  return res;
}

// ------------------------------------------------------------------ valeurs
export type Value =
  | { t: 's'; s: string }
  | { t: 'n'; v: number; fmt?: string }
  | { t: 'd'; v: number };

export const excelSerial = (y: number, m: number, d: number) => Math.round(Date.UTC(y, m - 1, d) / 86400000) + 25569;

export function detectDecimal(texts: string[]): ',' | '.' {
  let fr = 0, en = 0;
  for (const s of texts) {
    if (/\d,\d{1,2}(?!\d)/.test(s) && !/\d,\d{3}/.test(s)) fr++;
    if (/\d\.\d{1,2}(?!\d)/.test(s) && !/\d\.\d{3}/.test(s) && !/\d\.\d{1,2}\.\d/.test(s)) en++;
  }
  return en > fr ? '.' : ',';
}

export function parseValue(raw: string, dec: ',' | '.', convert = true): Value {
  const s0 = raw.replace(/[  ]/g, ' ').trim();
  if (!convert || !s0) return { t: 's', s: s0 };
  let m = s0.match(/^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{4})$/);
  if (m) { const [d, mo, y] = [+m[1], +m[2], +m[3]]; if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31) return { t: 'd', v: excelSerial(y, mo, d) }; }
  m = s0.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m && +m[2] >= 1 && +m[2] <= 12 && +m[3] >= 1 && +m[3] <= 31) return { t: 'd', v: excelSerial(+m[1], +m[2], +m[3]) };

  let s = s0.replace(/[−–]/g, '-');
  let neg = false, pct = false, cur = '';
  if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1).trim(); }
  const cm = s.match(/^([€$£])\s*|\s*([€$£]|EUR|USD)$/);
  if (cm) { cur = (cm[1] || cm[2]) === 'EUR' ? '€' : (cm[1] || cm[2]) === 'USD' ? '$' : (cm[1] || cm[2]); s = s.replace(cm[0], '').trim(); }
  if (/%$/.test(s)) { pct = true; s = s.slice(0, -1).trim(); }
  if (s.startsWith('-')) { s = s.slice(1).trim(); neg = true; }
  else if (s.startsWith('+')) s = s.slice(1).trim();
  if (!/^\d[\d ',.’]*$/.test(s)) return { t: 's', s: s0 };
  const thou = dec === ',' ? /[ .’']/ : /[ ,’']/;
  const decCh = dec;
  const parts = s.split(decCh);
  if (parts.length > 2) return { t: 's', s: s0 };
  const intPart = parts[0];
  const frac = parts[1] ?? '';
  if (/[^\d]/.test(frac)) return { t: 's', s: s0 };
  if (/[ .,’']/.test(intPart)) {
    // séparateurs de milliers : groupes de 3 chiffres obligatoires
    const g = intPart.split(thou);
    if (g.length < 2 || !/^\d{1,3}$/.test(g[0]) || !g.slice(1).every((x) => /^\d{3}$/.test(x))) return { t: 's', s: s0 };
  }
  const digits = intPart.replace(/\D/g, '');
  if (!digits) return { t: 's', s: s0 };
  const hasSep = /[ .,’']/.test(intPart);
  if (!hasSep && !frac && !cur && !pct && digits.length > 1 && digits.startsWith('0')) return { t: 's', s: s0 }; // codes : 0012, 06...
  if (digits.length + frac.length > 15) return { t: 's', s: s0 };
  let v = parseFloat(digits + (frac ? '.' + frac : ''));
  if (neg) v = -v;
  const zeros = frac.length ? '.' + '0'.repeat(frac.length) : '';
  let fmt = (hasSep ? '#,##0' : '0') + zeros;
  if (pct) { v /= 100; fmt = '0' + zeros + '%'; }
  if (cur) fmt = `${hasSep || frac ? '#,##0' + (zeros || '.00') : '0'}\\ "${cur}"`;
  return { t: 'n', v, fmt };
}

// ------------------------------------------------------------------ traits dessinés
export interface VLine { x: number; y0: number; y1: number; w?: number; color?: string }
export interface HLine { y: number; x0: number; x1: number; w?: number; color?: string }
export interface Fill { x0: number; y0: number; x1: number; y1: number; color: string; z: number }
export interface Anchor { x: number; y: number; color: string }
export interface ImgBox { x: number; y: number; w: number; h: number; name: string }
export interface Rules { v: VLine[]; h: HLine[]; marks: { x: number; x2: number; y: number; color: string }[]; fills: Fill[]; anchors: Anchor[]; images: ImgBox[] }

type M = [number, number, number, number, number, number];
const mul = (a: M, b: M): M => [
  a[0] * b[0] + a[2] * b[1], a[1] * b[0] + a[3] * b[1],
  a[0] * b[2] + a[2] * b[3], a[1] * b[2] + a[3] * b[3],
  a[0] * b[4] + a[2] * b[5] + a[4], a[1] * b[4] + a[3] * b[5] + a[5]];
const pt = (m: M, x: number, y: number): [number, number] => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
const hex2 = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
const colorOf = (a: any[]): string | null => {
  if (typeof a?.[0] === 'string' && /^#[0-9a-f]{6}$/i.test(a[0])) return a[0].toLowerCase();
  if (a?.length >= 3 && a.slice(0, 3).every((v: any) => typeof v === 'number')) { const k = a.every((v: number) => v <= 1) ? 255 : 1; return '#' + a.slice(0, 3).map((v: number) => hex2(v * k)).join(''); }
  return null;
};

/** Lit les traits, rectangles colorés, puces/images et couleurs de texte dessinés sur la page. */
export async function pageRules(page: any, OPS: Record<string, number>): Promise<Rules> {
  const ol = await page.getOperatorList();
  const out: Rules = { v: [], h: [], marks: [], fills: [], anchors: [], images: [] };
  let ctm: M = [1, 0, 0, 1, 0, 0], tm: M = [1, 0, 0, 1, 0, 0], tlm: M = [1, 0, 0, 1, 0, 0];
  let fill = '#000000', stroke = '#000000', leading = 0, z = 0;
  const stack: { ctm: M; fill: string; stroke: string }[] = [];
  const FILL = new Set([OPS.fill, OPS.eoFill, OPS.fillStroke, OPS.eoFillStroke, OPS.closeFillStroke, OPS.closeEOFillStroke]);
  const STROKE = new Set([OPS.stroke, OPS.closeStroke, OPS.fillStroke, OPS.eoFillStroke, OPS.closeFillStroke, OPS.closeEOFillStroke]);
  let lineW = 1;
  const addSeg = (x0: number, y0: number, x1: number, y1: number, w: number, color: string) => {
    if (Math.abs(x1 - x0) < 0.6 && Math.abs(y1 - y0) >= 6) out.v.push({ x: (x0 + x1) / 2, y0: Math.min(y0, y1), y1: Math.max(y0, y1), w, color });
    else if (Math.abs(y1 - y0) < 0.6 && Math.abs(x1 - x0) >= 6) out.h.push({ y: (y0 + y1) / 2, x0: Math.min(x0, x1), x1: Math.max(x0, x1), w, color });
  };
  const showAnchor = () => { const [x, y] = pt(ctm, tm[4], tm[5]); out.anchors.push({ x, y, color: fill }); };
  const moveTo = (tx: number, ty: number) => { tlm = [tlm[0], tlm[1], tlm[2], tlm[3], tlm[0] * tx + tlm[2] * ty + tlm[4], tlm[1] * tx + tlm[3] * ty + tlm[5]]; tm = [...tlm] as M; };
  for (let i = 0; i < ol.fnArray.length; i++) {
    const fn = ol.fnArray[i], a = ol.argsArray[i];
    if (fn === OPS.save) stack.push({ ctm: [...ctm] as M, fill, stroke });
    else if (fn === OPS.restore) { const g = stack.pop(); if (g) { ctm = g.ctm; fill = g.fill; stroke = g.stroke; } }
    else if (fn === OPS.transform) ctm = mul(ctm, a as M);
    else if (fn === OPS.setLineWidth) lineW = a[0];
    else if (fn === OPS.setFillRGBColor) fill = colorOf(a) ?? fill;
    else if (fn === OPS.setStrokeRGBColor) stroke = colorOf(a) ?? stroke;
    else if (fn === OPS.beginText) { tm = [1, 0, 0, 1, 0, 0]; tlm = [...tm] as M; }
    else if (fn === OPS.setTextMatrix) { const mm = (a.length === 1 && typeof a[0] === 'object' ? Array.from(a[0] as ArrayLike<number>) : Array.from(a as ArrayLike<number>)) as M; tm = [...mm] as M; tlm = [...mm] as M; }
    else if (fn === OPS.moveText) moveTo(a[0], a[1]);
    else if (fn === OPS.setLeadingMoveText) { leading = -a[1]; moveTo(a[0], a[1]); }
    else if (fn === OPS.setLeading) leading = a[0];
    else if (fn === OPS.nextLine) moveTo(0, -leading);
    else if (fn === OPS.showText || fn === OPS.showSpacedText) showAnchor();
    else if (fn === OPS.nextLineShowText || fn === OPS.nextLineSetSpacingShowText) { moveTo(0, -leading); showAnchor(); }
    else if (fn === OPS.paintImageXObject || fn === OPS.paintImageMaskXObject || fn === OPS.paintInlineImageXObject) {
      const w = Math.hypot(ctm[0], ctm[1]), hh = Math.hypot(ctm[2], ctm[3]);
      if (w >= 1.5 && w <= 14 && hh >= 1.5 && hh <= 14) out.marks.push({ x: ctm[4], x2: ctm[4] + w, y: ctm[5] + hh / 2, color: fn === OPS.paintImageMaskXObject ? fill : '#13ae95' });
      else if (w > 14 || hh > 14) out.images.push({ x: Math.min(ctm[4], ctm[4] + ctm[2]), y: Math.min(ctm[5], ctm[5] + ctm[3]), w, h: hh, name: String(a?.[0] ?? '') });
    } else if (fn === OPS.constructPath) {
      const paint = a[0] as number; const d = a[1] as any;
      const data: number[] = Array.isArray(d) && d.length && typeof d[0] !== 'number' ? Array.from(d[0]) : Array.from(d);
      const subs: [number, number][][] = []; let cur: [number, number][] = [];
      for (let k = 0; k < data.length;) {
        const op = data[k];
        if (op === 0) { if (cur.length) subs.push(cur); cur = [[data[k + 1], data[k + 2]]]; k += 3; }
        else if (op === 1) { cur.push([data[k + 1], data[k + 2]]); k += 3; }
        else if (op === 2) { cur.push([data[k + 5], data[k + 6]]); k += 7; }
        else k += 1;
      }
      if (cur.length) subs.push(cur);
      const isFill = FILL.has(paint), isStroke = STROKE.has(paint);
      if (!isFill && !isStroke) continue;
      const sc = Math.hypot(ctm[0], ctm[1]);
      for (const sp of subs) {
        const p = sp.map(([x, y]) => pt(ctm, x, y));
        if (p.length === 2 && isStroke) addSeg(p[0][0], p[0][1], p[1][0], p[1][1], lineW * sc, stroke);
        else if (p.length >= 4 && p.length <= 5) {
          const xs = p.map((q) => q[0]), ys = p.map((q) => q[1]);
          const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
          const axis = p.every((q) => xs.some((x) => Math.abs(x - q[0]) < 0.01) && ys.some((y) => Math.abs(y - q[1]) < 0.01));
          if (!axis) continue;
          const w = x1 - x0, hgt = y1 - y0;
          if (isFill && w <= 2.5 && hgt >= 6) out.v.push({ x: (x0 + x1) / 2, y0, y1, w, color: fill });
          else if (isFill && hgt <= 2.5 && w >= 6) out.h.push({ y: (y0 + y1) / 2, x0, x1, w: hgt, color: fill });
          else if (isFill && w > 2.5 && hgt > 2.5 && fill !== '#ffffff') out.fills.push({ x0, y0, x1, y1, color: fill, z: z++ });
          else if (isStroke) { addSeg(x0, y0, x0, y1, lineW * sc, stroke); addSeg(x1, y0, x1, y1, lineW * sc, stroke); addSeg(x0, y0, x1, y0, lineW * sc, stroke); addSeg(x0, y1, x1, y1, lineW * sc, stroke); }
        }
      }
    }
  }
  return out;
}

// ------------------------------------------------------------------ tableaux à bordures
const clean = (s: string) => s.replace(/[\uE000-\uF8FF\u27A4\u25BA\u25B6\u25CF\u25AA]/g, '•').replace(/\s+/g, ' ').trim();

function cluster(vals: number[], tol: number): number[] {
  const s = [...vals].sort((a, b) => a - b); const out: number[][] = [];
  for (const v of s) { const g = out[out.length - 1]; if (g && v - g[g.length - 1] <= tol) g.push(v); else out.push([v]); }
  return out.map((g) => g.reduce((a, b) => a + b, 0) / g.length);
}

interface Line { y: number; x: number; x2: number; items: Frag[]; size: number; bul?: boolean }
const isBul = (f: Frag) => f.str === '•' || f.str === '❯';

function buildLines(fr: Frag[]): { lines: Line[]; texts: string[] } {
  const lines: Line[] = [];
  for (const f of [...fr].sort((a, b) => b.y - a.y || a.x - b.x)) {
    const l = lines.find((l) => Math.abs(l.y - f.y) < Math.min(l.size, f.size) * 0.45);
    const bul = isBul(f);
    if (l) { l.items.push(f); if (!bul) { l.x = l.bul ? f.x : Math.min(l.x, f.x); l.x2 = Math.max(l.x2, f.x2); l.bul = false; } }
    else lines.push({ y: f.y, x: f.x, x2: f.x2, items: [f], size: f.size, bul });
  }
  lines.sort((a, b) => b.y - a.y);
  const texts = lines.map((l) => {
    l.items.sort((a, b) => a.x - b.x);
    let t = '', end = -Infinity;
    for (const it of l.items) { t += (t && it.x - end > it.size * 0.12 && !/\s$/.test(t) && !/^\s/.test(it.str) ? ' ' : '') + it.str; end = Math.max(end, it.x2); }
    return clean(t);
  });
  return { lines, texts };
}

/** Texte d'une cellule : lignes reconstituées, retour à la ligne seulement en fin de paragraphe. */
function cellText(fr: Frag[], left: number, right: number): string {
  if (!fr.length) return '';
  const { lines, texts } = buildLines(fr);
  const w = Math.max(1, right - left);
  const pitches = lines.slice(1).map((l, i) => lines[i].y - l.y);
  const m = pitches.length >= 3 ? median(pitches) : 0;
  const fontOf = (i: number) => lines[i].items[0]?.font;
  let out = '';
  lines.forEach((l, i) => {
    if (!texts[i]) return;
    if (!out) { out = texts[i]; return; }
    const p = lines[i - 1];
    const gap = p.y - l.y;
    const brk = p.x2 < right - Math.max(8, w * 0.1) || Math.abs(l.x - p.x) > 4 || /^[•❯]/.test(texts[i]) ||
      gap > (m ? m * 1.18 + 0.5 : l.size * 1.45) || (!!fontOf(i) && !!fontOf(i - 1) && fontOf(i) !== fontOf(i - 1));
    out += (brk ? '\n' : /[a-zà-ÿ]-$/i.test(out) && /^[a-zà-ÿ]/.test(texts[i]) ? '' : ' ') + texts[i];
  });
  return out.replace(/❯/g, '•');
}

export interface Run { t: string; font: string; size: number; b: boolean; i: boolean; color: string }
export interface Border { style: 'thin' | 'medium' | 'thick'; color: string }
export interface CellMeta { runs: Run[]; fill?: string; l?: Border; r?: Border; t?: Border; b?: Border; ah: 'left' | 'center' | 'right'; av: 'top' | 'center' | 'bottom' }
export interface RowMeta { cells: CellMeta[]; h?: number }
export type FontLookup = (id: string | undefined) => { family: string; bold: boolean; italic: boolean } | undefined;

/** Cellule fidèle au PDF : un retour à la ligne par ligne du PDF, une série de styles (police, taille, couleur). */
function cellRuns(fr: Frag[], fontOf: FontLookup, colorAt: (f: Frag) => string): { runs: Run[]; x0: number; x1: number; y0: number; y1: number } | null {
  if (!fr.length) return null;
  const { lines, texts } = buildLines(fr);
  const runs: Run[] = [];
  const push = (t: string, f: Frag) => {
    const fi = fontOf(f.font);
    const size = Math.round(f.size * 2) / 2;
    const r: Run = { t, font: fi?.family ?? 'Arial', size, b: !!fi?.bold, i: !!fi?.italic, color: f.color ?? colorAt(f) };
    const last = runs[runs.length - 1];
    if (last && last.font === r.font && last.size === r.size && last.b === r.b && last.i === r.i && last.color === r.color) last.t += t; else runs.push(r);
  };
  lines.forEach((l, i) => {
    if (!texts[i]) return;
    if (runs.length) runs[runs.length - 1].t += '\n';
    let end = -Infinity, started = false;
    for (const it of l.items) {
      const txt = it.str.replace(/[\uE000-\uF8FF\u27A4\u25BA\u25B6\u25CF\u25AA]/g, '•').replace(/\s+/g, ' ');
      if (!txt.trim()) continue;
      const sep = started && it.x - end > it.size * 0.12 && !/\s$/.test(runs[runs.length - 1]?.t ?? '') && !/^\s/.test(txt) ? ' ' : '';
      push(sep + (started ? txt : txt.replace(/^\s+/, '')), it);
      end = Math.max(end, it.x2); started = true;
    }
  });
  const last = runs[runs.length - 1]; if (last) last.t = last.t.replace(/\s+$/, '');
  if (!runs.length) return null;
  return { runs, x0: Math.min(...fr.map((f) => f.x)), x1: Math.max(...fr.map((f) => f.x2)), y0: Math.min(...fr.map((f) => f.y - f.size * 0.22)), y1: Math.max(...fr.map((f) => f.y + f.size * 0.8)) };
}

export interface RuledResult { tables: Table[]; used: Set<Frag> }

/** Reconstruit les tableaux délimités par des traits verticaux (colonnes) et horizontaux (lignes). */
export function ruledTables(frags0: Frag[], rules: Rules, page: number, fontOf: FontLookup = () => undefined): RuledResult {
  const used = new Set<Frag>();
  const sz = median(frags0.map((f) => f.size)) || 10;
  const bullets: Frag[] = rules.marks.map((m) => ({ x: m.x, x2: m.x2, y: m.y - sz * 0.3, size: sz, str: '❯', font: '#bullet', color: m.color }));
  const frags = [...frags0, ...bullets];
  // 1. régions : traits verticaux regroupés par recouvrement vertical
  const segs = [...rules.v].sort((a, b) => a.y0 - b.y0);
  const comps: { segs: VLine[]; y0: number; y1: number }[] = [];
  for (const s of segs) {
    const c = comps.find((c) => s.y0 <= c.y1 + 5 && s.y1 >= c.y0 - 5);
    if (c) { c.segs.push(s); c.y0 = Math.min(c.y0, s.y0); c.y1 = Math.max(c.y1, s.y1); } else comps.push({ segs: [s], y0: s.y0, y1: s.y1 });
  }
  // fusion des composantes qui se rejoignent après agrandissement
  for (let again = true; again;) {
    again = false;
    for (let i = 0; i < comps.length && !again; i++) for (let j = i + 1; j < comps.length; j++) {
      if (comps[j].y0 <= comps[i].y1 + 5 && comps[j].y1 >= comps[i].y0 - 5) {
        comps[i].segs.push(...comps[j].segs); comps[i].y0 = Math.min(comps[i].y0, comps[j].y0); comps[i].y1 = Math.max(comps[i].y1, comps[j].y1); comps.splice(j, 1); again = true; break;
      }
    }
  }
  const tables: Table[] = [];
  for (const comp of comps) {
    const edges = cluster(comp.segs.map((s) => s.x), 2.5).filter((x) => comp.segs.filter((s) => Math.abs(s.x - x) <= 2.5).reduce((a, s) => a + s.y1 - s.y0, 0) >= 14);
    // bordures extérieures non tracées en vertical : on prolonge jusqu'aux traits horizontaux
    const near = rules.h.filter((h) => h.y >= comp.y0 - 2 && h.y <= comp.y1 + 2);
    if (edges.length) {
      const l0 = Math.min(...near.filter((h) => h.x1 > edges[0] - 1 && h.x0 < edges[0] - 6).map((h) => h.x0), Infinity);
      const r0 = Math.max(...near.filter((h) => h.x0 < edges[edges.length - 1] + 1 && h.x1 > edges[edges.length - 1] + 6).map((h) => h.x1), -Infinity);
      if (isFinite(l0)) edges.unshift(l0);
      if (isFinite(r0)) edges.push(r0);
    }
    if (edges.length < 3 || comp.y1 - comp.y0 < 12) continue;
    const left = edges[0], right = edges[edges.length - 1], ncols = edges.length - 1;
    const { y0, y1 } = comp;
    // 2. coupes horizontales
    const hs = rules.h.filter((h) => h.y >= y0 - 2 && h.y <= y1 + 2 && h.x1 > left && h.x0 < right);
    const ys = cluster(hs.map((h) => h.y), 2);
    const cuts = ys.filter((y) => {
      const cov = hs.filter((h) => Math.abs(h.y - y) <= 2).map((h) => [Math.max(h.x0, left), Math.min(h.x1, right)] as [number, number]).sort((a, b) => a[0] - b[0]);
      let len = 0, cur = -Infinity; for (const [a, b] of cov) { const s = Math.max(a, cur); if (b > s) len += b - s; cur = Math.max(cur, b); }
      return len >= (right - left) * 0.5;
    }).sort((a, b) => b - a);
    const inside = frags.filter((f) => f.x2 > left - 1 && f.x < right + 1 && f.y + f.size * 0.3 >= y0 - 1 && f.y <= y1 + 1);
    if (!inside.length) continue;
    // bandes
    let bands: [number, number][] = [];
    let kind: 'id' | 'cuts' | 'lines' = 'lines';
    const colAt = (x: number) => { for (let c = 0; c < ncols; c++) if (x < edges[c + 1] - 0.5) return Math.max(0, c); return ncols - 1; };
    // Colonne d'identifiants (N° d'article) : chaque identifiant ouvre un enregistrement multi-lignes
    const idRe = /^[A-Za-z]{0,3}[\dIVX]*(\.\d+)*\.?$/;
    const anchors = toRows(inside.filter((f) => colAt(f.x + 1) === 0).map((f) => ({ ...f })));
    const idLike = anchors.filter((a) => a.cells.length === 1 && a.cells[0].text.length <= 10 && idRe.test(a.cells[0].text)).length;
    const idMode = anchors.length >= 3 && idLike >= anchors.length * 0.7;
    if (idMode) {
      const cutAt = anchors.map((a) => a.y + a.size * 0.85);
      kind = 'id';
      bands = anchors.map((_, i) => [i === 0 ? Infinity : cutAt[i], i === anchors.length - 1 ? -Infinity : cutAt[i + 1]] as [number, number]);
    } else {
      const top = Math.max(y1, ...cuts), bot = Math.min(y0, ...cuts);
      const all = [top, ...cuts.filter((c) => c < top - 1 && c > bot + 1), bot];
      for (let i = 0; i + 1 < all.length; i++) if (all[i] - all[i + 1] > 3) bands.push([all[i], all[i + 1]]);
      if (bands.length >= 2) kind = 'cuts';
      if (bands.length < 2) bands = toRows(inside.map((f) => ({ ...f }))).map((r) => [r.y + r.size, r.y - r.size * 0.35] as [number, number]);
    }
    const colRanges = Array.from({ length: ncols }, (_, c) => [edges[c], edges[c + 1]] as [number, number]);
    const rows: string[][] = []; const merges: Table['merges'] = []; const meta: RowMeta[] = [];
    const cutList = [...cuts, y1, y0].sort((a, b) => a - b);
    const colorAt = (f: Frag) => { let best: Anchor | undefined; for (const a of rules.anchors) if (Math.abs(a.y - f.y) < 1.5 && a.x <= f.x + 1.5 && (!best || a.x > best.x)) best = a; return best?.color ?? '#000000'; };
    const bst = (w = 1): Border['style'] => (w <= 1.1 ? 'thin' : w <= 2.2 ? 'medium' : 'thick');
    const vb = (x: number, lo: number, hi: number): Border | undefined => {
      let best: VLine | undefined, bl = 0;
      for (const l of rules.v) { if (Math.abs(l.x - x) > 2.2) continue; const ov = Math.min(hi, l.y1) - Math.max(lo, l.y0); if (ov > bl) { bl = ov; best = l; } }
      return best && bl >= (hi - lo) * 0.4 ? { style: bst(best.w), color: best.color ?? '#000000' } : undefined;
    };
    const hb = (y: number, lo: number, hi: number): Border | undefined => {
      let best: HLine | undefined, bl = 0;
      for (const l of rules.h) { if (Math.abs(l.y - y) > 2.5) continue; const ov = Math.min(hi, l.x1) - Math.max(lo, l.x0); if (ov > bl) { bl = ov; best = l; } }
      return best && bl >= (hi - lo) * 0.4 ? { style: bst(best.w), color: best.color ?? '#000000' } : undefined;
    };
    for (const [bt, bb] of bands) {
      const inBand = inside.filter((f) => { const cy = f.y + f.size * 0.3; return cy <= bt + 0.5 && cy > bb - 0.5; });
      const perCol: Frag[][] = Array.from({ length: ncols }, () => []);
      let span: { c0: number; c1: number } | null = null;
      for (const f of inBand) {
        const c = colAt(f.x + 1); perCol[c].push(f); used.add(f);
        const c1 = colAt(f.x2 - 1); if (c1 > c) span = { c0: c, c1 };
      }
      const cells = perCol.map((fr, c) => cellText(fr, colRanges[c][0], colRanges[c][1]));
      if (cells.every((t) => !t)) continue;
      rows.push(cells);
      if (span && cells.slice(span.c0 + 1, span.c1 + 1).every((t) => !t)) merges.push({ r: rows.length - 1, c0: span.c0, c1: span.c1 });
      // géométrie de la ligne : limites haute et basse de la cellule dans le PDF
      const hi = Math.max(...inBand.map((f) => f.y + f.size * 0.8)), lo = Math.min(...inBand.map((f) => f.y - f.size * 0.22));
      let rt: number | undefined, rb: number | undefined;
      if (kind === 'cuts') { rt = bt; rb = bb; }
      else if (kind === 'id') {
        rt = cutList.find((c) => c >= hi - 0.5 && c <= hi + 14);
        rb = [...cutList].reverse().find((c) => c <= lo + 0.5 && c >= lo - 14);
      }
      const known = rt !== undefined && rb !== undefined && rt - rb > 2;
      const T = known ? rt! : hi + 3, B = known ? rb! : lo - 3;
      meta.push({
        h: known ? T - B : undefined,
        cells: perCol.map((fr, c) => {
          const [cx0, cx1] = colRanges[c];
          const st = cellRuns(fr, fontOf, colorAt);
          const mid = (T + B) / 2, cxm = (cx0 + cx1) / 2;
          const fl = rules.fills.filter((f) => cxm >= f.x0 && cxm <= f.x1 && mid >= f.y0 && mid <= f.y1).sort((a, b) => b.z - a.z)[0];
          let ah: CellMeta['ah'] = 'left', av: CellMeta['av'] = 'top';
          if (st) {
            const lg = st.x0 - cx0, rg = cx1 - st.x1;
            const ln = new Map<number, { a: number; b: number }>();
            for (const f of fr) { const k = Math.round(f.y); const e = ln.get(k); if (e) { e.a = Math.min(e.a, f.x); e.b = Math.max(e.b, f.x2); } else ln.set(k, { a: f.x, b: f.x2 }); }
            const L = [...ln.values()];
            const spread = (v: number[]) => Math.max(...v) - Math.min(...v);
            if (L.length > 1) {
              const sl = spread(L.map((e) => e.a)), sr = spread(L.map((e) => e.b));
              const sc = spread(L.map((e) => (e.a + e.b) / 2));
              ah = sl <= 2 ? 'left' : sr <= 2 && sl > 6 ? 'right' : sc <= 3 ? 'center' : 'left';
            } else ah = Math.abs(lg - rg) <= 3 && lg > 4 ? 'center' : lg <= rg ? 'left' : 'right';
            const tg = T - st.y1, bg = st.y0 - B;
            av = Math.abs(tg - bg) <= 3 ? 'center' : tg <= bg ? 'top' : 'bottom';
          }
          return { runs: st?.runs ?? [], fill: fl?.color, l: vb(edges[c], B, T), r: vb(edges[c + 1], B, T), t: known ? hb(T, cx0, cx1) : undefined, b: known ? hb(B, cx0, cx1) : undefined, ah, av };
        }),
      });
    }
    if (!rows.length) continue;
    const finalRows = rows, finalMerges = merges;
    const first = finalRows[0];
    const header = finalRows.length > 1 && first.filter(Boolean).length >= 2 && first.every((v) => !v || !isNumLike(v)) &&
      finalRows.slice(1).some((r) => r.some((v) => v && isNumLike(v)));
    tables.push({ page, rows: finalRows, merges: finalMerges, header, seps: edges.slice(1, -1), x0: left, colPts: colRanges.map(([a, b]) => b - a), top: y1, meta });
  }
  return { tables, used };
}
