import { PDFDocument } from 'pdf-lib';
import { PDF_MIME, type Tool } from '../core/types';
import { baseName, parseGroups, parsePages, readBytes } from '../core/util';

export const loadPdf = async (f: File) => {
  try {
    return await PDFDocument.load(await readBytes(f), { ignoreEncryption: true, updateMetadata: false });
  } catch (e: any) {
    throw new Error(`« ${f.name} » : PDF illisible (${e?.message ?? e}). Essayez l'outil « Réparer ».`);
  }
};

export async function subset(src: PDFDocument, indices: number[]): Promise<Uint8Array> {
  const out = await PDFDocument.create();
  const pages = await out.copyPages(src, indices);
  pages.forEach((p) => out.addPage(p));
  return out.save({ useObjectStreams: true });
}

const pdfOut = (name: string, data: Uint8Array) => ({ name, data, mime: PDF_MIME });

export const merge: Tool = {
  id: 'merge',
  name: 'Fusionner PDF',
  icon: 'merge',
  category: 'organize',
  description: 'Combinez autant de PDF que vous voulez, dans l\'ordre de votre choix.',
  accept: 'pdf',
  multiple: true,
  outputsPdf: true,
  options: [
    {
      key: 'sort', label: 'Ordre', type: 'select', default: 'manual',
      choices: [
        { value: 'manual', label: 'Ordre de la liste (glisser pour réordonner)' },
        { value: 'name', label: 'Nom de fichier (A à Z, ordre naturel)' },
        { value: 'date', label: 'Date de modification' },
      ],
    },
  ],
  async run(files, o, progress) {
    const list = [...files];
    if (o.sort === 'name') list.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
    if (o.sort === 'date') list.sort((a, b) => a.lastModified - b.lastModified);
    const out = await PDFDocument.create();
    for (let i = 0; i < list.length; i++) {
      const src = await loadPdf(list[i]);
      const pages = await out.copyPages(src, src.getPageIndices());
      pages.forEach((p) => out.addPage(p));
      progress((i + 1) / list.length, list[i].name);
    }
    return [pdfOut('fusion.pdf', await out.save({ useObjectStreams: true }))];
  },
};

export const split: Tool = {
  id: 'split',
  name: 'Diviser PDF',
  icon: 'split',
  category: 'organize',
  description: 'Découpez par plages, tous les N pages ou page par page.',
  accept: 'pdf',
  multiple: false,
  outputsPdf: true,
  options: [
    {
      key: 'mode', label: 'Mode', type: 'select', default: 'ranges',
      choices: [
        { value: 'ranges', label: 'Par plages (1 fichier par plage)' },
        { value: 'every', label: 'Tous les N pages' },
        { value: 'each', label: 'Chaque page séparément' },
      ],
    },
    { key: 'ranges', label: 'Plages (mode « plages »)', type: 'text', default: '1-3, 4-', placeholder: '1-3, 4-6, 7-fin' },
    { key: 'every', label: 'N (mode « tous les N »)', type: 'number', default: 2, min: 1 },
  ],
  async run(files, o, progress) {
    const f = files[0];
    const src = await loadPdf(f);
    const total = src.getPageCount();
    let groups: number[][];
    if (o.mode === 'each') groups = src.getPageIndices().map((i) => [i]);
    else if (o.mode === 'every') {
      const n = Math.max(1, Math.floor(o.every));
      groups = [];
      for (let i = 0; i < total; i += n) groups.push(Array.from({ length: Math.min(n, total - i) }, (_, k) => i + k));
    } else groups = parseGroups(o.ranges, total);
    if (!groups.length) throw new Error('Aucune plage valide.');
    const pad = String(groups.length).length;
    const out = [];
    for (let i = 0; i < groups.length; i++) {
      out.push(pdfOut(`${baseName(f.name)}_partie${String(i + 1).padStart(pad, '0')}.pdf`, await subset(src, groups[i])));
      progress((i + 1) / groups.length);
    }
    return out;
  },
};

export const removePages: Tool = {
  id: 'remove-pages',
  name: 'Supprimer des pages',
  icon: 'trash',
  category: 'organize',
  description: 'Retirez les pages dont vous n\'avez pas besoin.',
  accept: 'pdf',
  multiple: false,
  outputsPdf: true,
  options: [{ key: 'pages', label: 'Pages à supprimer', type: 'text', default: '', placeholder: '2, 5-7, fin' }],
  async run(files, o) {
    const f = files[0];
    const src = await loadPdf(f);
    const total = src.getPageCount();
    const rm = new Set(parsePages(o.pages, total, { allowEmpty: false }));
    const keep = src.getPageIndices().filter((i) => !rm.has(i));
    if (!keep.length) throw new Error('Impossible de supprimer toutes les pages.');
    return [pdfOut(`${baseName(f.name)}_allege.pdf`, await subset(src, keep))];
  },
};

export const extractPages: Tool = {
  id: 'extract-pages',
  name: 'Extraire des pages',
  icon: 'extract',
  category: 'organize',
  description: 'Gardez uniquement certaines pages (dans l\'ordre saisi, doublons permis).',
  accept: 'pdf',
  multiple: false,
  outputsPdf: true,
  options: [{ key: 'pages', label: 'Pages à extraire', type: 'text', default: '1', placeholder: '1-3, 7, 10-fin' }],
  async run(files, o) {
    const f = files[0];
    const src = await loadPdf(f);
    const idx = parsePages(o.pages, src.getPageCount(), { allowEmpty: false });
    return [pdfOut(`${baseName(f.name)}_extrait.pdf`, await subset(src, idx))];
  },
};

export const organize: Tool = {
  id: 'organize',
  name: 'Organiser PDF',
  icon: 'organize',
  category: 'organize',
  description: 'Vignettes : réordonnez, pivotez, dupliquez, supprimez, insérez des pages vierges, même entre plusieurs PDF.',
  accept: 'pdf',
  multiple: true,
  outputsPdf: true,
  custom: 'organize',
  needsBrowser: true,
  options: [],
  async run() {
    throw new Error('Cet outil utilise une interface dédiée.');
  },
};
