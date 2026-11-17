import { PDFDocument } from 'pdf-lib';
import { PDF_MIME, type Options, type Tool } from '../core/types';
import { baseName, mmToPt, parsePages, readBytes } from '../core/util';
import { canvasToBlob, makeCanvas, openPdf, pageLines, renderPageToCanvas } from '../core/pdfjs';

const PAGE_SIZES: Record<string, [number, number]> = { a4: [595.28, 841.89], letter: [612, 792], a3: [841.89, 1190.55], a5: [419.53, 595.28] };

async function imageToEmbeddable(f: File, enhance: boolean, quality: number): Promise<{ kind: 'jpg' | 'png'; bytes: Uint8Array; w: number; h: number }> {
  const raw = await readBytes(f);
  if (typeof createImageBitmap === 'undefined') {
    // Hors navigateur (tests) : intégration directe
    const isPng = f.type === 'image/png' || /\.png$/i.test(f.name);
    return { kind: isPng ? 'png' : 'jpg', bytes: raw, w: 0, h: 0 };
  }
  const bmp = await createImageBitmap(f, { imageOrientation: 'from-image' } as ImageBitmapOptions);
  const c = makeCanvas(bmp.width, bmp.height);
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, c.width, c.height);
  if (enhance) ctx.filter = 'grayscale(1) contrast(1.35) brightness(1.08)';
  ctx.drawImage(bmp, 0, 0);
  const w = bmp.width, h = bmp.height;
  bmp.close();
  const hasAlpha = f.type === 'image/png' && !enhance;
  const blob = await canvasToBlob(c, hasAlpha ? 'image/png' : 'image/jpeg', quality);
  return { kind: hasAlpha ? 'png' : 'jpg', bytes: new Uint8Array(await blob.arrayBuffer()), w, h };
}

async function imagesToPdf(files: File[], o: Options, progress: (r: number, m?: string) => void) {
  const doc = await PDFDocument.create();
  for (let i = 0; i < files.length; i++) {
    const im = await imageToEmbeddable(files[i], !!o.enhance, o.quality ?? 0.9);
    const emb = im.kind === 'png' ? await doc.embedPng(im.bytes) : await doc.embedJpg(im.bytes);
    const iw = emb.width, ih = emb.height;
    const margin = mmToPt(o.margin ?? 0);
    let pw: number, ph: number;
    if (o.size === 'fit') {
      pw = iw * 0.75 + margin * 2;
      ph = ih * 0.75 + margin * 2;
    } else {
      [pw, ph] = PAGE_SIZES[o.size] ?? PAGE_SIZES.a4;
      const landscape = o.orientation === 'landscape' || (o.orientation === 'auto' && iw > ih);
      if (landscape) [pw, ph] = [ph, pw];
    }
    const page = doc.addPage([pw, ph]);
    const k = Math.min((pw - margin * 2) / iw, (ph - margin * 2) / ih);
    const w = iw * k, h = ih * k;
    page.drawImage(emb, { x: (pw - w) / 2, y: (ph - h) / 2, width: w, height: h });
    progress((i + 1) / files.length, files[i].name);
  }
  return doc.save({ useObjectStreams: true });
}

const imgOptions = (enhanceDefault: boolean) => [
  { key: 'size', label: 'Format de page', type: 'select' as const, default: 'a4', choices: [
    { value: 'fit', label: 'Taille de l\'image' }, { value: 'a4', label: 'A4' }, { value: 'a3', label: 'A3' }, { value: 'a5', label: 'A5' }, { value: 'letter', label: 'Letter' } ] },
  { key: 'orientation', label: 'Orientation', type: 'select' as const, default: 'auto', choices: [
    { value: 'auto', label: 'Automatique' }, { value: 'portrait', label: 'Portrait' }, { value: 'landscape', label: 'Paysage' } ] },
  { key: 'margin', label: 'Marge (mm)', type: 'number' as const, default: 0, min: 0, max: 50 },
  { key: 'quality', label: 'Qualité JPEG (0.3 – 1)', type: 'number' as const, default: 0.9, min: 0.3, max: 1, step: 0.05 },
  { key: 'enhance', label: 'Mode scan (niveaux de gris + contraste)', type: 'checkbox' as const, default: enhanceDefault },
];

export const imageToPdf: Tool = {
  id: 'image-to-pdf',
  name: 'Image vers PDF',
  icon: 'image',
  category: 'to-pdf',
  description: 'JPG, PNG, WebP, GIF, BMP… en un seul PDF, dans l\'ordre de votre choix.',
  accept: 'image',
  multiple: true,
  outputsPdf: true,
  options: imgOptions(false),
  async run(files, o, progress) {
    return [{ name: 'images.pdf', data: await imagesToPdf(files, o, progress), mime: PDF_MIME }];
  },
};

export const scanToPdf: Tool = {
  id: 'scan-to-pdf',
  name: 'Scanner vers PDF',
  icon: 'scan',
  category: 'organize',
  description: 'Photographiez ou importez vos documents : redressement des contrastes et PDF propre en un clic.',
  accept: 'image',
  multiple: true,
  outputsPdf: true,
  options: imgOptions(true),
  async run(files, o, progress) {
    return [{ name: 'scan.pdf', data: await imagesToPdf(files, o, progress), mime: PDF_MIME }];
  },
};

export const pdfToImage: Tool = {
  id: 'pdf-to-image',
  name: 'PDF vers image',
  icon: 'image',
  category: 'from-pdf',
  description: 'Chaque page en JPG, PNG ou WebP, résolution jusqu\'à 600 dpi.',
  accept: 'pdf',
  multiple: false,
  outputsPdf: false,
  needsBrowser: true,
  options: [
    { key: 'format', label: 'Format', type: 'select', default: 'jpeg', choices: [{ value: 'jpeg', label: 'JPG' }, { value: 'png', label: 'PNG (transparence non gérée)' }, { value: 'webp', label: 'WebP' }] },
    { key: 'dpi', label: 'Résolution (dpi)', type: 'number', default: 150, min: 30, max: 600 },
    { key: 'quality', label: 'Qualité (JPG/WebP)', type: 'number', default: 0.92, min: 0.3, max: 1, step: 0.02 },
    { key: 'pages', label: 'Pages (vide = toutes)', type: 'text', default: '' },
  ],
  async run(files, o, progress) {
    const f = files[0];
    const pdf = await openPdf(await readBytes(f));
    const idx = parsePages(o.pages, pdf.numPages);
    const ext = o.format === 'jpeg' ? 'jpg' : o.format;
    const pad = String(pdf.numPages).length;
    const out = [];
    for (let k = 0; k < idx.length; k++) {
      const page = await pdf.getPage(idx[k] + 1);
      const canvas = await renderPageToCanvas(page, o.dpi / 72);
      const blob = await canvasToBlob(canvas, `image/${o.format}`, o.quality);
      out.push({ name: `${baseName(f.name)}_page${String(idx[k] + 1).padStart(pad, '0')}.${ext}`, data: blob, mime: `image/${o.format}` });
      page.cleanup();
      progress((k + 1) / idx.length, `Page ${idx[k] + 1}`);
    }
    return out;
  },
};

async function extractText(f: File, pagesSpec: string, progress: (r: number) => void, markdown: boolean) {
  const pdf = await openPdf(await readBytes(f));
  const idx = parsePages(pagesSpec, pdf.numPages);
  const pagesLines = [];
  for (let k = 0; k < idx.length; k++) {
    pagesLines.push(await pageLines(await pdf.getPage(idx[k] + 1)));
    progress((k + 1) / idx.length);
  }
  if (!markdown) return pagesLines.map((l, i) => `${idx.length > 1 ? `--- Page ${idx[i] + 1} ---\n` : ''}${l.map((x) => x.text).join('\n')}`).join('\n\n');

  const sizes = pagesLines.flat().map((l) => l.size).sort((a, b) => a - b);
  const body = sizes[Math.floor(sizes.length / 2)] || 10;
  const out: string[] = [];
  for (const lines of pagesLines) {
    let para: string[] = [];
    const flush = () => { if (para.length) out.push(para.join(' ')); para = []; };
    let prevY = 0;
    for (const l of lines) {
      const ratio = l.size / body;
      const gap = prevY ? Math.abs(prevY - l.y) : 0;
      prevY = l.y;
      if (ratio >= 1.6) { flush(); out.push(`# ${l.text}`); }
      else if (ratio >= 1.3) { flush(); out.push(`## ${l.text}`); }
      else if (ratio >= 1.12) { flush(); out.push(`### ${l.text}`); }
      else if (/^[•▪◦‣\-–*]\s+/.test(l.text)) { flush(); out.push(`- ${l.text.replace(/^[•▪◦‣\-–*]\s+/, '')}`); }
      else if (/^\d+[.)]\s+/.test(l.text)) { flush(); out.push(l.text.replace(/^(\d+)[.)]\s+/, '$1. ')); }
      else {
        if (gap > l.size * 1.9) flush();
        para.push(l.text);
      }
    }
    flush();
  }
  return out.join('\n\n');
}

export const pdfToText: Tool = {
  id: 'pdf-to-text',
  name: 'PDF vers texte',
  icon: 'text',
  category: 'from-pdf',
  description: 'Extrait tout le texte en .txt, dans l\'ordre de lecture.',
  accept: 'pdf',
  multiple: false,
  outputsPdf: false,
  needsBrowser: true,
  options: [{ key: 'pages', label: 'Pages (vide = toutes)', type: 'text', default: '' }],
  async run(files, o, progress) {
    const text = await extractText(files[0], o.pages, progress, false);
    return [{ name: `${baseName(files[0].name)}.txt`, data: new TextEncoder().encode(text), mime: 'text/plain' }];
  },
};

export const pdfToMarkdown: Tool = {
  id: 'pdf-to-markdown',
  name: 'PDF vers Markdown',
  icon: 'markdown',
  category: 'intelligence',
  description: 'Texte structuré (titres, listes, paragraphes) prêt pour une IA, une doc ou un wiki.',
  accept: 'pdf',
  multiple: false,
  outputsPdf: false,
  needsBrowser: true,
  options: [{ key: 'pages', label: 'Pages (vide = toutes)', type: 'text', default: '' }],
  async run(files, o, progress) {
    const text = await extractText(files[0], o.pages, progress, true);
    return [{ name: `${baseName(files[0].name)}.md`, data: new TextEncoder().encode(text), mime: 'text/markdown' }];
  },
};
