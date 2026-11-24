import assert from 'node:assert/strict';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { parseGroups, parsePages, defaultsOf } from '../src/core/util';
import { TOOLS, toolById } from '../src/tools';
import { runTool } from '../src/components/Common';

const noop = () => {};
async function makePdf(label: string, pages: number, extra: string[] = []) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 1; i <= pages; i++) {
    const p = doc.addPage([400, 600]);
    p.drawText(`${label} page ${i}`, { x: 50, y: 500, size: 24, font });
    extra.forEach((l, k) => p.drawText(l, { x: 50, y: 450 - k * 20, size: 12, font }));
  }
  return new File([await doc.save() as BlobPart], `${label}.pdf`, { type: 'application/pdf' });
}
const run = async (id: string, files: File[], o: Record<string, any> = {}) => {
  const t = toolById(id)!;
  return runTool(t, files, { ...defaultsOf(t.options), ...o }, noop);
};
const pages = async (o: { data: Uint8Array | Blob }) => (await PDFDocument.load(o.data as Uint8Array)).getPageCount();

let failed = 0;
async function test(name: string, fn: () => Promise<void>) {
  try { await fn(); console.log('  ✓', name); } catch (e: any) { failed++; console.log('  ✗', name, '\n    ', e?.message ?? e); }
}

await test('parsePages / parseGroups', async () => {
  assert.deepEqual(parsePages('1-3, 5', 10), [0, 1, 2, 4]);
  assert.deepEqual(parsePages('8-', 10), [7, 8, 9]);
  assert.deepEqual(parsePages('-2', 10), [0, 1]);
  assert.deepEqual(parsePages('fin', 4), [3]);
  assert.deepEqual(parsePages('', 3), [0, 1, 2]);
  assert.deepEqual(parseGroups('1-2,3', 5), [[0, 1], [2]]);
  assert.throws(() => parsePages('9', 3));
  assert.throws(() => parsePages('abc', 3));
});

const A = await makePdf('A', 5, ['Contact: jean.dupont@example.com', 'Tel 06 12 34 56 78']);
const B = await makePdf('B', 3);

await test('merge (ordre + tri par nom)', async () => {
  const [o] = await run('merge', [B, A]);
  assert.equal(await pages(o), 8);
  const [s] = await run('merge', [B, A], { sort: 'name' });
  assert.equal(await pages(s), 8);
});
await test('split: plages / tous les N / chaque page', async () => {
  assert.equal((await run('split', [A], { mode: 'ranges', ranges: '1-2, 3-fin' })).length, 2);
  const every = await run('split', [A], { mode: 'every', every: 2 });
  assert.deepEqual(await Promise.all(every.map(pages)), [2, 2, 1]);
  assert.equal((await run('split', [A], { mode: 'each' })).length, 5);
});
await test('remove / extract', async () => {
  assert.equal(await pages((await run('remove-pages', [A], { pages: '2,4' }))[0]), 3);
  assert.equal(await pages((await run('extract-pages', [A], { pages: '5,1,1' }))[0]), 3);
  await assert.rejects(run('remove-pages', [A], { pages: '1-5' }));
});
await test('rotate', async () => {
  const [o] = await run('rotate', [A], { angle: '90', pages: '1' });
  const d = await PDFDocument.load(o.data as Uint8Array);
  assert.equal(d.getPage(0).getRotation().angle, 90);
  assert.equal(d.getPage(1).getRotation().angle, 0);
});
await test('page-numbers / watermark / crop / flatten / metadata / n-up', async () => {
  assert.equal(await pages((await run('page-numbers', [A]))[0]), 5);
  assert.equal(await pages((await run('watermark', [A], { tile: true }))[0]), 5);
  await assert.rejects(run('watermark', [A], { text: 'ŝ✓' }));
  const [c] = await run('crop', [A], { top: 10, left: 10, right: 10, bottom: 10 });
  const cd = await PDFDocument.load(c.data as Uint8Array);
  assert.ok(Math.abs(cd.getPage(0).getCropBox().width - (400 - 2 * 28.3465)) < 1);
  assert.equal(await pages((await run('flatten', [A]))[0]), 5);
  const [m] = await run('metadata', [A], { strip: false, title: 'T', author: 'Moi' });
  assert.equal((await PDFDocument.load(m.data as Uint8Array)).getTitle(), 'T');
  const [n] = await run('n-up', [A], { cols: 2, rows: 2 });
  assert.equal(await pages(n), 2);
});
await test('repair sur PDF tronqué', async () => {
  const bytes = new Uint8Array(await A.arrayBuffer());
  const broken = new File([bytes.slice(0, bytes.length - 40)], 'broken.pdf', { type: 'application/pdf' });
  const [o] = await run('repair', [broken]);
  assert.ok((await pages(o)) >= 1);
  const plain = await PDFDocument.create();
  for (let i = 0; i < 4; i++) plain.addPage([200, 200]);
  const pb = await plain.save({ useObjectStreams: false });
  const [o2] = await run('repair', [new File([pb.slice(0, pb.length - 40)], 'b2.pdf')]);
  assert.equal(await pages(o2), 4);
});
await test('image → PDF (PNG/JPG intégrés tels quels hors navigateur)', async () => {
  const png = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='), (c) => c.charCodeAt(0));
  const f = new File([png], 'x.png', { type: 'image/png' });
  assert.equal(await pages((await run('image-to-pdf', [f, f]))[0]), 2);
});
await test('PDF → texte et Markdown (pdf.js)', async () => {
  const [t] = await run('pdf-to-text', [A], { pages: '1' });
  const txt = new TextDecoder().decode(t.data as Uint8Array);
  assert.match(txt, /A page 1/);
  assert.match(txt, /jean\.dupont@example\.com/);
  const [md] = await run('pdf-to-markdown', [A], { pages: '1' });
  assert.match(new TextDecoder().decode(md.data as Uint8Array), /^## A page 1|^# A page 1|^### A page 1/m);
});
await test('compare', async () => {
  const A2 = await makePdf('A', 5, ['Contact: marie@example.com', 'Tel 06 12 34 56 78']);
  const [o] = await run('compare', [A, A2]);
  const html = new TextDecoder().decode(o.data as Uint8Array);
  assert.match(html, /class="del"/);
  assert.match(html, /class="add"/);
  assert.match(o.note!, /5 ajout/);
});
await test('registre : ids uniques, options valides', async () => {
  const ids = TOOLS.map((t) => t.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const t of TOOLS) for (const d of t.options) assert.ok(d.key && d.label, `${t.id}`);
});

await test('protéger puis déverrouiller (AES-256)', async () => {
  const [enc] = await run('protect', [A], { user: 'secret', owner: 'boss', print: 'none', copy: false });
  await assert.rejects(PDFDocument.load(enc.data as Uint8Array), /encrypted/i);
  await assert.rejects(run('unlock', [new File([enc.data as BlobPart], 'e.pdf')], { password: 'faux' }), /incorrect/i);
  const [dec] = await run('unlock', [new File([enc.data as BlobPart], 'e.pdf')], { password: 'secret' });
  assert.equal(await pages(dec), 5);
  await assert.rejects(run('protect', [A], {}), /mot de passe/i);
});
await test('nettoyer / en-tête et pied / format', async () => {
  assert.equal(await pages((await run('clean', [A]))[0]), 5);
  assert.equal(await pages((await run('header-footer', [A], { hc: 'Titre', fl: '{fichier}' }))[0]), 5);
  const [r] = await run('resize', [A], { format: 'a5', margin: 5 });
  const d = await PDFDocument.load(r.data as Uint8Array);
  assert.ok(Math.abs(d.getPage(0).getSize().width - 419.53) < 1);
});
await test('réordonner / brochure / diviser par taille', async () => {
  assert.equal(await pages((await run('page-order', [A], { mode: 'reverse' }))[0]), 5);
  assert.equal(await pages((await run('page-order', [A], { mode: 'odd' }))[0]), 3);
  assert.equal(await pages((await run('page-order', [A], { mode: 'even' }))[0]), 2);
  assert.equal(await pages((await run('page-order', [A], { mode: 'repeat', n: 2 }))[0]), 10);
  assert.equal(await pages((await run('page-order', [A], { mode: 'blank', n: 2 }))[0]), 7);
  assert.equal(await pages((await run('booklet', [A]))[0]), 4);
  const parts = await run('split-size', [A], { mb: 0.2 });
  assert.ok(parts.length >= 1);
});
await test('texte vers PDF (txt et markdown)', async () => {
  const long = Array.from({ length: 200 }, (_, i) => `Ligne ${i} avec des accents éèà et un texte assez long pour tester le retour à la ligne automatique du paragraphe.`).join('\n');
  const [o] = await run('text-to-pdf', [new File([long], 'a.txt', { type: 'text/plain' })]);
  assert.ok((await pages(o)) >= 4);
  const [m] = await run('text-to-pdf', [new File(['# Titre\n\n- un\n- deux\n\nTexte **gras**'], 'a.md')]);
  assert.equal(await pages(m), 1);
});
await test('PDF vers Word / tableur, infos, recherche', async () => {
  const [w] = await run('pdf-to-word', [A], { pages: '1-2' });
  const JSZip = (await import('jszip')).default;
  const z = await JSZip.loadAsync(w.data as Uint8Array);
  const body = await z.file('word/document.xml')!.async('string');
  assert.match(body, /A page 1/); assert.match(body, /w:br w:type="page"/);
  const [csv] = await run('pdf-to-csv', [A], { format: 'csv' });
  assert.match(new TextDecoder().decode(csv.data as Uint8Array), /A page 1/);
  const [inf] = await run('info', [A]);
  assert.match(new TextDecoder().decode(inf.data as Uint8Array), /A4|141 x 212|mm/);
  const [s] = await run('search', [A], { term: 'dupont' });
  assert.match(s.note!, /5 occurrence/);
  await assert.rejects(run('search', [A], { term: '' }));
});

await test('PDF vers Excel : tableaux, types, pages jointes', async () => {
  const doc = await PDFDocument.create();
  const f = await doc.embedFont(StandardFonts.Helvetica);
  const right = (p: any, t: string, xr: number, y: number) => p.drawText(t, { x: xr - f.widthOfTextAtSize(t, 10), y, size: 10, font: f });
  const data = [['01/02/2026', 'Loyer', '1 250,00', '12 %'], ['15/02/2026', 'Eau', '(45,5)', ''], ['28/02/2026', 'Code 0042', '1 000 000', '5,5 %']];
  for (let pg = 0; pg < 2; pg++) {
    const p = doc.addPage([500, 400]);
    p.drawText('Date', { x: 40, y: 340, size: 10, font: f }); p.drawText('Libelle', { x: 130, y: 340, size: 10, font: f }); right(p, 'Montant', 330, 340); right(p, 'Taux', 420, 340);
    data.forEach((r, i) => { const y = 320 - i * 16; p.drawText(r[0], { x: 40, y, size: 10, font: f }); p.drawText(r[1], { x: 130, y, size: 10, font: f }); right(p, r[2], 330, y); if (r[3]) right(p, r[3], 420, y); });
  }
  const file = new File([await doc.save() as BlobPart], 't.pdf', { type: 'application/pdf' });
  const [x] = await run('pdf-to-csv', [file]);
  assert.match(x.name, /\.xlsx$/); assert.match(x.note!, /1 tableau/);
  const JSZip = (await import('jszip')).default;
  const z = await JSZip.loadAsync(x.data as Uint8Array);
  const sh = await z.file('xl/worksheets/sheet1.xml')!.async('string');
  assert.match(sh, /<v>1250<\/v>/); assert.match(sh, /<v>-45\.5<\/v>/); assert.match(sh, /<v>1000000<\/v>/); assert.match(sh, /<v>0\.12<\/v>/);
  assert.match(sh, /Code 0042/); assert.match(sh, /autoFilter/); assert.match(sh, /state="frozen"/);
  assert.equal((sh.match(/<row /g) || []).length, 7); // en-tête + 3 lignes x 2 pages, en-tête répété supprimé
  const [sep] = await run('pdf-to-csv', [file], { join: false });
  assert.match(sep.note!, /2 tableau/);
  const empty = await PDFDocument.create(); empty.addPage();
  await assert.rejects(run('pdf-to-csv', [new File([await empty.save() as BlobPart], 'v.pdf')]), /texte/);
});

console.log(failed ? `\n${failed} test(s) en échec` : '\nTous les tests passent');
process.exit(failed ? 1 : 0);
