import { PDFArray, PDFDocument, PDFName, PDFNumber, PDFRawStream } from 'pdf-lib';
import { PDF_MIME, type Tool } from '../core/types';
import { baseName, formatBytes, parsePages, readBytes } from '../core/util';
import { canvasToBlob, makeCanvas, openPdf, renderPageToCanvas } from '../core/pdfjs';
import { loadPdf } from './organize';

const N = (s: string) => PDFName.of(s);

/** Recompresse les images JPEG intégrées (le texte et les vecteurs restent intacts). */
async function recompressImages(doc: PDFDocument, quality: number, scale: number, progress: (r: number) => void) {
  const entries = [...doc.context.enumerateIndirectObjects()].filter(([, o]) => {
    if (!(o instanceof PDFRawStream)) return false;
    if (o.dict.get(N('Subtype')) !== N('Image')) return false;
    const f = o.dict.get(N('Filter'));
    return f === N('DCTDecode') || (f instanceof PDFArray && f.size() === 1 && f.get(0) === N('DCTDecode'));
  });
  let done = 0;
  let saved = 0;
  for (const [ref, obj] of entries) {
    const stream = obj as PDFRawStream;
    const d = stream.dict;
    const im = d.get(N('ImageMask'));
    const before = stream.getContents().byteLength;
    done++;
    progress(done / entries.length);
    if (before < 4096 || (im && String(im) === 'true')) continue;
    try {
      const w = (d.get(N('Width')) as PDFNumber).asNumber();
      const h = (d.get(N('Height')) as PDFNumber).asNumber();
      const bmp = await createImageBitmap(new Blob([stream.getContents() as BlobPart], { type: 'image/jpeg' }));
      const nw = Math.max(1, Math.round(w * scale));
      const nh = Math.max(1, Math.round(h * scale));
      const c = makeCanvas(nw, nh);
      const ctx = c.getContext('2d')!;
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, nw, nh);
      ctx.drawImage(bmp, 0, 0, nw, nh);
      bmp.close();
      const blob = await canvasToBlob(c, 'image/jpeg', quality);
      const bytes = new Uint8Array(await blob.arrayBuffer());
      if (bytes.byteLength >= before * 0.95) continue;
      const nd = d.clone();
      nd.set(N('Width'), PDFNumber.of(nw));
      nd.set(N('Height'), PDFNumber.of(nh));
      nd.set(N('ColorSpace'), N('DeviceRGB'));
      nd.set(N('BitsPerComponent'), PDFNumber.of(8));
      nd.set(N('Filter'), N('DCTDecode'));
      nd.delete(N('Decode'));
      nd.delete(N('DecodeParms'));
      doc.context.assign(ref, PDFRawStream.of(nd, bytes));
      saved += before - bytes.byteLength;
    } catch {
      /* image exotique : on la laisse telle quelle */
    }
  }
  return { count: entries.length, saved };
}

export const compress: Tool = {
  id: 'compress',
  name: 'Compresser PDF',
  icon: '🗜️',
  category: 'optimize',
  description: 'Réduisez le poids : recompression des images (texte conservé) ou rasterisation totale pour un gain maximal.',
  accept: 'pdf',
  multiple: false,
  outputsPdf: true,
  needsBrowser: true,
  options: [
    {
      key: 'level', label: 'Niveau', type: 'select', default: 'recommended',
      choices: [
        { value: 'low', label: 'Léger (qualité maximale)' },
        { value: 'recommended', label: 'Recommandé' },
        { value: 'extreme', label: 'Extrême (images réduites)' },
        { value: 'rasterize', label: 'Rasterisation totale (perd le texte sélectionnable)' },
      ],
    },
    { key: 'dpi', label: 'Résolution (rasterisation)', type: 'number', default: 110, min: 40, max: 300 },
  ],
  async run(files, o, progress) {
    const f = files[0];
    const bytes = await readBytes(f);
    let out: Uint8Array;
    let note = '';
    if (o.level === 'rasterize') {
      const pdf = await openPdf(bytes);
      const doc = await PDFDocument.create();
      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const base = page.getViewport({ scale: 1 });
        const canvas = await renderPageToCanvas(page, Math.max(0.3, o.dpi / 72));
        const jpg = await doc.embedJpg(new Uint8Array(await (await canvasToBlob(canvas, 'image/jpeg', 0.6)).arrayBuffer()));
        const p = doc.addPage([base.width, base.height]);
        p.drawImage(jpg, { x: 0, y: 0, width: base.width, height: base.height });
        page.cleanup();
        progress(i / pdf.numPages, `Page ${i}/${pdf.numPages}`);
      }
      out = await doc.save({ useObjectStreams: true });
    } else {
      const q = { low: [0.82, 1], recommended: [0.62, 0.8], extreme: [0.42, 0.55] }[o.level as 'low'] ?? [0.62, 0.8];
      const doc = await loadPdf(f);
      const r = await recompressImages(doc, q[0], q[1], (x) => progress(x * 0.9, 'Images'));
      out = await doc.save({ useObjectStreams: true });
      note = r.count ? `${r.count} image(s) JPEG analysée(s), ${formatBytes(r.saved)} gagnés sur les images.` : 'Aucune image JPEG à recompresser : essayez la rasterisation totale.';
    }
    if (out.byteLength >= bytes.byteLength) {
      return [{ name: f.name, data: bytes, mime: PDF_MIME, note: 'Le fichier est déjà optimisé : l\'original est conservé.' }];
    }
    const pct = Math.round((1 - out.byteLength / bytes.byteLength) * 100);
    return [{ name: `${baseName(f.name)}_compresse.pdf`, data: out, mime: PDF_MIME, note: `${formatBytes(bytes.byteLength)} → ${formatBytes(out.byteLength)} (−${pct} %). ${note}` }];
  },
};

/** Charge un PDF abîmé : tel quel, puis en coupant progressivement après les derniers « endobj » (fichiers tronqués). */
async function tolerantLoad(bytes: Uint8Array): Promise<{ doc: PDFDocument; cut: boolean } | null> {
  const opts = { ignoreEncryption: true, throwOnInvalidObject: false, updateMetadata: false } as const;
  try {
    return { doc: await PDFDocument.load(bytes, opts), cut: false };
  } catch { /* on tente la reconstruction */ }
  const text = new TextDecoder('latin1').decode(bytes);
  let pos = text.length;
  for (let attempt = 0; attempt < 40; attempt++) {
    pos = text.lastIndexOf('endobj', pos - 1);
    if (pos < 0) break;
    try {
      const doc = await PDFDocument.load(bytes.slice(0, pos + 6), opts);
      if (doc.getPageCount() > 0) return { doc, cut: true };
    } catch { /* essai suivant */ }
  }
  return null;
}

export const repair: Tool = {
  id: 'repair',
  name: 'Réparer PDF',
  icon: '🩹',
  category: 'optimize',
  description: 'Reconstruit un PDF endommagé ou tronqué en récupérant toutes les pages lisibles.',
  accept: 'pdf',
  multiple: false,
  outputsPdf: true,
  options: [],
  async run(files) {
    const f = files[0];
    const bytes = await readBytes(f);
    const found = await tolerantLoad(bytes);
    if (found) {
      const { doc: src, cut } = found;
      const out = await PDFDocument.create();
      let ok = 0;
      for (const i of src.getPageIndices()) {
        try {
          const [p] = await out.copyPages(src, [i]);
          out.addPage(p);
          ok++;
        } catch { /* page irrécupérable */ }
      }
      if (ok) {
        return [{ name: `${baseName(f.name)}_repare.pdf`, data: await out.save({ useObjectStreams: true }), mime: PDF_MIME, note: `${ok}/${src.getPageCount()} page(s) récupérée(s)${cut ? ' (fin de fichier tronquée reconstruite)' : ''}.` }];
      }
    }
    // Dernier recours : pdf.js (très tolérant) → pages reconstruites en images
    try {
      const pdf = await openPdf(bytes);
      const out = await PDFDocument.create();
      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const vp = page.getViewport({ scale: 1 });
        const canvas = await renderPageToCanvas(page, 2);
        const img = await out.embedJpg(new Uint8Array(await (await canvasToBlob(canvas, 'image/jpeg', 0.85)).arrayBuffer()));
        out.addPage([vp.width, vp.height]).drawImage(img, { x: 0, y: 0, width: vp.width, height: vp.height });
      }
      return [{ name: `${baseName(f.name)}_repare.pdf`, data: await out.save(), mime: PDF_MIME, note: 'Structure irrécupérable : les pages ont été reconstruites en images (texte non sélectionnable).' }];
    } catch (e: any) {
      throw new Error(`Réparation impossible : fichier trop endommagé (${e?.message ?? e}).`);
    }
  },
};

export const ocr: Tool = {
  id: 'ocr',
  name: 'OCR PDF',
  icon: '🔎',
  category: 'optimize',
  description: 'Rend un PDF scanné recherchable et copiable (reconnaissance de texte locale, multilingue).',
  accept: 'pdf',
  multiple: false,
  outputsPdf: true,
  needsBrowser: true,
  options: [
    {
      key: 'lang', label: 'Langue(s)', type: 'select', default: 'fra+eng',
      choices: [
        { value: 'fra+eng', label: 'Français + Anglais' },
        { value: 'fra', label: 'Français' },
        { value: 'eng', label: 'Anglais' },
        { value: 'deu', label: 'Allemand' },
        { value: 'spa', label: 'Espagnol' },
        { value: 'ita', label: 'Italien' },
        { value: 'por', label: 'Portugais' },
        { value: 'nld', label: 'Néerlandais' },
        { value: 'ara', label: 'Arabe' },
        { value: 'rus', label: 'Russe' },
      ],
    },
    { key: 'dpi', label: 'Résolution d\'analyse', type: 'number', default: 200, min: 100, max: 400 },
    { key: 'pages', label: 'Pages (vide = toutes)', type: 'text', default: '' },
  ],
  async run(files, o, progress) {
    const f = files[0];
    const pdf = await openPdf(await readBytes(f));
    const idx = parsePages(o.pages, pdf.numPages);
    const { createWorker } = await import('tesseract.js');
    let current = 0;
    const worker = await createWorker(String(o.lang).split('+'), 1, {
      logger: (m: any) => {
        if (m.status === 'recognizing text') progress((current + m.progress) / idx.length, `Page ${current + 1}/${idx.length}`);
        else if (m.progress != null) progress(0, `Chargement du moteur OCR (${m.status})…`);
      },
    });
    const out = await PDFDocument.create();
    try {
      for (let k = 0; k < idx.length; k++) {
        current = k;
        const page = await pdf.getPage(idx[k] + 1);
        const base = page.getViewport({ scale: 1 });
        const canvas = await renderPageToCanvas(page, o.dpi / 72);
        const { data } = await worker.recognize(canvas, {}, { pdf: true });
        const ocrPdf = await PDFDocument.load(new Uint8Array(data.pdf as ArrayLike<number> as any));
        const [emb] = await out.embedPdf(ocrPdf, [0]);
        const p = out.addPage([base.width, base.height]);
        p.drawPage(emb, { x: 0, y: 0, width: base.width, height: base.height });
        page.cleanup();
      }
    } finally {
      await worker.terminate();
    }
    return [{ name: `${baseName(f.name)}_ocr.pdf`, data: await out.save({ useObjectStreams: true }), mime: PDF_MIME, note: 'Pages converties en images avec une couche de texte invisible (recherche et copier-coller).' }];
  },
};
