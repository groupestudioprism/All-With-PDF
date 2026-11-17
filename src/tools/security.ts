import { PDFDocument } from 'pdf-lib';
import { PDF_MIME, type Tool } from '../core/types';
import { baseName, readBytes } from '../core/util';
import { canvasToBlob, getPdfjs, openPdf, pageLines, renderPageToCanvas } from '../core/pdfjs';
import { loadPdf } from './organize';

const PRESETS: Record<string, string> = {
  emails: String.raw`[\w.+-]+@[\w-]+(?:\.[\w-]+)+`,
  phones: String.raw`(?:\+|00)?\d[\d .\-]{7,}\d`,
  iban: String.raw`\b[A-Z]{2}\d{2}(?: ?[A-Z0-9]{4}){3,7}(?: ?[A-Z0-9]{1,4})?\b`,
  cards: String.raw`\b(?:\d[ -]?){13,19}\b`,
};
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export const redact: Tool = {
  id: 'redact',
  name: 'Caviarder PDF',
  icon: 'redact',
  category: 'security',
  description: 'Recherche automatique (mots, e-mails, téléphones, IBAN, cartes) puis suppression DÉFINITIVE : les pages touchées sont rasterisées, le texte caché disparaît vraiment.',
  accept: 'pdf',
  multiple: false,
  outputsPdf: true,
  needsBrowser: true,
  options: [
    { key: 'terms', label: 'Mots / phrases à caviarder (un par ligne ou séparés par ;)', type: 'text', default: '', placeholder: 'Dupont; 12 rue des Lilas' },
    { key: 'regex', label: 'Interpréter comme expressions régulières', type: 'checkbox', default: false },
    { key: 'emails', label: 'Adresses e-mail', type: 'checkbox', default: false },
    { key: 'phones', label: 'Numéros de téléphone', type: 'checkbox', default: false },
    { key: 'iban', label: 'IBAN', type: 'checkbox', default: false },
    { key: 'cards', label: 'Numéros de carte bancaire', type: 'checkbox', default: false },
    { key: 'dpi', label: 'Résolution des pages caviardées (dpi)', type: 'number', default: 200, min: 100, max: 400 },
  ],
  async run(files, o, progress) {
    const f = files[0];
    const bytes = await readBytes(f);
    const patterns: RegExp[] = [];
    for (const t of String(o.terms).split(/[;\n]/).map((s) => s.trim()).filter(Boolean)) {
      try { patterns.push(new RegExp(o.regex ? t : escapeRe(t), 'gi')); } catch { throw new Error(`Expression invalide : ${t}`); }
    }
    for (const k of Object.keys(PRESETS)) if (o[k]) patterns.push(new RegExp(PRESETS[k], 'gi'));
    if (!patterns.length) throw new Error('Indiquez au moins un terme ou cochez un modèle.');

    const pdf = await openPdf(bytes);
    const src = await loadPdf(f);
    const out = await PDFDocument.create();
    const scale = o.dpi / 72;
    let hits = 0;
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const vp = page.getViewport({ scale });
      const content = await page.getTextContent();
      const rects: [number, number, number, number][] = [];
      for (const it of content.items as any[]) {
        if (!it.str) continue;
        const [, , , d, e, fy] = it.transform as number[];
        const h = Math.abs(d) || it.height || 10;
        const len = it.str.length;
        for (const re of patterns) {
          re.lastIndex = 0;
          let m: RegExpExecArray | null;
          while ((m = re.exec(it.str)) && m[0]) {
            const x0 = e + (it.width * m.index) / len;
            const x1 = e + (it.width * (m.index + m[0].length)) / len;
            const [ax, ay] = vp.convertToViewportPoint(x0, fy - h * 0.25);
            const [bx, by] = vp.convertToViewportPoint(x1, fy + h * 0.95);
            rects.push([Math.min(ax, bx) - 1.5, Math.min(ay, by) - 1.5, Math.abs(bx - ax) + 3, Math.abs(by - ay) + 3]);
            hits++;
          }
        }
      }
      if (rects.length) {
        const canvas = await renderPageToCanvas(page, scale);
        const ctx = canvas.getContext('2d')!;
        ctx.fillStyle = '#000';
        for (const r of rects) ctx.fillRect(...r);
        const img = await out.embedJpg(new Uint8Array(await (await canvasToBlob(canvas, 'image/jpeg', 0.88)).arrayBuffer()));
        const base = page.getViewport({ scale: 1 });
        out.addPage([base.width, base.height]).drawImage(img, { x: 0, y: 0, width: base.width, height: base.height });
      } else {
        const [p] = await out.copyPages(src, [i - 1]);
        out.addPage(p);
      }
      page.cleanup();
      progress(i / pdf.numPages, `Page ${i}/${pdf.numPages}`);
    }
    return [{
      name: `${baseName(f.name)}_caviarde.pdf`,
      data: await out.save({ useObjectStreams: true }),
      mime: PDF_MIME,
      note: hits ? `${hits} occurrence(s) caviardée(s) définitivement.` : 'Aucune occurrence trouvée : le document n\'a pas été modifié.',
    }];
  },
};

// ---------- Comparaison ----------
type Op = { t: '=' | '+' | '-'; s: string };
function diffLines(a: string[], b: string[]): Op[] {
  const n = a.length, m = b.length;
  const L: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = a[i] === b[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const ops: Op[] = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) { ops.push({ t: '=', s: a[i] }); i++; j++; }
    else if (L[i + 1][j] >= L[i][j + 1]) ops.push({ t: '-', s: a[i++] });
    else ops.push({ t: '+', s: b[j++] });
  }
  while (i < n) ops.push({ t: '-', s: a[i++] });
  while (j < m) ops.push({ t: '+', s: b[j++] });
  return ops;
}
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));

export const compare: Tool = {
  id: 'compare',
  name: 'Comparer PDF',
  icon: 'compare',
  category: 'intelligence',
  description: 'Comparez deux versions page par page : ajouts et suppressions surlignés dans un rapport HTML.',
  accept: 'pdf',
  multiple: true,
  exactFiles: 2,
  outputsPdf: false,
  needsBrowser: true,
  options: [{ key: 'ignoreCase', label: 'Ignorer la casse et les espaces multiples', type: 'checkbox', default: true }],
  async run(files, o, progress) {
    const [A, B] = files;
    const [pa, pb] = await Promise.all([openPdf(await readBytes(A)), openPdf(await readBytes(B))]);
    const norm = (s: string) => (o.ignoreCase ? s.toLowerCase().replace(/\s+/g, ' ').trim() : s);
    const total = Math.max(pa.numPages, pb.numPages);
    let added = 0, removed = 0;
    const sections: string[] = [];
    for (let i = 1; i <= total; i++) {
      const la = i <= pa.numPages ? (await pageLines(await pa.getPage(i))).map((l) => l.text) : [];
      const lb = i <= pb.numPages ? (await pageLines(await pb.getPage(i))).map((l) => l.text) : [];
      const ops = diffLines(la.map(norm), lb.map(norm));
      const rawA = [...la], rawB = [...lb];
      let ia = 0, ib = 0, changes = 0;
      const rows = ops.map((op) => {
        if (op.t === '=') { ia++; ib++; return `<div class="eq">${esc(rawB[ib - 1])}</div>`; }
        if (op.t === '-') { removed++; changes++; return `<div class="del">- ${esc(rawA[ia++])}</div>`; }
        added++; changes++; return `<div class="add">+ ${esc(rawB[ib++])}</div>`;
      });
      sections.push(`<section><h2>Page ${i} ${changes ? `<span class="badge">${changes} différence(s)</span>` : '<span class="ok">identique</span>'}</h2>${rows.join('')}</section>`);
      progress(i / total);
    }
    const html = `<!doctype html><html lang="fr"><meta charset="utf-8"><title>Comparaison</title><style>
body{font:14px/1.5 system-ui,sans-serif;max-width:900px;margin:2rem auto;padding:0 1rem;color:#222}
h1{margin-bottom:.2rem}.sum{color:#555;margin-bottom:1.5rem}section{border:1px solid #ddd;border-radius:10px;padding:.5rem 1rem 1rem;margin:1rem 0}
.eq{color:#666}.add{background:#e6ffec;color:#116329;padding:1px 6px;border-radius:4px;margin:1px 0}.del{background:#ffebe9;color:#82071e;padding:1px 6px;border-radius:4px;margin:1px 0;text-decoration:line-through}
.badge{font-size:12px;background:#fff4d6;color:#7a5a00;padding:2px 8px;border-radius:99px}.ok{font-size:12px;color:#2a8a3e}</style>
<h1>Comparaison de PDF</h1><div class="sum"><b>${esc(A.name)}</b> (${pa.numPages} p.) et <b>${esc(B.name)}</b> (${pb.numPages} p.) — ${added} ajout(s), ${removed} suppression(s)</div>${sections.join('')}</html>`;
    void getPdfjs;
    return [{ name: `comparaison_${baseName(A.name)}_vs_${baseName(B.name)}.html`, data: new TextEncoder().encode(html), mime: 'text/html', note: `${added} ajout(s), ${removed} suppression(s).` }];
  },
};
