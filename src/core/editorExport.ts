import { PDFDocument, StandardFonts, degrees, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import { hexToRgb01 } from './util';
import { canvasToBlob, makeCanvas, openPdf, renderPageToCanvas } from './pdfjs';

export type AnnType = 'text' | 'rect' | 'ellipse' | 'highlight' | 'whiteout' | 'redact' | 'draw' | 'image';
export interface Ann {
  id: string;
  page: number; // 0-based
  type: AnnType;
  /** Boîte en fractions de la page affichée (origine en haut à gauche) */
  x: number; y: number; w: number; h: number;
  text?: string;
  size?: number; // pt (texte) ou épaisseur de trait (pt)
  color?: string;
  fill?: boolean;
  pts?: [number, number][]; // dessin : points en fractions de la boîte
  img?: string; // dataURL PNG
}

const c3 = (hex: string) => { const [r, g, b] = hexToRgb01(hex); return rgb(r, g, b); };

function wrap(text: string, font: PDFFont, size: number, maxW: number): string[] {
  const out: string[] = [];
  for (const para of text.split('\n')) {
    let line = '';
    for (const word of para.split(' ')) {
      const test = line ? `${line} ${word}` : word;
      if (line && font.widthOfTextAtSize(test, size) > maxW) { out.push(line); line = word; } else line = test;
    }
    out.push(line);
  }
  return out;
}

async function textToPng(lines: string[], size: number, color: string) {
  const k = 3;
  const c = makeCanvas(Math.max(10, Math.max(...lines.map((l) => l.length)) * size * 0.65 * k), lines.length * size * 1.25 * k);
  const ctx = c.getContext('2d')!;
  ctx.font = `${size * k}px Helvetica, Arial, sans-serif`;
  ctx.fillStyle = color;
  ctx.textBaseline = 'top';
  lines.forEach((l, i) => ctx.fillText(l, 0, i * size * 1.2 * k));
  const w = Math.ceil(Math.max(...lines.map((l) => ctx.measureText(l).width)));
  const t = makeCanvas(Math.max(1, w), c.height);
  t.getContext('2d')!.drawImage(c, 0, 0);
  return { bytes: new Uint8Array(await (await canvasToBlob(t, 'image/png')).arrayBuffer()), ratio: t.width / k };
}

export async function exportAnnotated(bytes: Uint8Array, anns: Ann[], progress: (r: number) => void = () => {}): Promise<Uint8Array> {
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const needsRaster = anns.some((a) => a.type === 'redact');
  const pdfjsDoc = needsRaster ? await openPdf(bytes) : null;
  const count = doc.getPageCount();

  for (let i = 0; i < count; i++) {
    const list = anns.filter((a) => a.page === i);
    if (!list.length) continue;
    let page: PDFPage = doc.getPage(i);
    const rot = ((page.getRotation().angle % 360) + 360) % 360;
    const { width: W, height: H } = page.getSize();
    const [dw, dh] = rot % 180 === 0 ? [W, H] : [H, W];
    const hasRedact = list.some((a) => a.type === 'redact');

    if (hasRedact && pdfjsDoc) {
      // Caviardage définitif : la page est rasterisée avec les boîtes noires incrustées
      const pj = await pdfjsDoc.getPage(i + 1);
      const scale = 2.5;
      const canvas = await renderPageToCanvas(pj, scale);
      const ctx = canvas.getContext('2d')!;
      ctx.fillStyle = '#000';
      for (const a of list.filter((x) => x.type === 'redact')) ctx.fillRect(a.x * canvas.width, a.y * canvas.height, a.w * canvas.width, a.h * canvas.height);
      const img = await doc.embedJpg(new Uint8Array(await (await canvasToBlob(canvas, 'image/jpeg', 0.9)).arrayBuffer()));
      const np = doc.insertPage(i, [dw, dh]);
      doc.removePage(i + 1);
      np.drawImage(img, { x: 0, y: 0, width: dw, height: dh });
      page = np;
      pj.cleanup();
    } else if (rot !== 0) {
      // On « fige » la rotation pour pouvoir dessiner en coordonnées d'affichage
      const emb = await doc.embedPage(page);
      const np = doc.insertPage(i, [dw, dh]);
      doc.removePage(i + 1);
      if (rot === 90) np.drawPage(emb, { x: 0, y: W, rotate: degrees(-90) });
      else if (rot === 180) np.drawPage(emb, { x: W, y: H, rotate: degrees(180) });
      else np.drawPage(emb, { x: H, y: 0, rotate: degrees(90) });
      page = np;
    }

    for (const a of list) {
      const x = a.x * dw, w = a.w * dw, h = a.h * dh;
      const y = dh - a.y * dh - h; // coin bas-gauche
      const color = c3(a.color ?? '#000000');
      switch (a.type) {
        case 'redact': break; // déjà incrusté dans l'image
        case 'whiteout': page.drawRectangle({ x, y, width: w, height: h, color: rgb(1, 1, 1) }); break;
        case 'highlight': page.drawRectangle({ x, y, width: w, height: h, color, opacity: 0.35 }); break;
        case 'rect': page.drawRectangle({ x, y, width: w, height: h, borderColor: color, borderWidth: a.size ?? 2, ...(a.fill ? { color } : {}) }); break;
        case 'ellipse': page.drawEllipse({ x: x + w / 2, y: y + h / 2, xScale: w / 2, yScale: h / 2, borderColor: color, borderWidth: a.size ?? 2, ...(a.fill ? { color } : {}) }); break;
        case 'draw': {
          const pts = (a.pts ?? []).map(([px, py]) => [x + px * w, y + (1 - py) * h] as const);
          for (let k = 1; k < pts.length; k++) page.drawLine({ start: { x: pts[k - 1][0], y: pts[k - 1][1] }, end: { x: pts[k][0], y: pts[k][1] }, thickness: a.size ?? 2, color, lineCap: 1 });
          break;
        }
        case 'image': {
          if (!a.img) break;
          const img = await doc.embedPng(a.img);
          page.drawImage(img, { x, y, width: w, height: h });
          break;
        }
        case 'text': {
          const size = a.size ?? 14;
          const text = a.text ?? '';
          if (!text.trim()) break;
          let ok = true;
          try { font.encodeText(text); } catch { ok = false; }
          if (ok) {
            wrap(text, font, size, w).forEach((line, k) => page.drawText(line, { x, y: y + h - size * 0.95 - k * size * 1.2, size, font, color }));
          } else {
            const lines = text.split('\n');
            const { bytes: png, ratio } = await textToPng(lines, size, a.color ?? '#000000');
            const img = await doc.embedPng(png);
            const th = lines.length * size * 1.2;
            page.drawImage(img, { x, y: y + h - th, width: ratio, height: th });
          }
          break;
        }
      }
    }
    progress((i + 1) / count);
  }
  return doc.save({ useObjectStreams: true });
}
