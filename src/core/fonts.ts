import { PDFDict, PDFDocument, PDFName, PDFNumber, PDFRawStream, PDFRef, decodePDFRawStream } from 'pdf-lib';

export interface FontInfo { family: string; bold: boolean; italic: boolean; mono: boolean; serif: boolean }

/** Lit le nom, le poids et l'italique dans la table « name »/« OS/2 » d'une police TrueType/OpenType incorporée. */
function sfntInfo(b: Uint8Array): { family?: string; sub?: string; weight?: number; italic?: boolean } {
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  if (b.length < 12) return {};
  const n = dv.getUint16(4);
  const tables: Record<string, [number, number]> = {};
  for (let i = 0; i < n; i++) {
    const o = 12 + i * 16; if (o + 16 > b.length) break;
    tables[String.fromCharCode(b[o], b[o + 1], b[o + 2], b[o + 3])] = [dv.getUint32(o + 8), dv.getUint32(o + 12)];
  }
  const out: { family?: string; sub?: string; weight?: number; italic?: boolean } = {};
  const nm = tables['name'];
  if (nm && nm[0] + 6 <= b.length) {
    const count = dv.getUint16(nm[0] + 2), so = nm[0] + dv.getUint16(nm[0] + 4);
    const names: Record<number, string> = {};
    for (let i = 0; i < count; i++) {
      const r = nm[0] + 6 + i * 12; if (r + 12 > b.length) break;
      const plat = dv.getUint16(r), id = dv.getUint16(r + 6), len = dv.getUint16(r + 8), off = so + dv.getUint16(r + 10);
      if (off + len > b.length) continue;
      let s = '';
      if (plat === 3 || plat === 0) for (let k = 0; k + 1 < len; k += 2) s += String.fromCharCode(dv.getUint16(off + k));
      else for (let k = 0; k < len; k++) s += String.fromCharCode(b[off + k]);
      if (s && (plat === 3 || !names[id])) names[id] = s;
    }
    out.family = names[16] || names[1]; out.sub = names[17] || names[2];
  }
  const os = tables['OS/2'];
  if (os && os[0] + 64 <= b.length) { out.weight = dv.getUint16(os[0] + 4); out.italic = (dv.getUint16(os[0] + 62) & 1) === 1; }
  return out;
}

/** Table « nom de base pdf.js -> police réelle » pour tout le document. */
export async function readFontInfos(bytes: Uint8Array): Promise<Map<string, FontInfo>> {
  const res = new Map<string, FontInfo>();
  let doc: PDFDocument;
  try { doc = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false }); } catch { return res; }
  const num = (d: PDFDict, k: string) => { const v = d.lookup(PDFName.of(k)); return v instanceof PDFNumber ? v.asNumber() : undefined; };
  for (const [, obj] of doc.context.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFDict) || obj.get(PDFName.of('Type'))?.toString() !== '/FontDescriptor') continue;
    const raw = obj.get(PDFName.of('FontName'))?.toString().replace(/^\//, '') ?? '';
    if (!raw || res.has(raw)) continue;
    const flags = num(obj, 'Flags') ?? 0, stem = num(obj, 'StemV') ?? 0, w = num(obj, 'FontWeight');
    let family: string | undefined, sub = '', weight = w, italic = (num(obj, 'ItalicAngle') ?? 0) !== 0 || (flags & 64) !== 0;
    for (const key of ['FontFile2', 'FontFile3']) {
      const ref = obj.get(PDFName.of(key));
      const st = ref instanceof PDFRef ? doc.context.lookup(ref) : ref;
      if (st instanceof PDFRawStream) {
        try {
          const i = sfntInfo(decodePDFRawStream(st).decode());
          family = i.family; sub = i.sub ?? ''; weight = i.weight ?? weight; italic = italic || !!i.italic;
        } catch { /* police illisible : on se rabat sur le descripteur */ }
      }
    }
    const base = raw.replace(/^[A-Z]{6}\+/, '');
    const nameHint = `${family ?? ''} ${sub} ${base}`;
    let fam = (family || base.replace(/[-,](Bold|Italic|Regular|Oblique|BoldItalic|Light|Medium|Semibold).*$/i, '')).replace(/CIDFont\+?F?\d*/i, '').trim();
    if (!fam || /^(F\d+|Identity.*|TrueType)$/i.test(fam)) fam = '';
    const mono = !!(flags & 1) || /mono|courier|consolas/i.test(nameHint), serif = !!(flags & 2) && !mono;
    const bold = (weight ?? 0) >= 600 || /bold|black|heavy|semibold/i.test(nameHint) || (!weight && stem >= 140) || !!(flags & 0x40000);
    res.set(raw, { family: fam || (mono ? 'Courier New' : serif ? 'Times New Roman' : 'Arial'), bold, italic: italic || /italic|oblique/i.test(nameHint), mono, serif });
  }
  return res;
}
