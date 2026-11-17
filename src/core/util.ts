import JSZip from 'jszip';
import type { Options, OptionDef, ToolOutput } from './types';

export const readBytes = async (f: File | Blob) => new Uint8Array(await f.arrayBuffer());

export const baseName = (name: string) => name.replace(/\.[^./\\]+$/, '');

export const toBlob = (o: ToolOutput) => (o.data instanceof Blob ? o.data : new Blob([o.data as BlobPart], { type: o.mime }));

export function defaultsOf(defs: OptionDef[]): Options {
  return Object.fromEntries(defs.map((d) => [d.key, d.default]));
}

/**
 * Lit une liste de pages « 1-3, 5, 8- » (base 1) et renvoie des indices base 0.
 * Mots-clés : "fin"/"end"/"last" = dernière page. Vide = toutes les pages.
 */
export function parsePages(spec: string, total: number, { allowEmpty = true }: { allowEmpty?: boolean } = {}): number[] {
  const s = (spec ?? '').trim();
  if (!s) {
    if (allowEmpty) return Array.from({ length: total }, (_, i) => i);
    throw new Error('Indiquez au moins une page (ex. 1-3, 5, 8-).');
  }
  return parseGroups(s, total).flat();
}

export function parseGroups(spec: string, total: number): number[][] {
  const num = (t: string) => (/^(fin|end|last|dernier)$/i.test(t) ? total : Number(t));
  const groups: number[][] = [];
  for (const raw of spec.split(/[,;]/)) {
    const tok = raw.trim();
    if (!tok) continue;
    const m = tok.match(/^(\w*)\s*(-)?\s*(\w*)$/);
    if (!m) throw new Error(`Plage invalide : « ${tok} »`);
    let a: number, b: number;
    if (!m[2]) {
      a = b = num(m[1]);
    } else {
      a = m[1] ? num(m[1]) : 1;
      b = m[3] ? num(m[3]) : total;
    }
    if (!Number.isInteger(a) || !Number.isInteger(b)) throw new Error(`Plage invalide : « ${tok} »`);
    if (a < 1 || b < 1 || a > total || b > total) throw new Error(`« ${tok} » sort du document (${total} pages).`);
    const g: number[] = [];
    if (a <= b) for (let i = a; i <= b; i++) g.push(i - 1);
    else for (let i = a; i >= b; i--) g.push(i - 1);
    groups.push(g);
  }
  return groups;
}

export const mmToPt = (mm: number) => (mm * 72) / 25.4;

export function hexToRgb01(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  const v = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  return [parseInt(v.slice(0, 2), 16) / 255, parseInt(v.slice(2, 4), 16) / 255, parseInt(v.slice(4, 6), 16) / 255];
}

export async function zipOutputs(outputs: ToolOutput[]): Promise<Blob> {
  const zip = new JSZip();
  const used = new Set<string>();
  for (const o of outputs) {
    let name = o.name;
    let i = 1;
    while (used.has(name)) name = o.name.replace(/(\.[^.]*)?$/, `_${i++}$1`);
    used.add(name);
    zip.file(name, o.data instanceof Blob ? await o.data.arrayBuffer() : o.data);
  }
  return zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
}

export function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export const outputToFile = (o: ToolOutput) => new File([toBlob(o)], o.name, { type: o.mime });

export function formatBytes(n: number) {
  if (n < 1024) return `${n} o`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} Ko`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} Mo`;
  return `${(n / 1024 ** 3).toFixed(2)} Go`;
}

export const sizeOf = (o: ToolOutput) => (o.data instanceof Blob ? o.data.size : o.data.byteLength);
