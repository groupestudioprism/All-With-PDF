import JSZip from 'jszip';
import type { Value } from './tables';

export interface FontSpec { font: string; size: number; b: boolean; i: boolean; color: string }
export interface BorderSpec { style: 'thin' | 'medium' | 'thick'; color: string }
export interface SheetCell {
  v: Value | null;
  runs?: (FontSpec & { t: string })[];   // texte riche (plusieurs polices dans une cellule)
  font?: FontSpec; fill?: string;
  l?: BorderSpec; r?: BorderSpec; t?: BorderSpec; b?: BorderSpec;
  ah?: 'left' | 'center' | 'right'; av?: 'top' | 'center' | 'bottom'; wrap?: boolean;
}
export interface ImageSpec { png: Uint8Array; row: number; col: number; xOff: number; yOff: number; w: number; h: number } // pt
export interface SheetData {
  name: string;
  rows: SheetCell[][];
  merges: { r: number; r1?: number; c0: number; c1: number }[];
  freezeHeader: boolean;
  filter: boolean;
  colWidths?: number[];      // caractères
  rowHeights?: (number | undefined)[]; // points
  images?: ImageSpec[];
}

const esc = (s: string) => s.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
export const colName = (i: number) => { let s = ''; for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s; return s; };
const argb = (c: string) => 'FF' + c.replace('#', '').toUpperCase().padStart(6, '0').slice(0, 6);
/** Largeur de colonne Excel (caractères Calibri 11) pour une largeur en points. */
export const ptToChars = (pt: number) => Math.max(1, Math.round((((pt * 96) / 72 - 5) / 7) * 100) / 100);

export function safeSheetName(name: string, used: Set<string>) {
  const base = name.replace(/[\\/?*[\]:]/g, ' ').replace(/^'+|'+$/g, '').trim().slice(0, 31) || 'Feuille';
  let n = base, i = 2;
  while (used.has(n.toLowerCase())) { const suf = ` (${i++})`; n = base.slice(0, 31 - suf.length) + suf; }
  used.add(n.toLowerCase());
  return n;
}

const DEFAULT_FONT: FontSpec = { font: 'Calibri', size: 11, b: false, i: false, color: '#000000' };

/** Écrit un classeur .xlsx valide (sans dépendance lourde). */
export async function writeXlsx(sheets: SheetData[]): Promise<Uint8Array> {
  const numFmts = new Map<string, number>();
  const fmtId = (f?: string) => {
    if (!f) return 0;
    const std: Record<string, number> = { '0': 1, '0.00': 2, '#,##0': 3, '#,##0.00': 4, '0%': 9, '0.00%': 10 };
    if (f in std) return std[f];
    if (!numFmts.has(f)) numFmts.set(f, 164 + numFmts.size);
    return numFmts.get(f)!;
  };
  const fonts: string[] = []; const fontIx = new Map<string, number>();
  const fontXml = (f: FontSpec) => `<font>${f.b ? '<b/>' : ''}${f.i ? '<i/>' : ''}<sz val="${f.size}"/><color rgb="${argb(f.color)}"/><name val="${esc(f.font)}"/><family val="2"/></font>`;
  const fontId = (f: FontSpec) => { const x = fontXml(f); if (!fontIx.has(x)) { fontIx.set(x, fonts.length); fonts.push(x); } return fontIx.get(x)!; };
  fontId(DEFAULT_FONT);
  const fills: string[] = ['<fill><patternFill patternType="none"/></fill>', '<fill><patternFill patternType="gray125"/></fill>']; const fillIx = new Map<string, number>();
  const fillId = (c?: string) => {
    if (!c) return 0;
    const x = `<fill><patternFill patternType="solid"><fgColor rgb="${argb(c)}"/><bgColor indexed="64"/></patternFill></fill>`;
    if (!fillIx.has(x)) { fillIx.set(x, fills.length); fills.push(x); }
    return fillIx.get(x)!;
  };
  const borders: string[] = ['<border><left/><right/><top/><bottom/><diagonal/></border>']; const borderIx = new Map<string, number>();
  const side = (n: string, b?: BorderSpec) => (b ? `<${n} style="${b.style}"><color rgb="${argb(b.color)}"/></${n}>` : `<${n}/>`);
  const borderId = (c: SheetCell) => {
    if (!c.l && !c.r && !c.t && !c.b) return 0;
    const x = `<border>${side('left', c.l)}${side('right', c.r)}${side('top', c.t)}${side('bottom', c.b)}<diagonal/></border>`;
    if (!borderIx.has(x)) { borderIx.set(x, borders.length); borders.push(x); }
    return borderIx.get(x)!;
  };
  const xfs: string[] = ['<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>']; const xfIx = new Map<string, number>();
  const xfId = (c: SheetCell, f: FontSpec, nf: number) => {
    const x = `<xf numFmtId="${nf}" fontId="${fontId(f)}" fillId="${fillId(c.fill)}" borderId="${borderId(c)}" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="${c.ah ?? 'general'}" vertical="${c.av ?? 'top'}"${c.wrap ? ' wrapText="1"' : ''}/></xf>`;
    if (!xfIx.has(x)) { xfIx.set(x, xfs.length); xfs.push(x); }
    return xfIx.get(x)!;
  };
  const runXml = (r: FontSpec & { t: string }) => `<r><rPr>${r.b ? '<b/>' : ''}${r.i ? '<i/>' : ''}<sz val="${r.size}"/><color rgb="${argb(r.color)}"/><rFont val="${esc(r.font)}"/><family val="2"/></rPr><t xml:space="preserve">${esc(r.t)}</t></r>`;

  const zip = new JSZip();
  const sheetXml: string[] = [];
  const drawings: { sheet: number; xml: string; rels: string; images: { name: string; data: Uint8Array }[] }[] = [];
  let imgCount = 0;
  sheets.forEach((sh, si) => {
    const ncols = Math.max(1, ...sh.rows.map((r) => r.length));
    const widths = new Array<number>(ncols).fill(8);
    const rowsXml = sh.rows.map((row, ri) => {
      const cells = row.map((c, ci) => {
        const ref = colName(ci) + (ri + 1);
        const v = c.v;
        const f = c.font ?? c.runs?.[0] ?? DEFAULT_FONT;
        if (!v || (v.t === 's' && !v.s && !c.runs?.length)) return `<c r="${ref}" s="${xfId(c, f, 0)}"/>`;
        if (v.t === 's') {
          const lines = v.s.split('\n');
          widths[ci] = Math.max(widths[ci], Math.min(60, Math.max(...lines.map((l) => l.length)) + 2));
          const wrap = !!c.wrap || lines.length > 1;
          const body = c.runs && c.runs.length > 1 ? c.runs.map(runXml).join('') : `<t xml:space="preserve">${esc(v.s.slice(0, 32000))}</t>`;
          return `<c r="${ref}" s="${xfId({ ...c, wrap }, f, 0)}" t="inlineStr"><is>${body}</is></c>`;
        }
        if (v.t === 'd') { widths[ci] = Math.max(widths[ci], 12); return `<c r="${ref}" s="${xfId(c, f, 14)}"><v>${v.v}</v></c>`; }
        widths[ci] = Math.max(widths[ci], Math.min(24, String(v.v).length + 3));
        return `<c r="${ref}" s="${xfId(c, f, fmtId(v.fmt))}"><v>${v.v}</v></c>`;
      }).join('');
      const h = sh.rowHeights?.[ri];
      return `<row r="${ri + 1}"${h ? ` ht="${Math.min(409.5, Math.max(4, h)).toFixed(2)}" customHeight="1"` : ''}>${cells}</row>`;
    }).join('');
    const last = `${colName(ncols - 1)}${Math.max(1, sh.rows.length)}`;
    sh.colWidths?.forEach((w, i) => { if (i < ncols) widths[i] = w; });
    const cols = `<cols>${widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${Math.max(1, w).toFixed(2)}" customWidth="1"/>`).join('')}</cols>`;
    const pane = sh.freezeHeader ? '<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft"/>' : '';
    const filter = sh.filter && sh.rows.length > 1 ? `<autoFilter ref="A1:${last}"/>` : '';
    const merges = sh.merges.length ? `<mergeCells count="${sh.merges.length}">${sh.merges.map((m) => `<mergeCell ref="${colName(m.c0)}${m.r + 1}:${colName(m.c1)}${(m.r1 ?? m.r) + 1}"/>`).join('')}</mergeCells>` : '';
    let drawingTag = '';
    if (sh.images?.length) {
      const names: { name: string; data: Uint8Array }[] = [];
      const anchors = sh.images.map((im, k) => {
        const name = `image${++imgCount}.png`; names.push({ name, data: im.png });
        const emu = (pt: number) => Math.round(pt * 12700);
        return `<xdr:oneCellAnchor><xdr:from><xdr:col>${im.col}</xdr:col><xdr:colOff>${emu(im.xOff)}</xdr:colOff><xdr:row>${im.row}</xdr:row><xdr:rowOff>${emu(im.yOff)}</xdr:rowOff></xdr:from><xdr:ext cx="${emu(im.w)}" cy="${emu(im.h)}"/><xdr:pic><xdr:nvPicPr><xdr:cNvPr id="${k + 2}" name="Image ${k + 1}"/><xdr:cNvPicPr/></xdr:nvPicPr><xdr:blipFill><a:blip xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:embed="rId${k + 1}"/><a:stretch><a:fillRect/></a:stretch></xdr:blipFill><xdr:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${emu(im.w)}" cy="${emu(im.h)}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></xdr:spPr></xdr:pic><xdr:clientData/></xdr:oneCellAnchor>`;
      }).join('');
      drawings.push({
        sheet: si,
        xml: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">${anchors}</xdr:wsDr>`,
        rels: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${names.map((n, k) => `<Relationship Id="rId${k + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/${n.name}"/>`).join('')}</Relationships>`,
        images: names,
      });
      drawingTag = '<drawing xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:id="rId1"/>';
    }
    sheetXml.push(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetPr><pageSetUpPr fitToPage="1"/></sheetPr><dimension ref="A1:${last}"/><sheetViews><sheetView workbookViewId="0" showGridLines="0">${pane}</sheetView></sheetViews><sheetFormatPr defaultRowHeight="15"/>${cols}<sheetData>${rowsXml}</sheetData>${filter}${merges}<pageMargins left="0.4" right="0.4" top="0.4" bottom="0.4" header="0.2" footer="0.2"/><pageSetup paperSize="9" fitToWidth="1" fitToHeight="0"/>${drawingTag}</worksheet>`);
  });

  const fmtXml = numFmts.size ? `<numFmts count="${numFmts.size}">${[...numFmts].map(([f, id]) => `<numFmt numFmtId="${id}" formatCode="${esc(f)}"/>`).join('')}</numFmts>` : '';
  const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${fmtXml}` +
    `<fonts count="${fonts.length}">${fonts.join('')}</fonts><fills count="${fills.length}">${fills.join('')}</fills><borders count="${borders.length}">${borders.join('')}</borders>` +
    `<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="${xfs.length}">${xfs.join('')}</cellXfs>` +
    `<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;

  const names = sheets.map((s) => esc(s.name));
  const defined = sheets.map((s, i) => (s.filter && s.rows.length > 1 ? `<definedName name="_xlnm._FilterDatabase" localSheetId="${i}" hidden="1">'${esc(s.name).replace(/'/g, "''")}'!$A$1:$${colName(Math.max(1, ...s.rows.map((r) => r.length)) - 1)}$${s.rows.length}</definedName>` : '')).join('');
  zip.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}${drawings.map((_, i) => `<Override PartName="/xl/drawings/drawing${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>`).join('')}</Types>`);
  zip.file('_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`);
  zip.file('xl/workbook.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><bookViews><workbookView/></bookViews><sheets>${names.map((n, i) => `<sheet name="${n}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets>${defined ? `<definedNames>${defined}</definedNames>` : ''}</workbook>`);
  zip.file('xl/_rels/workbook.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`);
  zip.file('xl/styles.xml', styles);
  sheetXml.forEach((x, i) => zip.file(`xl/worksheets/sheet${i + 1}.xml`, x));
  drawings.forEach((d, i) => {
    zip.file(`xl/drawings/drawing${i + 1}.xml`, d.xml);
    zip.file(`xl/drawings/_rels/drawing${i + 1}.xml.rels`, d.rels);
    zip.file(`xl/worksheets/_rels/sheet${d.sheet + 1}.xml.rels`, `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing${i + 1}.xml"/></Relationships>`);
    d.images.forEach((im) => zip.file(`xl/media/${im.name}`, im.data));
  });
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}
