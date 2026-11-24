/**
 * Accès à pdf.js : build standard dans le navigateur, build « legacy » sous Node (tests).
 */
type PdfjsModule = typeof import('pdfjs-dist');
let lib: Promise<PdfjsModule> | null = null;

export function getPdfjs(): Promise<PdfjsModule> {
  lib ??= (async () => {
    if (typeof window === 'undefined') {
      // @ts-ignore build legacy sans types dédiés
      return (await import('pdfjs-dist/legacy/build/pdf.mjs')) as PdfjsModule;
    }
    const m = await import('pdfjs-dist');
    const w = await import('pdfjs-dist/build/pdf.worker.min.mjs?url');
    m.GlobalWorkerOptions.workerSrc = w.default;
    return m;
  })();
  return lib;
}

export async function openPdf(bytes: Uint8Array, password?: string) {
  const pdfjs = await getPdfjs();
  // pdf.js « consomme » le buffer : on lui passe une copie
  const base = typeof document !== 'undefined' ? new URL('pdfjs/', document.baseURI).href : undefined;
  return pdfjs.getDocument({
    data: bytes.slice(),
    password,
    fontExtraProperties: true,
    ...(base ? { standardFontDataUrl: `${base}standard_fonts/`, cMapUrl: `${base}cmaps/`, cMapPacked: true } : {}),
  }).promise;
}

export function makeCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.floor(w));
  c.height = Math.max(1, Math.floor(h));
  return c;
}

export async function renderPageToCanvas(page: any, scale: number, background = '#ffffff'): Promise<HTMLCanvasElement> {
  const viewport = page.getViewport({ scale });
  const canvas = makeCanvas(viewport.width, viewport.height);
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: ctx, canvas, viewport }).promise;
  return canvas;
}

export const canvasToBlob = (c: HTMLCanvasElement, type = 'image/jpeg', quality = 0.9) =>
  new Promise<Blob>((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('Export canvas impossible'))), type, quality));

export interface TextLine {
  text: string;
  y: number;
  size: number;
  x: number;
}

export interface TextCell { text: string; x: number }
/** Lignes découpées en cellules (colonnes) d'après les écarts horizontaux : base de l'extraction de tableaux. */
export async function pageRows(page: any): Promise<{ y: number; cells: TextCell[] }[]> {
  const content = await page.getTextContent();
  const rows: { y: number; items: { x: number; str: string; size: number; w: number }[] }[] = [];
  for (const it of content.items as any[]) {
    if (!('str' in it) || !it.str.trim()) continue;
    const [, , , d, x, y] = it.transform as number[];
    const size = Math.abs(d) || 10;
    let row = rows.find((r) => Math.abs(r.y - y) < size * 0.4);
    if (!row) rows.push((row = { y, items: [] }));
    row.items.push({ x, str: it.str, size, w: it.width ?? 0 });
  }
  rows.sort((a, b) => b.y - a.y);
  return rows.map((r) => {
    r.items.sort((a, b) => a.x - b.x);
    const cells: TextCell[] = [];
    let prevEnd = -Infinity;
    for (const i of r.items) {
      const last = cells[cells.length - 1];
      if (last && i.x - prevEnd < Math.max(6, i.size * 0.9)) last.text += (i.x - prevEnd > i.size * 0.15 ? ' ' : '') + i.str;
      else cells.push({ text: i.str, x: i.x });
      prevEnd = i.x + i.w;
    }
    return { y: r.y, cells };
  });
}

/** Regroupe les fragments de texte d'une page en lignes (ordre de lecture). */
export async function pageLines(page: any): Promise<TextLine[]> {
  const content = await page.getTextContent();
  const rows: { y: number; items: { x: number; str: string; size: number; w: number }[] }[] = [];
  for (const it of content.items as any[]) {
    if (!('str' in it) || !it.str) continue;
    const [, , , d, x, y] = it.transform as number[];
    const size = Math.abs(d) || it.height || 10;
    let row = rows.find((r) => Math.abs(r.y - y) < size * 0.4);
    if (!row) rows.push((row = { y, items: [] }));
    row.items.push({ x, str: it.str, size, w: it.width ?? 0 });
  }
  rows.sort((a, b) => b.y - a.y);
  return rows.map((r) => {
    r.items.sort((a, b) => a.x - b.x);
    let text = '';
    let prevEnd = -Infinity;
    for (const i of r.items) {
      if (text && i.x - prevEnd > i.size * 0.15 && !text.endsWith(' ') && !i.str.startsWith(' ')) text += ' ';
      text += i.str;
      prevEnd = i.x + i.w;
    }
    const size = Math.max(...r.items.map((i) => i.size));
    return { text: text.trim(), y: r.y, size, x: r.items[0].x };
  }).filter((l) => l.text);
}
