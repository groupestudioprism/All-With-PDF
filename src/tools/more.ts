import { PDFArray, PDFDict, PDFDocument, PDFName, StandardFonts, rgb, type PDFFont } from 'pdf-lib';
import JSZip from 'jszip';
import { PDF_MIME, type Tool, type ToolOutput } from '../core/types';
import { baseName, formatBytes, hexToRgb01, mmToPt, parsePages, readBytes } from '../core/util';
import { canvasToBlob, makeCanvas, openPdf, pageLines, pageRows, renderPageToCanvas } from '../core/pdfjs';
import { runQpdf } from '../core/qpdf';
import { loadPdf, subset } from './organize';
import { blocks, buildTable, detectDecimal, fragments, joinAcrossPages, parseValue, toRows, type Row, type Table } from '../core/tables';
import { safeSheetName, writeXlsx, type SheetCell, type SheetData } from '../core/xlsx';

const N = (s: string) => PDFName.of(s);
const pdfOut = (f: File, suffix: string, data: Uint8Array, note?: string): ToolOutput[] => [{ name: `${baseName(f.name)}_${suffix}.pdf`, data, mime: PDF_MIME, note }];
const textOut = (name: string, text: string, mime = 'text/plain'): ToolOutput => ({ name, data: new TextEncoder().encode(text), mime });
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
const PAGE: Record<string, [number, number]> = { a3: [841.89, 1190.55], a4: [595.28, 841.89], a5: [419.53, 595.28], letter: [612, 792], legal: [612, 1008] };
const FORMATS = [{ value: 'a4', label: 'A4' }, { value: 'a3', label: 'A3' }, { value: 'a5', label: 'A5' }, { value: 'letter', label: 'Letter' }, { value: 'legal', label: 'Legal' }];

/** Remplace les caractères que la police standard ne sait pas écrire. */
function winAnsi(font: PDFFont, text: string) {
  let out = '';
  for (const ch of text.replace(/\t/g, '    ')) {
    try { font.encodeText(ch); out += ch; } catch { out += ({ '’': "'", '‘': "'", '“': '"', '”': '"', '…': '...', '–': '-', '—': '-', '•': '-', '→': '>', ' ': ' ' } as Record<string, string>)[ch] ?? '?'; }
  }
  return out;
}

function wrapLine(font: PDFFont, text: string, size: number, maxW: number): string[] {
  if (!text) return [''];
  const lines: string[] = [];
  let line = '';
  for (const word of text.split(' ')) {
    const t = line ? `${line} ${word}` : word;
    if (line && font.widthOfTextAtSize(t, size) > maxW) { lines.push(line); line = word; } else line = t;
  }
  lines.push(line);
  return lines;
}

// ---------------------------------------------------------------- Sécurité
export const protect: Tool = {
  id: 'protect', name: 'Protéger par mot de passe', icon: 'lock', category: 'security', accept: 'pdf', multiple: false, outputsPdf: true,
  description: 'Chiffrement AES 256 bits : mot de passe d\'ouverture et restrictions (impression, copie, modification).',
  options: [
    { key: 'user', label: 'Mot de passe d\'ouverture', type: 'password', default: '', help: 'Vide : le document s\'ouvre librement mais reste restreint.' },
    { key: 'owner', label: 'Mot de passe propriétaire', type: 'password', default: '', help: 'Permet de lever les restrictions. Généré aléatoirement si vide.' },
    { key: 'print', label: 'Impression', type: 'select', default: 'full', choices: [{ value: 'full', label: 'Autorisée' }, { value: 'low', label: 'Basse résolution' }, { value: 'none', label: 'Interdite' }] },
    { key: 'copy', label: 'Copie du texte', type: 'checkbox', default: true },
    { key: 'modify', label: 'Modification', type: 'checkbox', default: false },
  ],
  async run(files, o) {
    if (!o.user && !o.owner) throw new Error('Saisissez au moins un mot de passe.');
    const owner = o.owner || crypto.randomUUID();
    const args = ['--encrypt', o.user, owner, '256', `--print=${o.print}`, `--extract=${o.copy ? 'y' : 'n'}`, `--modify=${o.modify ? 'all' : 'none'}`, '--'];
    const r = await runQpdf(args, await readBytes(files[0]));
    if (!r.data) throw new Error(`Chiffrement impossible : ${r.log.split('\n')[0] || 'erreur inconnue'}`);
    return pdfOut(files[0], 'protege', r.data, o.owner ? undefined : 'Aucun mot de passe propriétaire fourni : un mot de passe aléatoire a été utilisé (les restrictions ne pourront plus être levées).');
  },
};

export const unlock: Tool = {
  id: 'unlock', name: 'Déverrouiller PDF', icon: 'unlock', category: 'security', accept: 'pdf', multiple: false, outputsPdf: true,
  description: 'Retire le mot de passe et les restrictions d\'un PDF dont vous avez le droit de disposer.',
  options: [{ key: 'password', label: 'Mot de passe (si le fichier demande un mot de passe pour s\'ouvrir)', type: 'password', default: '' }],
  async run(files, o) {
    const r = await runQpdf([`--password=${o.password}`, '--decrypt'], await readBytes(files[0]));
    if (!r.data) throw new Error(/invalid password/i.test(r.log) || r.code === 2 ? 'Mot de passe incorrect, ou fichier impossible à déchiffrer.' : `Déverrouillage impossible : ${r.log.split('\n')[0] || 'erreur inconnue'}`);
    return pdfOut(files[0], 'deverrouille', r.data);
  },
};

export const clean: Tool = {
  id: 'clean', name: 'Nettoyer PDF', icon: 'broom', category: 'security', accept: 'pdf', multiple: false, outputsPdf: true,
  description: 'Supprime ce qui ne devrait pas être partagé : commentaires, JavaScript, pièces jointes, métadonnées.',
  options: [
    { key: 'annots', label: 'Commentaires et annotations', type: 'checkbox', default: true },
    { key: 'links', label: 'Liens hypertextes', type: 'checkbox', default: false },
    { key: 'js', label: 'JavaScript et actions automatiques', type: 'checkbox', default: true },
    { key: 'attach', label: 'Pièces jointes intégrées', type: 'checkbox', default: true },
    { key: 'meta', label: 'Métadonnées (auteur, titre, XMP)', type: 'checkbox', default: true },
  ],
  async run(files, o) {
    const doc = await loadPdf(files[0]);
    let removed = 0;
    for (const page of doc.getPages()) {
      const annots = page.node.lookupMaybe(N('Annots'), PDFArray);
      if (!annots) continue;
      const keep: any[] = [];
      for (let i = 0; i < annots.size(); i++) {
        const d = annots.lookupMaybe(i, PDFDict);
        const sub = d?.get(N('Subtype'))?.toString();
        const isWidget = sub === '/Widget', isLink = sub === '/Link';
        const drop = !isWidget && (isLink ? o.links : o.annots);
        if (drop) removed++; else keep.push(annots.get(i));
      }
      if (keep.length !== annots.size()) page.node.set(N('Annots'), doc.context.obj(keep));
    }
    const cat = doc.catalog;
    if (o.js) {
      cat.delete(N('OpenAction')); cat.delete(N('AA'));
      const names = cat.lookupMaybe(N('Names'), PDFDict);
      names?.delete(N('JavaScript'));
    }
    if (o.attach) {
      cat.lookupMaybe(N('Names'), PDFDict)?.delete(N('EmbeddedFiles'));
      cat.delete(N('AF'));
    }
    if (o.meta) {
      cat.delete(N('Metadata'));
      doc.setTitle(''); doc.setAuthor(''); doc.setSubject(''); doc.setKeywords([]); doc.setCreator(''); doc.setProducer('');
    }
    return pdfOut(files[0], 'nettoye', await doc.save({ useObjectStreams: true }), `${removed} annotation(s) retirée(s).`);
  },
};

// ---------------------------------------------------------------- Modifier / organiser
export const headerFooter: Tool = {
  id: 'header-footer', name: 'En-tête et pied de page', icon: 'header', category: 'edit', accept: 'pdf', multiple: false, outputsPdf: true,
  description: 'Texte récurrent en haut et en bas de chaque page : titre, date, référence, numéro.',
  options: [
    { key: 'hl', label: 'En-tête, gauche', type: 'text', default: '' },
    { key: 'hc', label: 'En-tête, centre', type: 'text', default: '' },
    { key: 'hr', label: 'En-tête, droite', type: 'text', default: '' },
    { key: 'fl', label: 'Pied de page, gauche', type: 'text', default: '{fichier}' },
    { key: 'fc', label: 'Pied de page, centre', type: 'text', default: 'Page {n} sur {total}' },
    { key: 'fr', label: 'Pied de page, droite', type: 'text', default: '{date}' },
    { key: 'size', label: 'Taille (pt)', type: 'number', default: 9, min: 5, max: 36 },
    { key: 'margin', label: 'Marge (mm)', type: 'number', default: 10, min: 2, max: 50 },
    { key: 'color', label: 'Couleur', type: 'color', default: '#555555' },
    { key: 'pages', label: 'Pages (vide = toutes)', type: 'text', default: '', help: 'Variables : {n} page, {total} nombre de pages, {date}, {fichier}.' },
  ],
  async run(files, o) {
    const f = files[0];
    const doc = await loadPdf(f);
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const [r, g, b] = hexToRgb01(o.color);
    const date = new Date().toLocaleDateString('fr-FR');
    const total = doc.getPageCount();
    const m = mmToPt(o.margin);
    for (const i of parsePages(o.pages, total)) {
      const p = doc.getPage(i);
      const { width, height } = p.getSize();
      const fill = (t: string) => winAnsi(font, t.replaceAll('{n}', String(i + 1)).replaceAll('{total}', String(total)).replaceAll('{date}', date).replaceAll('{fichier}', baseName(f.name)));
      const place = (text: string, pos: 'l' | 'c' | 'r', y: number) => {
        if (!text) return;
        const t = fill(text), w = font.widthOfTextAtSize(t, o.size);
        p.drawText(t, { x: pos === 'l' ? m : pos === 'r' ? width - m - w : (width - w) / 2, y, size: o.size, font, color: rgb(r, g, b) });
      };
      place(o.hl, 'l', height - m - o.size); place(o.hc, 'c', height - m - o.size); place(o.hr, 'r', height - m - o.size);
      place(o.fl, 'l', m); place(o.fc, 'c', m); place(o.fr, 'r', m);
    }
    return pdfOut(f, 'entetes', await doc.save({ useObjectStreams: true }));
  },
};

export const resize: Tool = {
  id: 'resize', name: 'Changer le format', icon: 'resize', category: 'edit', accept: 'pdf', multiple: false, outputsPdf: true,
  description: 'Adaptez toutes les pages à un format (A4, A3, Letter…) en conservant les proportions, avec marge optionnelle.',
  options: [
    { key: 'format', label: 'Nouveau format', type: 'select', default: 'a4', choices: FORMATS },
    { key: 'orientation', label: 'Orientation', type: 'select', default: 'auto', choices: [{ value: 'auto', label: 'Suivre chaque page' }, { value: 'portrait', label: 'Portrait' }, { value: 'landscape', label: 'Paysage' }] },
    { key: 'margin', label: 'Marge (mm)', type: 'number', default: 0, min: 0, max: 80 },
    { key: 'bg', label: 'Fond', type: 'color', default: '#ffffff' },
  ],
  async run(files, o, progress) {
    const src = await loadPdf(files[0]);
    const out = await PDFDocument.create();
    const emb = await out.embedPdf(src, src.getPageIndices());
    const m = mmToPt(o.margin);
    const [r, g, b] = hexToRgb01(o.bg);
    emb.forEach((e, i) => {
      let [w, h] = PAGE[o.format];
      const land = o.orientation === 'landscape' || (o.orientation === 'auto' && e.width > e.height);
      if (land !== w > h) [w, h] = [h, w];
      const p = out.addPage([w, h]);
      if (o.bg.toLowerCase() !== '#ffffff') p.drawRectangle({ x: 0, y: 0, width: w, height: h, color: rgb(r, g, b) });
      const k = Math.min((w - 2 * m) / e.width, (h - 2 * m) / e.height);
      p.drawPage(e, { x: (w - e.width * k) / 2, y: (h - e.height * k) / 2, xScale: k, yScale: k });
      progress((i + 1) / emb.length);
    });
    return pdfOut(files[0], o.format, await out.save({ useObjectStreams: true }));
  },
};

export const pageOrder: Tool = {
  id: 'page-order', name: 'Réordonner en lot', icon: 'reverse', category: 'organize', accept: 'pdf', multiple: false, outputsPdf: true,
  description: 'Inverser, garder pages paires ou impaires, dupliquer, insérer des pages vierges à intervalles réguliers.',
  options: [
    { key: 'mode', label: 'Opération', type: 'select', default: 'reverse', choices: [
      { value: 'reverse', label: 'Inverser l\'ordre des pages' }, { value: 'odd', label: 'Garder les pages impaires' }, { value: 'even', label: 'Garder les pages paires' },
      { value: 'repeat', label: 'Répéter chaque page N fois' }, { value: 'blank', label: 'Insérer une page vierge toutes les N pages' }, { value: 'swap', label: 'Permuter pages 2 par 2 (recto / verso)' } ] },
    { key: 'n', label: 'N', type: 'number', default: 2, min: 1, max: 50 },
  ],
  async run(files, o) {
    const src = await loadPdf(files[0]);
    const total = src.getPageCount();
    const all = src.getPageIndices();
    const doc = await PDFDocument.create();
    const add = async (idx: number) => { const [p] = await doc.copyPages(src, [idx]); doc.addPage(p); };
    const blank = () => { const ref = doc.getPageCount() ? doc.getPage(doc.getPageCount() - 1).getSize() : src.getPage(0).getSize(); doc.addPage([ref.width, ref.height]); };
    if (o.mode === 'reverse') for (const i of [...all].reverse()) await add(i);
    else if (o.mode === 'odd') for (const i of all.filter((x) => x % 2 === 0)) await add(i);
    else if (o.mode === 'even') { const l = all.filter((x) => x % 2 === 1); if (!l.length) throw new Error('Le document n\'a qu\'une page.'); for (const i of l) await add(i); }
    else if (o.mode === 'repeat') for (const i of all) for (let k = 0; k < o.n; k++) await add(i);
    else if (o.mode === 'blank') for (const i of all) { await add(i); if ((i + 1) % o.n === 0 && i + 1 < total) blank(); }
    else for (let i = 0; i < total; i += 2) { if (i + 1 < total) await add(i + 1); await add(i); }
    return pdfOut(files[0], 'ordre', await doc.save({ useObjectStreams: true }));
  },
};

export const booklet: Tool = {
  id: 'booklet', name: 'Brochure', icon: 'book', category: 'organize', accept: 'pdf', multiple: false, outputsPdf: true,
  description: 'Imposition pour impression recto verso : pliez et agrafez au centre pour obtenir un livret.',
  options: [{ key: 'gap', label: 'Espace central (mm)', type: 'number', default: 0, min: 0, max: 20 }],
  async run(files, o) {
    const src = await loadPdf(files[0]);
    const n0 = src.getPageCount();
    const n = Math.ceil(n0 / 4) * 4;
    const doc = await PDFDocument.create();
    const emb = await doc.embedPdf(src, src.getPageIndices());
    const { width: w, height: h } = src.getPage(0).getSize();
    const gap = mmToPt(o.gap);
    const slot = (idx: number) => (idx < n0 ? emb[idx] : null);
    const sheets: [number, number][] = [];
    for (let s = 0; s < n / 4; s++) { sheets.push([n - 1 - 2 * s, 2 * s]); sheets.push([2 * s + 1, n - 2 - 2 * s]); }
    for (const [l, r] of sheets) {
      const p = doc.addPage([w * 2 + gap, h]);
      [[slot(l), 0], [slot(r), w + gap]].forEach(([e, x]) => {
        if (!e) return;
        const pg = e as NonNullable<ReturnType<typeof slot>>;
        const k = Math.min(w / pg.width, h / pg.height);
        p.drawPage(pg, { x: (x as number) + (w - pg.width * k) / 2, y: (h - pg.height * k) / 2, xScale: k, yScale: k });
      });
    }
    return pdfOut(files[0], 'brochure', await doc.save({ useObjectStreams: true }), `${sheets.length} faces à imprimer en recto verso (retournement sur le bord court).`);
  },
};

export const grayscale: Tool = {
  id: 'grayscale', name: 'Noir et blanc', icon: 'contrast', category: 'optimize', accept: 'pdf', multiple: false, outputsPdf: true, needsBrowser: true,
  description: 'Convertit en niveaux de gris ou en noir et blanc pur (économie d\'encre, aspect scan).',
  options: [
    { key: 'mode', label: 'Rendu', type: 'select', default: 'gray', choices: [{ value: 'gray', label: 'Niveaux de gris' }, { value: 'bw', label: 'Noir et blanc pur' }] },
    { key: 'threshold', label: 'Seuil du noir et blanc (0-255)', type: 'number', default: 170, min: 60, max: 240 },
    { key: 'dpi', label: 'Résolution (dpi)', type: 'number', default: 150, min: 72, max: 300 },
  ],
  async run(files, o, progress) {
    const pdf = await openPdf(await readBytes(files[0]));
    const out = await PDFDocument.create();
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const vp = page.getViewport({ scale: 1 });
      const canvas = await renderPageToCanvas(page, o.dpi / 72);
      const ctx = canvas.getContext('2d')!;
      const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const d = img.data;
      for (let k = 0; k < d.length; k += 4) {
        const y = 0.299 * d[k] + 0.587 * d[k + 1] + 0.114 * d[k + 2];
        const v = o.mode === 'bw' ? (y > o.threshold ? 255 : 0) : y;
        d[k] = d[k + 1] = d[k + 2] = v;
      }
      ctx.putImageData(img, 0, 0);
      const jpg = await out.embedJpg(new Uint8Array(await (await canvasToBlob(canvas, 'image/jpeg', o.mode === 'bw' ? 0.8 : 0.75)).arrayBuffer()));
      out.addPage([vp.width, vp.height]).drawImage(jpg, { x: 0, y: 0, width: vp.width, height: vp.height });
      page.cleanup();
      progress(i / pdf.numPages, `Page ${i}/${pdf.numPages}`);
    }
    return pdfOut(files[0], o.mode === 'bw' ? 'nb' : 'gris', await out.save({ useObjectStreams: true }));
  },
};

export const splitBySize: Tool = {
  id: 'split-size', name: 'Diviser par taille', icon: 'split', category: 'organize', accept: 'pdf', multiple: false, outputsPdf: true,
  description: 'Découpe un gros PDF en fichiers ne dépassant pas une taille donnée (envoi par e-mail, dépôt en ligne).',
  options: [{ key: 'mb', label: 'Taille maximale par fichier (Mo)', type: 'number', default: 10, min: 0.2, step: 0.5 }],
  async run(files, o, progress) {
    const f = files[0];
    const src = await loadPdf(f);
    const total = src.getPageCount();
    const max = o.mb * 1024 * 1024;
    const outs: ToolOutput[] = [];
    let start = 0;
    const avg = Math.max(1, (await src.save()).byteLength / total);
    while (start < total) {
      let k = Math.max(1, Math.min(total - start, Math.floor(max / avg)));
      let data = await subset(src, Array.from({ length: k }, (_, i) => start + i));
      while (data.byteLength > max && k > 1) { k = Math.max(1, Math.floor(k * 0.8)); data = await subset(src, Array.from({ length: k }, (_, i) => start + i)); }
      outs.push({ name: `${baseName(f.name)}_partie${outs.length + 1}.pdf`, data, mime: PDF_MIME, note: data.byteLength > max ? 'Une seule page dépasse la taille demandée.' : undefined });
      start += k;
      progress(start / total);
    }
    return outs;
  },
};

// ---------------------------------------------------------------- Vers PDF
async function textToPdf(title: string, text: string, o: Record<string, any>, md: boolean) {
  const doc = await PDFDocument.create();
  const fonts = { regular: await doc.embedFont({ helvetica: StandardFonts.Helvetica, times: StandardFonts.TimesRoman, courier: StandardFonts.Courier }[o.font as 'helvetica']), bold: await doc.embedFont({ helvetica: StandardFonts.HelveticaBold, times: StandardFonts.TimesRomanBold, courier: StandardFonts.CourierBold }[o.font as 'helvetica']) };
  const [pw, ph] = PAGE[o.format];
  const m = mmToPt(o.margin);
  let page = doc.addPage([pw, ph]);
  let y = ph - m;
  const size = o.size;
  const need = (h: number) => { if (y - h < m) { page = doc.addPage([pw, ph]); y = ph - m; } };
  for (const raw of text.replace(/\r\n?/g, '\n').split('\n')) {
    let s = raw, font = fonts.regular, fs = size, indent = 0;
    if (md) {
      const h = s.match(/^(#{1,4})\s+(.*)$/);
      if (h) { font = fonts.bold; fs = size * [1.9, 1.5, 1.25, 1.1][h[1].length - 1]; s = h[2]; y -= fs * 0.4; }
      else if (/^\s*[-*+]\s+/.test(s)) { s = '- ' + s.replace(/^\s*[-*+]\s+/, ''); indent = 8; }
      s = s.replace(/\*\*(.*?)\*\*/g, '$1').replace(/`([^`]*)`/g, '$1');
    }
    const lines = o.font === 'courier' && !md ? [s] : wrapLine(font, winAnsi(font, s), fs, pw - 2 * m - indent);
    for (const ln of lines.length ? lines : ['']) {
      need(fs * 1.35);
      y -= fs * 1.2;
      const t = winAnsi(font, ln);
      if (t.trim()) page.drawText(t, { x: m + indent, y, size: fs, font, color: rgb(0.1, 0.1, 0.1) });
      y -= fs * 0.15;
    }
  }
  doc.setTitle(title);
  return doc.save({ useObjectStreams: true });
}

const textOptions = [
  { key: 'format', label: 'Format de page', type: 'select' as const, default: 'a4', choices: FORMATS },
  { key: 'font', label: 'Police', type: 'select' as const, default: 'helvetica', choices: [{ value: 'helvetica', label: 'Sans empattement (Helvetica)' }, { value: 'times', label: 'Avec empattement (Times)' }, { value: 'courier', label: 'Chasse fixe (Courier)' }] },
  { key: 'size', label: 'Taille (pt)', type: 'number' as const, default: 11, min: 6, max: 24 },
  { key: 'margin', label: 'Marge (mm)', type: 'number' as const, default: 20, min: 5, max: 50 },
];

export const textToPdf_: Tool = {
  id: 'text-to-pdf', name: 'Texte vers PDF', icon: 'text', category: 'to-pdf', accept: 'text', multiple: false, outputsPdf: true,
  description: 'Fichiers .txt, .md ou .csv en PDF paginé. Le Markdown (titres, listes) est mis en forme.',
  options: textOptions,
  async run(files, o) {
    const f = files[0];
    const md = /\.(md|markdown)$/i.test(f.name);
    return pdfOut(f, 'texte', await textToPdf(baseName(f.name), await f.text(), o, md));
  },
};

export const wordToPdf: Tool = {
  id: 'word-to-pdf', name: 'Word vers PDF', icon: 'word', category: 'to-pdf', accept: 'word', multiple: false, outputsPdf: true, needsBrowser: true,
  description: 'Documents .docx en PDF : titres, paragraphes, listes et tableaux. Mise en forme simplifiée (pas d\'images ni de styles avancés).',
  options: textOptions,
  async run(files, o) {
    const f = files[0];
    const mammoth = (await import('mammoth')).default ?? (await import('mammoth'));
    const { value: html } = await mammoth.convertToHtml({ arrayBuffer: await f.arrayBuffer() });
    const dom = new DOMParser().parseFromString(html, 'text/html');
    const lines: string[] = [];
    const walk = (el: Element) => {
      const tag = el.tagName.toLowerCase();
      const txt = (el.textContent ?? '').trim();
      if (/^h[1-4]$/.test(tag)) lines.push('', `${'#'.repeat(Number(tag[1]))} ${txt}`);
      else if (tag === 'p') lines.push(txt);
      else if (tag === 'li') lines.push(`- ${txt}`);
      else if (tag === 'table') el.querySelectorAll('tr').forEach((tr) => lines.push([...tr.children].map((c) => (c.textContent ?? '').trim()).join('  |  ')));
      else { [...el.children].forEach(walk); return; }
      if (tag === 'p' || tag === 'table') lines.push('');
    };
    [...dom.body.children].forEach((c) => (['ul', 'ol'].includes(c.tagName.toLowerCase()) ? [...c.children].forEach(walk) : walk(c)));
    return pdfOut(f, 'word', await textToPdf(baseName(f.name), lines.join('\n'), o, true), 'Conversion simplifiée : le texte et la structure sont conservés, pas la mise en page d\'origine.');
  },
};

// ---------------------------------------------------------------- Depuis PDF
const xml = (s: string) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]!));

export const pdfToWord: Tool = {
  id: 'pdf-to-word', name: 'PDF vers Word', icon: 'word', category: 'from-pdf', accept: 'pdf', multiple: false, outputsPdf: false, needsBrowser: true,
  description: 'Texte et titres du PDF dans un document .docx modifiable. Reprend la structure, pas la mise en page exacte.',
  options: [{ key: 'pages', label: 'Pages (vide = toutes)', type: 'text', default: '' }],
  async run(files, o, progress) {
    const f = files[0];
    const pdf = await openPdf(await readBytes(f));
    const idx = parsePages(o.pages, pdf.numPages);
    const all: Awaited<ReturnType<typeof pageLines>>[] = [];
    for (let k = 0; k < idx.length; k++) { all.push(await pageLines(await pdf.getPage(idx[k] + 1))); progress((k + 1) / idx.length); }
    const sizes = all.flat().map((l) => l.size).sort((a, b) => a - b);
    const body = sizes[Math.floor(sizes.length / 2)] || 10;
    const paras: string[] = [];
    all.forEach((lines, pi) => {
      let buf: string[] = [];
      let prevY = 0;
      const flush = () => { if (buf.length) paras.push(`<w:p><w:r><w:t xml:space="preserve">${xml(buf.join(' '))}</w:t></w:r></w:p>`); buf = []; };
      for (const l of lines) {
        const ratio = l.size / body;
        const gap = prevY ? Math.abs(prevY - l.y) : 0;
        prevY = l.y;
        if (ratio >= 1.12) { flush(); paras.push(`<w:p><w:pPr><w:spacing w:before="200" w:after="80"/></w:pPr><w:r><w:rPr><w:b/><w:sz w:val="${Math.round(Math.min(ratio, 2.4) * 22)}"/></w:rPr><w:t xml:space="preserve">${xml(l.text)}</w:t></w:r></w:p>`); }
        else { if (gap > l.size * 1.9) flush(); buf.push(l.text); }
      }
      flush();
      if (pi < all.length - 1) paras.push('<w:p><w:r><w:br w:type="page"/></w:r></w:p>');
    });
    const zip = new JSZip();
    zip.file('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
    zip.file('_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
    zip.file('word/document.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${paras.join('')}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr></w:body></w:document>`);
    const data = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
    return [{ name: `${baseName(f.name)}.docx`, data, mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', note: 'Texte et titres extraits. Les images et la mise en page ne sont pas reprises.' }];
  },
};

export const pdfToPptx: Tool = {
  id: 'pdf-to-pptx', name: 'PDF vers PowerPoint', icon: 'slides', category: 'from-pdf', accept: 'pdf', multiple: false, outputsPdf: false, needsBrowser: true,
  description: 'Une diapositive par page, fidèle au rendu d\'origine, avec le texte de la page dans les notes.',
  options: [
    { key: 'dpi', label: 'Qualité des images (dpi)', type: 'number', default: 130, min: 72, max: 250 },
    { key: 'pages', label: 'Pages (vide = toutes)', type: 'text', default: '' },
  ],
  async run(files, o, progress) {
    const f = files[0];
    const pdf = await openPdf(await readBytes(f));
    const idx = parsePages(o.pages, pdf.numPages);
    const PptxGenJS = (await import('pptxgenjs')).default;
    const pptx = new PptxGenJS();
    const first = (await pdf.getPage(idx[0] + 1)).getViewport({ scale: 1 });
    pptx.defineLayout({ name: 'PDF', width: first.width / 72, height: first.height / 72 });
    pptx.layout = 'PDF';
    for (let k = 0; k < idx.length; k++) {
      const page = await pdf.getPage(idx[k] + 1);
      const canvas = await renderPageToCanvas(page, o.dpi / 72);
      const slide = pptx.addSlide();
      slide.addImage({ data: canvas.toDataURL('image/jpeg', 0.85), x: 0, y: 0, w: first.width / 72, h: first.height / 72 });
      const text = (await pageLines(page)).map((l) => l.text).join('\n');
      if (text) slide.addNotes(text);
      page.cleanup();
      progress((k + 1) / idx.length, `Page ${idx[k] + 1}`);
    }
    const data = (await pptx.write({ outputType: 'uint8array' })) as Uint8Array;
    return [{ name: `${baseName(f.name)}.pptx`, data, mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', note: 'Diapositives en images : non modifiables, texte disponible dans les notes.' }];
  },
};

export const pdfToCsv: Tool = {
  id: 'pdf-to-csv', name: 'PDF vers Excel', icon: 'table', category: 'from-pdf', accept: 'pdf', multiple: false, outputsPdf: false, needsBrowser: true,
  description: 'Détecte les tableaux, reconstruit les colonnes et produit un vrai classeur Excel (.xlsx) : nombres, dates et pourcentages typés, cellules fusionnées, en-têtes figés.',
  options: [
    { key: 'format', label: 'Format de sortie', type: 'select', default: 'xlsx', choices: [{ value: 'xlsx', label: 'Excel (.xlsx)' }, { value: 'csv', label: 'CSV (point-virgule)' }] },
    { key: 'layout', label: 'Organisation', type: 'select', default: 'tables', choices: [{ value: 'tables', label: 'Une feuille par tableau' }, { value: 'pages', label: 'Une feuille par page' }, { value: 'single', label: 'Tout sur une seule feuille' }] },
    { key: 'join', label: 'Fusionner les tableaux qui continuent d\'une page à l\'autre', type: 'checkbox', default: true },
    { key: 'convert', label: 'Convertir nombres, dates et pourcentages', type: 'checkbox', default: true },
    { key: 'decimal', label: 'Séparateur décimal du document', type: 'select', default: 'auto', choices: [{ value: 'auto', label: 'Automatique' }, { value: ',', label: 'Virgule (1 234,56)' }, { value: '.', label: 'Point (1,234.56)' }] },
    { key: 'extra', label: 'Ajouter une feuille « Texte hors tableaux » (titres, notes, totaux)', type: 'checkbox', default: true },
    { key: 'minCols', label: 'Colonnes minimum pour une ligne de tableau', type: 'number', default: 2, min: 2, max: 20 },
    { key: 'pages', label: 'Pages (vide = toutes)', type: 'text', default: '' },
  ],
  async run(files, o, progress) {
    const f = files[0];
    const pdf = await openPdf(await readBytes(f));
    const idx = parsePages(o.pages, pdf.numPages);
    let tables: Table[] = [];
    const pageText: { page: number; rows: Row[] }[] = [];
    let anyText = false;
    const outside: [number, string][] = [];
    for (let k = 0; k < idx.length; k++) {
      const page = await pdf.getPage(idx[k] + 1);
      const frags = fragments(await page.getTextContent());
      if (frags.length) anyText = true;
      const rows = toRows(frags);
      pageText.push({ page: idx[k] + 1, rows });
      const used = new Set<Row>();
      for (const blk of blocks(rows, o.minCols)) {
        const t = buildTable(blk, idx[k] + 1, o.minCols);
        if (t) { tables.push(t); blk.forEach((r) => used.add(r)); }
      }
      for (const r of rows) if (!used.has(r)) outside.push([idx[k] + 1, r.cells.map((c) => c.text).join('  ')]);
      page.cleanup();
      progress((k + 1) / idx.length, `Page ${idx[k] + 1}`);
    }
    if (!anyText) throw new Error('Ce PDF ne contient pas de texte (document scanné ?). Passez-le d\'abord dans l\'outil « OCR PDF », puis relancez la conversion.');
    if (o.join) tables = joinAcrossPages(tables);
    const dec: ',' | '.' = o.decimal === 'auto' ? detectDecimal(tables.flatMap((t) => t.rows.flat())) : o.decimal;
    const conv = !!o.convert;
    const base = baseName(f.name);

    // Aucun tableau : on livre tout le texte, une ligne par cellule A.
    let fallback = false;
    if (!tables.length) {
      fallback = true;
      tables = pageText.filter((p) => p.rows.length).map((p) => ({ page: p.page, rows: p.rows.map((r) => [r.cells.map((c) => c.text).join(' ')]), merges: [], header: false, seps: [], x0: 0 }));
    }

    if (o.format === 'csv') {
      const q = (s: string) => (/[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
      const lines: string[] = [];
      tables.forEach((t, i) => { if (i && o.layout !== 'single') lines.push(''); t.rows.forEach((r) => lines.push(r.map((c) => q(c.replace(/\n/g, ' '))).join(';'))); });
      return [{ name: `${base}.csv`, data: new TextEncoder().encode('\ufeff' + lines.join('\r\n')), mime: 'text/csv', note: `${lines.filter(Boolean).length} ligne(s) extraite(s).` }];
    }

    const toSheet = (list: Table[], name: string): SheetData => {
      const rows: SheetCell[][] = [];
      const merges: SheetData['merges'] = [];
      list.forEach((t, i) => {
        if (i) rows.push([]);
        const off = rows.length;
        t.rows.forEach((r, ri) => rows.push(r.map((txt) => ({ v: parseValue(txt, dec, conv && !(t.header && ri === 0)), header: t.header && ri === 0, wrap: txt.includes('\n') }))));
        t.merges.forEach((m) => merges.push({ r: m.r + off, c0: m.c0, c1: m.c1 }));
      });
      const single = list.length === 1 && !fallback;
      return { name, rows, merges, freezeHeader: single && list[0].header, filter: single && list[0].header };
    };
    const used = new Set<string>();
    let sheets: SheetData[];
    if (o.layout === 'single') sheets = [toSheet(tables, safeSheetName(base, used))];
    else if (o.layout === 'pages') {
      const pages = [...new Set(tables.map((t) => t.page))];
      sheets = pages.map((p) => toSheet(tables.filter((t) => t.page === p), safeSheetName(`Page ${p}`, used)));
    } else {
      const perPage = new Map<number, number>();
      sheets = tables.map((t, i) => {
        const n = (perPage.get(t.page) ?? 0) + 1; perPage.set(t.page, n);
        return toSheet([t], safeSheetName(tables.length === 1 ? 'Tableau' : `Tableau ${i + 1} (p${t.page})`, used));
      });
    }
    if (o.extra && !fallback && outside.length) {
      sheets.push({ name: safeSheetName('Texte hors tableaux', used), rows: [[{ v: { t: 's', s: 'Page' }, header: true }, { v: { t: 's', s: 'Texte' }, header: true }], ...outside.map(([pg, tx]) => [{ v: { t: 'n', v: pg, fmt: '0' } as const }, { v: { t: 's', s: tx } as const }])], merges: [], freezeHeader: true, filter: false });
    }
    const data = await writeXlsx(sheets);
    const nrows = tables.reduce((a, t) => a + t.rows.length, 0);
    return [{
      name: `${base}.xlsx`, data, mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      note: fallback ? 'Aucun tableau détecté : le texte a été placé ligne par ligne. Essayez « Colonnes minimum » = 2 ou un autre découpage.' : `${tables.length} tableau(x), ${nrows} ligne(s), ${sheets.length} feuille(s).`,
    }];
  },
};

// ---------------------------------------------------------------- Analyse
export const info: Tool = {
  id: 'info', name: 'Informations du PDF', icon: 'info', category: 'intelligence', accept: 'pdf', multiple: false, outputsPdf: false,
  description: 'Rapport : taille, pages, formats, chiffrement, formulaires, images, métadonnées.',
  options: [],
  async run(files) {
    const f = files[0];
    const bytes = await readBytes(f);
    const doc = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
    const sizes = new Map<string, number>();
    doc.getPages().forEach((p) => {
      const { width, height } = p.getSize();
      const mm = [width, height].map((v) => Math.round((v * 25.4) / 72));
      const name = Object.entries(PAGE).find(([, [w, h]]) => (Math.abs(w - width) < 3 && Math.abs(h - height) < 3) || (Math.abs(w - height) < 3 && Math.abs(h - width) < 3))?.[0]?.toUpperCase();
      const k = `${name ? name + ' ' : ''}${mm[0]} x ${mm[1]} mm`;
      sizes.set(k, (sizes.get(k) ?? 0) + 1);
    });
    let images = 0;
    for (const [, o] of doc.context.enumerateIndirectObjects()) if ((o as any).dict?.get?.(N('Subtype')) === N('Image')) images++;
    let fields = 0;
    try { fields = doc.getForm().getFields().length; } catch { /* sans formulaire */ }
    const rows: [string, string][] = [
      ['Fichier', f.name], ['Taille', formatBytes(bytes.byteLength)], ['Pages', String(doc.getPageCount())],
      ['Formats de page', [...sizes].map(([k, n]) => `${k} (${n})`).join(', ')],
      ['Chiffré', doc.isEncrypted ? 'Oui' : 'Non'], ['Images intégrées', String(images)], ['Champs de formulaire', String(fields)],
      ['Titre', doc.getTitle() ?? ''], ['Auteur', doc.getAuthor() ?? ''], ['Sujet', doc.getSubject() ?? ''], ['Logiciel de création', doc.getCreator() ?? ''], ['Producteur', doc.getProducer() ?? ''],
      ['Créé le', doc.getCreationDate()?.toLocaleString('fr-FR') ?? ''], ['Modifié le', doc.getModificationDate()?.toLocaleString('fr-FR') ?? ''],
    ];
    const html = `<!doctype html><html lang="fr"><meta charset="utf-8"><title>Informations</title><style>body{font:15px/1.5 system-ui,sans-serif;max-width:760px;margin:2rem auto;padding:0 1rem;color:#161a22}h1{font-size:22px}table{border-collapse:collapse;width:100%}td{padding:9px 12px;border-bottom:1px solid #e3e6ec;vertical-align:top}td:first-child{color:#5d6574;width:210px}</style><h1>Informations sur le document</h1><table>${rows.map(([k, v]) => `<tr><td>${esc(k)}</td><td>${esc(v) || '<span style="color:#aaa">non renseigné</span>'}</td></tr>`).join('')}</table></html>`;
    return [{ name: `${baseName(f.name)}_infos.html`, data: new TextEncoder().encode(html), mime: 'text/html', note: `${doc.getPageCount()} page(s), ${formatBytes(bytes.byteLength)}, ${images} image(s).` }];
  },
};

export const search: Tool = {
  id: 'search', name: 'Rechercher dans le PDF', icon: 'search', category: 'intelligence', accept: 'pdf', multiple: false, outputsPdf: false, needsBrowser: true,
  description: 'Trouvez toutes les occurrences d\'un mot ou d\'une expression avec page et contexte, dans un rapport exportable.',
  options: [
    { key: 'term', label: 'Terme recherché', type: 'text', default: '', placeholder: 'ex. pénalité, article 12, .*@.*' },
    { key: 'regex', label: 'Expression régulière', type: 'checkbox', default: false },
    { key: 'caseSensitive', label: 'Respecter la casse', type: 'checkbox', default: false },
  ],
  async run(files, o, progress) {
    const f = files[0];
    if (!String(o.term).trim()) throw new Error('Saisissez un terme à rechercher.');
    let re: RegExp;
    try { re = new RegExp(o.regex ? o.term : String(o.term).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), o.caseSensitive ? 'g' : 'gi'); } catch { throw new Error('Expression régulière invalide.'); }
    const pdf = await openPdf(await readBytes(f));
    const hits: { page: number; before: string; hit: string; after: string }[] = [];
    for (let i = 1; i <= pdf.numPages; i++) {
      for (const l of await pageLines(await pdf.getPage(i))) {
        re.lastIndex = 0;
        let m: RegExpExecArray | null;
        while ((m = re.exec(l.text)) && m[0]) hits.push({ page: i, before: l.text.slice(Math.max(0, m.index - 50), m.index), hit: m[0], after: l.text.slice(m.index + m[0].length, m.index + m[0].length + 60) });
      }
      progress(i / pdf.numPages);
    }
    const byPage = new Map<number, number>();
    hits.forEach((h) => byPage.set(h.page, (byPage.get(h.page) ?? 0) + 1));
    const html = `<!doctype html><html lang="fr"><meta charset="utf-8"><title>Recherche</title><style>body{font:15px/1.5 system-ui,sans-serif;max-width:860px;margin:2rem auto;padding:0 1rem;color:#161a22}h1{font-size:22px}.s{color:#5d6574;margin-bottom:1.2rem}.r{border-bottom:1px solid #e3e6ec;padding:8px 0;display:flex;gap:14px}.p{flex:none;width:70px;color:#5d6574}mark{background:#fff0a6;padding:0 2px;border-radius:3px}</style><h1>Résultats pour « ${esc(String(o.term))} »</h1><div class="s">${hits.length} occurrence(s) sur ${byPage.size} page(s) dans ${esc(f.name)}</div>${hits.map((h) => `<div class="r"><span class="p">Page ${h.page}</span><span>${esc(h.before)}<mark>${esc(h.hit)}</mark>${esc(h.after)}</span></div>`).join('') || '<p>Aucune occurrence.</p>'}</html>`;
    return [{ name: `${baseName(f.name)}_recherche.html`, data: new TextEncoder().encode(html), mime: 'text/html', note: `${hits.length} occurrence(s) sur ${byPage.size} page(s).` }];
  },
};

export const fillForm: Tool = {
  id: 'forms', name: 'Remplir un formulaire', icon: 'form', category: 'edit', accept: 'pdf', multiple: false, outputsPdf: true, custom: 'forms',
  description: 'Complétez les champs d\'un formulaire PDF (texte, cases, listes) puis enregistrez, avec option d\'aplatissement.',
  options: [],
  async run() { throw new Error('Cet outil utilise une interface dédiée.'); },
};

void makeCanvas; void textOut;
