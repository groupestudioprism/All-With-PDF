import { PDFDocument, StandardFonts, degrees, rgb } from 'pdf-lib';
import { PDF_MIME, type Tool } from '../core/types';
import { baseName, hexToRgb01, mmToPt, parsePages, readBytes } from '../core/util';
import { openPdf, renderPageToCanvas } from '../core/pdfjs';
import { loadPdf } from './organize';

const col = (hex: string) => {
  const [r, g, b] = hexToRgb01(hex);
  return rgb(r, g, b);
};
const out = (f: File, suffix: string, data: Uint8Array) => [{ name: `${baseName(f.name)}_${suffix}.pdf`, data, mime: PDF_MIME }];

/** Les polices standard PDF ne couvrent que WinAnsi : message clair sinon. */
function safeText(font: { encodeText: (t: string) => unknown }, text: string) {
  try {
    font.encodeText(text);
    return text;
  } catch {
    throw new Error('Ce texte contient des caractères non supportés par la police standard (essayez des lettres latines, ou utilisez l\'éditeur visuel).');
  }
}

export const rotate: Tool = {
  id: 'rotate',
  name: 'Pivoter PDF',
  icon: 'rotate',
  category: 'edit',
  description: 'Faites pivoter toutes les pages ou seulement certaines.',
  accept: 'pdf',
  multiple: false,
  outputsPdf: true,
  options: [
    { key: 'angle', label: 'Rotation', type: 'select', default: '90', choices: [{ value: '90', label: '90° horaire' }, { value: '180', label: '180°' }, { value: '270', label: '90° anti-horaire' }] },
    { key: 'pages', label: 'Pages (vide = toutes)', type: 'text', default: '' },
  ],
  async run(files, o) {
    const doc = await loadPdf(files[0]);
    for (const i of parsePages(o.pages, doc.getPageCount())) {
      const p = doc.getPage(i);
      p.setRotation(degrees((p.getRotation().angle + Number(o.angle)) % 360));
    }
    return out(files[0], 'pivote', await doc.save({ useObjectStreams: true }));
  },
};

export const pageNumbers: Tool = {
  id: 'page-numbers',
  name: 'Numéroter les pages',
  icon: 'numbers',
  category: 'edit',
  description: 'Ajoutez une numérotation personnalisable (position, format, départ).',
  accept: 'pdf',
  multiple: false,
  outputsPdf: true,
  options: [
    { key: 'position', label: 'Position', type: 'select', default: 'bc', choices: [
      { value: 'tl', label: 'Haut gauche' }, { value: 'tc', label: 'Haut centre' }, { value: 'tr', label: 'Haut droite' },
      { value: 'bl', label: 'Bas gauche' }, { value: 'bc', label: 'Bas centre' }, { value: 'br', label: 'Bas droite' } ] },
    { key: 'format', label: 'Format ({n} page, {total} total)', type: 'text', default: '{n} / {total}' },
    { key: 'start', label: 'Premier numéro', type: 'number', default: 1 },
    { key: 'size', label: 'Taille (pt)', type: 'number', default: 11, min: 6, max: 48 },
    { key: 'margin', label: 'Marge (mm)', type: 'number', default: 10, min: 0, max: 60 },
    { key: 'color', label: 'Couleur', type: 'color', default: '#333333' },
    { key: 'pages', label: 'Pages à numéroter (vide = toutes)', type: 'text', default: '' },
  ],
  async run(files, o) {
    const doc = await loadPdf(files[0]);
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const total = doc.getPageCount();
    const idx = parsePages(o.pages, total);
    safeText(font, String(o.format));
    idx.forEach((i, k) => {
      const p = doc.getPage(i);
      const { width, height } = p.getSize();
      const text = String(o.format).replaceAll('{n}', String(o.start + k)).replaceAll('{total}', String(o.start + idx.length - 1));
      const tw = font.widthOfTextAtSize(text, o.size);
      const m = mmToPt(o.margin);
      const x = o.position.endsWith('l') ? m : o.position.endsWith('r') ? width - m - tw : (width - tw) / 2;
      const y = o.position.startsWith('t') ? height - m - o.size : m;
      p.drawText(text, { x, y, size: o.size, font, color: col(o.color) });
    });
    return out(files[0], 'numerote', await doc.save({ useObjectStreams: true }));
  },
};

export const watermark: Tool = {
  id: 'watermark',
  name: 'Filigrane',
  icon: 'watermark',
  category: 'edit',
  description: 'Texte en filigrane : centré ou en mosaïque, avec angle et opacité.',
  accept: 'pdf',
  multiple: false,
  outputsPdf: true,
  options: [
    { key: 'text', label: 'Texte', type: 'text', default: 'CONFIDENTIEL' },
    { key: 'size', label: 'Taille (pt)', type: 'number', default: 60, min: 8, max: 300 },
    { key: 'angle', label: 'Angle (°)', type: 'number', default: 45, min: -180, max: 180 },
    { key: 'opacity', label: 'Opacité (0–1)', type: 'number', default: 0.2, min: 0.02, max: 1, step: 0.02 },
    { key: 'color', label: 'Couleur', type: 'color', default: '#d11a2a' },
    { key: 'tile', label: 'Mosaïque (répéter sur la page)', type: 'checkbox', default: false },
    { key: 'pages', label: 'Pages (vide = toutes)', type: 'text', default: '' },
  ],
  async run(files, o) {
    const doc = await loadPdf(files[0]);
    const font = await doc.embedFont(StandardFonts.HelveticaBold);
    const text = safeText(font, String(o.text));
    if (!text.trim()) throw new Error('Saisissez un texte de filigrane.');
    const tw = font.widthOfTextAtSize(text, o.size);
    const rad = (o.angle * Math.PI) / 180;
    for (const i of parsePages(o.pages, doc.getPageCount())) {
      const p = doc.getPage(i);
      const { width, height } = p.getSize();
      const spots: [number, number][] = [];
      if (o.tile) {
        const stepX = tw * 1.5, stepY = o.size * 4;
        for (let y = 0; y < height + stepY; y += stepY) for (let x = 0; x < width + stepX; x += stepX) spots.push([x - stepX / 2 + ((y / stepY) % 2) * (stepX / 2), y]);
      } else {
        // centre le texte tourné autour du centre de la page
        spots.push([width / 2 - (tw / 2) * Math.cos(rad) + (o.size / 3) * Math.sin(rad), height / 2 - (tw / 2) * Math.sin(rad) - (o.size / 3) * Math.cos(rad)]);
      }
      for (const [x, y] of spots) p.drawText(text, { x, y, size: o.size, font, color: col(o.color), opacity: o.opacity, rotate: degrees(o.angle) });
    }
    return out(files[0], 'filigrane', await doc.save({ useObjectStreams: true }));
  },
};

export const crop: Tool = {
  id: 'crop',
  name: 'Rogner PDF',
  icon: 'crop',
  category: 'edit',
  description: 'Marges manuelles ou rognage automatique sur le contenu visible.',
  accept: 'pdf',
  multiple: false,
  outputsPdf: true,
  needsBrowser: true,
  options: [
    { key: 'auto', label: 'Rognage automatique (détecte le contenu)', type: 'checkbox', default: false },
    { key: 'padding', label: 'Marge conservée en auto (mm)', type: 'number', default: 4, min: 0, max: 50 },
    { key: 'top', label: 'Haut (mm)', type: 'number', default: 0, min: 0 },
    { key: 'right', label: 'Droite (mm)', type: 'number', default: 0, min: 0 },
    { key: 'bottom', label: 'Bas (mm)', type: 'number', default: 0, min: 0 },
    { key: 'left', label: 'Gauche (mm)', type: 'number', default: 0, min: 0 },
  ],
  async run(files, o, progress) {
    const f = files[0];
    const bytes = await readBytes(f);
    const doc = await loadPdf(f);
    const pdf = o.auto ? await openPdf(bytes) : null;
    for (let i = 0; i < doc.getPageCount(); i++) {
      const p = doc.getPage(i);
      const { width: W, height: H } = p.getSize();
      let [l, b, r, t] = [mmToPt(o.left), mmToPt(o.bottom), mmToPt(o.right), mmToPt(o.top)];
      if (pdf && p.getRotation().angle === 0) {
        const page = await pdf.getPage(i + 1);
        const scale = 0.5;
        const c = await renderPageToCanvas(page, scale);
        const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
        let x0 = c.width, x1 = -1, y0 = c.height, y1 = -1;
        for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) {
          const k = (y * c.width + x) * 4;
          if (d[k + 3] > 0 && (d[k] < 245 || d[k + 1] < 245 || d[k + 2] < 245)) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
        }
        if (x1 >= 0) {
          const pad = mmToPt(o.padding);
          l = Math.max(0, x0 / scale - pad); r = Math.max(0, W - (x1 + 1) / scale - pad);
          t = Math.max(0, y0 / scale - pad); b = Math.max(0, H - (y1 + 1) / scale - pad);
        }
        page.cleanup();
      }
      const w = W - l - r, h = H - t - b;
      if (w < 10 || h < 10) throw new Error(`Page ${i + 1} : marges trop grandes.`);
      p.setCropBox(l, b, w, h);
      p.setMediaBox(l, b, w, h);
      progress((i + 1) / doc.getPageCount());
    }
    return out(f, 'rogne', await doc.save({ useObjectStreams: true }));
  },
};

export const flatten: Tool = {
  id: 'flatten',
  name: 'Aplatir formulaires',
  icon: 'flatten',
  category: 'edit',
  description: 'Fige les champs de formulaire remplis en contenu non modifiable.',
  accept: 'pdf',
  multiple: false,
  outputsPdf: true,
  options: [],
  async run(files) {
    const doc = await loadPdf(files[0]);
    try {
      doc.getForm().flatten();
    } catch (e: any) {
      throw new Error(`Aplatissement impossible : ${e?.message ?? e}`);
    }
    return out(files[0], 'aplati', await doc.save({ useObjectStreams: true }));
  },
};

export const metadata: Tool = {
  id: 'metadata',
  name: 'Métadonnées',
  icon: 'metadata',
  category: 'security',
  description: 'Modifiez ou effacez titre, auteur, mots-clés… avant de partager un document.',
  accept: 'pdf',
  multiple: false,
  outputsPdf: true,
  options: [
    { key: 'strip', label: 'Tout effacer (anonymiser)', type: 'checkbox', default: true },
    { key: 'title', label: 'Titre', type: 'text', default: '' },
    { key: 'author', label: 'Auteur', type: 'text', default: '' },
    { key: 'subject', label: 'Sujet', type: 'text', default: '' },
    { key: 'keywords', label: 'Mots-clés (séparés par des virgules)', type: 'text', default: '' },
  ],
  async run(files, o) {
    const doc = await PDFDocument.load(await readBytes(files[0]), { ignoreEncryption: true, updateMetadata: false });
    doc.setTitle(o.strip ? '' : o.title);
    doc.setAuthor(o.strip ? '' : o.author);
    doc.setSubject(o.strip ? '' : o.subject);
    doc.setKeywords(o.strip || !o.keywords ? [] : String(o.keywords).split(',').map((s: string) => s.trim()));
    doc.setCreator('');
    doc.setProducer(o.strip ? '' : 'All With PDF');
    return out(files[0], o.strip ? 'anonyme' : 'meta', await doc.save({ useObjectStreams: true }));
  },
};

export const nUp: Tool = {
  id: 'n-up',
  name: 'Pages par feuille',
  icon: 'nup',
  category: 'organize',
  description: 'Imprimez plusieurs pages sur une même feuille (2, 4, 6, 9… vignettes).',
  accept: 'pdf',
  multiple: false,
  outputsPdf: true,
  options: [
    { key: 'cols', label: 'Colonnes', type: 'number', default: 2, min: 1, max: 6 },
    { key: 'rows', label: 'Lignes', type: 'number', default: 2, min: 1, max: 6 },
    { key: 'sheet', label: 'Feuille', type: 'select', default: 'a4l', choices: [{ value: 'a4p', label: 'A4 portrait' }, { value: 'a4l', label: 'A4 paysage' }, { value: 'a3l', label: 'A3 paysage' }] },
    { key: 'gap', label: 'Espace (mm)', type: 'number', default: 4, min: 0, max: 30 },
    { key: 'border', label: 'Cadre autour des pages', type: 'checkbox', default: true },
  ],
  async run(files, o) {
    const src = await loadPdf(files[0]);
    const doc = await PDFDocument.create();
    const emb = await doc.embedPdf(src, src.getPageIndices());
    const [sw, sh] = { a4p: [595.28, 841.89], a4l: [841.89, 595.28], a3l: [1190.55, 841.89] }[o.sheet as 'a4p'];
    const gap = mmToPt(o.gap);
    const per = o.cols * o.rows;
    const cw = (sw - gap * (o.cols + 1)) / o.cols;
    const ch = (sh - gap * (o.rows + 1)) / o.rows;
    for (let s = 0; s < emb.length; s += per) {
      const sheet = doc.addPage([sw, sh]);
      for (let k = 0; k < per && s + k < emb.length; k++) {
        const e = emb[s + k];
        const col_ = k % o.cols, row = Math.floor(k / o.cols);
        const sc = Math.min(cw / e.width, ch / e.height);
        const w = e.width * sc, h = e.height * sc;
        const x = gap + col_ * (cw + gap) + (cw - w) / 2;
        const y = sh - gap - (row + 1) * ch - row * gap + (ch - h) / 2;
        sheet.drawPage(e, { x, y, width: w, height: h });
        if (o.border) sheet.drawRectangle({ x, y, width: w, height: h, borderColor: rgb(0.6, 0.6, 0.6), borderWidth: 0.5 });
      }
    }
    return out(files[0], `${o.cols * o.rows}-par-feuille`, await doc.save({ useObjectStreams: true }));
  },
};

export const editor: Tool = {
  id: 'editor',
  name: 'Éditer & signer PDF',
  icon: 'editor',
  category: 'edit',
  description: 'Éditeur visuel : texte, formes, surlignage, dessin, images, signature manuscrite, blanc de correction et caviardage définitif.',
  accept: 'pdf',
  multiple: false,
  outputsPdf: true,
  custom: 'editor',
  needsBrowser: true,
  options: [],
  async run() {
    throw new Error('Cet outil utilise une interface dédiée.');
  },
};
