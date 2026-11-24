import JSZip from 'jszip';
import type { Value } from './tables';

export interface SheetCell { v: Value | null; header?: boolean; wrap?: boolean }
export interface SheetData {
  name: string;
  rows: SheetCell[][];
  merges: { r: number; c0: number; c1: number }[];
  freezeHeader: boolean;
  filter: boolean;
}

const esc = (s: string) => s.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
export const colName = (i: number) => { let s = ''; for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s; return s; };

export function safeSheetName(name: string, used: Set<string>) {
  let base = name.replace(/[\\/?*[\]:]/g, ' ').replace(/^'+|'+$/g, '').trim().slice(0, 31) || 'Feuille';
  let n = base, i = 2;
  while (used.has(n.toLowerCase())) { const suf = ` (${i++})`; n = base.slice(0, 31 - suf.length) + suf; }
  used.add(n.toLowerCase());
  return n;
}

/** Écrit un classeur .xlsx valide (sans dépendance lourde). */
export async function writeXlsx(sheets: SheetData[]): Promise<Uint8Array> {
  const numFmts = new Map<string, number>();
  const xfs: string[] = [];
  const xfKey = new Map<string, number>();
  const fmtId = (f?: string) => {
    if (!f) return 0;
    if (f === '0') return 1; if (f === '0.00') return 2; if (f === '#,##0') return 3; if (f === '#,##0.00') return 4; if (f === '0%') return 9; if (f === '0.00%') return 10;
    if (!numFmts.has(f)) numFmts.set(f, 164 + numFmts.size);
    return numFmts.get(f)!;
  };
  // 0 : défaut. Les styles sont créés à la demande.
  xfs.push('<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>');
  xfKey.set('0|0|0|0', 0);
  const xf = (fmt: string | undefined, header: boolean, wrap: boolean, date: boolean) => {
    const id = date ? 14 : fmtId(fmt);
    const key = `${id}|${header ? 1 : 0}|${wrap ? 1 : 0}|${date ? 1 : 0}`;
    if (xfKey.has(key)) return xfKey.get(key)!;
    const align = `<alignment vertical="${header ? 'center' : 'top'}"${wrap || header ? ' wrapText="1"' : ''}${header ? ' horizontal="left"' : ''}/>`;
    xfs.push(`<xf numFmtId="${id}" fontId="${header ? 1 : 0}" fillId="${header ? 2 : 0}" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1">${align}</xf>`);
    xfKey.set(key, xfs.length - 1);
    return xfs.length - 1;
  };

  const zip = new JSZip();
  const sheetXml: string[] = [];
  sheets.forEach((sh) => {
    const ncols = Math.max(1, ...sh.rows.map((r) => r.length));
    const widths = new Array<number>(ncols).fill(8);
    const rowsXml = sh.rows.map((row, ri) => {
      const cells = row.map((c, ci) => {
        const ref = colName(ci) + (ri + 1);
        const v = c.v;
        if (!v || (v.t === 's' && !v.s)) return `<c r="${ref}" s="${xf(undefined, !!c.header, false, false)}"/>`;
        if (v.t === 's') {
          const lines = v.s.split('\n');
          widths[ci] = Math.max(widths[ci], Math.min(60, Math.max(...lines.map((l) => l.length)) + 2));
          const wrap = c.wrap || lines.length > 1;
          return `<c r="${ref}" s="${xf(undefined, !!c.header, wrap, false)}" t="inlineStr"><is><t xml:space="preserve">${esc(v.s)}</t></is></c>`;
        }
        if (v.t === 'd') { widths[ci] = Math.max(widths[ci], 12); return `<c r="${ref}" s="${xf(undefined, false, false, true)}"><v>${v.v}</v></c>`; }
        widths[ci] = Math.max(widths[ci], Math.min(24, String(v.v).length + 3));
        return `<c r="${ref}" s="${xf(v.fmt, false, false, false)}"><v>${v.v}</v></c>`;
      }).join('');
      return `<row r="${ri + 1}">${cells}</row>`;
    }).join('');
    const last = `${colName(ncols - 1)}${Math.max(1, sh.rows.length)}`;
    const cols = `<cols>${widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${Math.max(8, w).toFixed(1)}" customWidth="1"/>`).join('')}</cols>`;
    const pane = sh.freezeHeader ? '<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft"/>' : '';
    const filter = sh.filter && sh.rows.length > 1 ? `<autoFilter ref="A1:${last}"/>` : '';
    const merges = sh.merges.length ? `<mergeCells count="${sh.merges.length}">${sh.merges.map((m) => `<mergeCell ref="${colName(m.c0)}${m.r + 1}:${colName(m.c1)}${m.r + 1}"/>`).join('')}</mergeCells>` : '';
    sheetXml.push(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dimension ref="A1:${last}"/><sheetViews><sheetView workbookViewId="0">${pane}</sheetView></sheetViews><sheetFormatPr defaultRowHeight="15"/>${cols}<sheetData>${rowsXml}</sheetData>${filter}${merges}</worksheet>`);
  });

  const fmtXml = numFmts.size ? `<numFmts count="${numFmts.size}">${[...numFmts].map(([f, id]) => `<numFmt numFmtId="${id}" formatCode="${esc(f)}"/>`).join('')}</numFmts>` : '';
  const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${fmtXml}` +
    `<fonts count="2"><font><sz val="11"/><name val="Calibri"/><family val="2"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/><family val="2"/></font></fonts>` +
    `<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF003266"/><bgColor indexed="64"/></patternFill></fill></fills>` +
    `<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border><left style="thin"><color rgb="FFD0D7E2"/></left><right style="thin"><color rgb="FFD0D7E2"/></right><top style="thin"><color rgb="FFD0D7E2"/></top><bottom style="thin"><color rgb="FFD0D7E2"/></bottom><diagonal/></border></borders>` +
    `<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="${xfs.length}">${xfs.join('')}</cellXfs>` +
    `<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;

  const names = sheets.map((s) => esc(s.name));
  const defined = sheets.map((s, i) => (s.filter && s.rows.length > 1 ? `<definedName name="_xlnm._FilterDatabase" localSheetId="${i}" hidden="1">'${esc(s.name).replace(/'/g, "''")}'!$A$1:$${colName(Math.max(1, ...s.rows.map((r) => r.length)) - 1)}$${s.rows.length}</definedName>` : '')).join('');
  zip.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>`);
  zip.file('_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`);
  zip.file('xl/workbook.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><bookViews><workbookView/></bookViews><sheets>${names.map((n, i) => `<sheet name="${n}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets>${defined ? `<definedNames>${defined}</definedNames>` : ''}</workbook>`);
  zip.file('xl/_rels/workbook.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`);
  zip.file('xl/styles.xml', styles);
  sheetXml.forEach((x, i) => zip.file(`xl/worksheets/sheet${i + 1}.xml`, x));
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}
