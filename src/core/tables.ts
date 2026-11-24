/**
 * Détection de tableaux dans un PDF à partir de la position du texte.
 * Étapes : fragments -> lignes -> blocs tabulaires -> colonnes (vides verticaux)
 * -> grille de cellules (fusions, lignes continuées) -> typage des valeurs.
 */

export interface Frag { x: number; x2: number; y: number; size: number; str: string }
export interface Cell { text: string; x: number; x2: number; c0: number; c1: number }
export interface Row { y: number; size: number; cells: Cell[] }
export interface Table {
  page: number;
  rows: string[][];            // texte brut par cellule
  merges: { r: number; c0: number; c1: number }[];
  header: boolean;
  seps: number[];              // positions des séparateurs de colonnes (pt)
  x0: number;
}

export function fragments(content: { items: any[] }): Frag[] {
  const out: Frag[] = [];
  for (const it of content.items) {
    if (!('str' in it) || !String(it.str).trim()) continue;
    const [a, b, c, d, e, f] = it.transform as number[];
    if (Math.abs(b) > 0.2 * Math.abs(a || 1) && Math.abs(c) > 0.2) { /* texte pivoté : traité comme les autres */ }
    const size = Math.hypot(c, d) || it.height || 10;
    const w = it.width ?? it.str.length * size * 0.5;
    out.push({ x: e, x2: e + w, y: f, size, str: String(it.str).replace(/ /g, ' ') });
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
  return { page, rows: trimmed, merges: mm, header, seps, x0: blockRows[0].cells[0].x };
}

/** Rassemble les tableaux qui se poursuivent d'une page à l'autre (même grille de colonnes). */
export function joinAcrossPages(tables: Table[]): Table[] {
  const res: Table[] = [];
  for (const t of tables) {
    const prev = res[res.length - 1];
    const same = prev && t.page === prev.page + 1 && prev.rows[0].length === t.rows[0].length &&
      prev.seps.length === t.seps.length && prev.seps.every((s, i) => Math.abs(s - t.seps[i]) < 10);
    if (!same) { res.push({ ...t, rows: t.rows.map((r) => [...r]), merges: [...t.merges] }); continue; }
    let start = 0;
    if (prev.header && t.rows[0].join('|') === prev.rows[0].join('|')) start = 1; // en-tête répété
    const off = prev.rows.length - start;
    prev.rows.push(...t.rows.slice(start));
    prev.merges.push(...t.merges.filter((m) => m.r >= start).map((m) => ({ ...m, r: m.r + off })));
    prev.page = t.page;
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
