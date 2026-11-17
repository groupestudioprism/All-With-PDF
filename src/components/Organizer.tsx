import { useEffect, useRef, useState } from 'react';
import { PDFDocument, degrees } from 'pdf-lib';
import { canvasToBlob, openPdf, renderPageToCanvas } from '../core/pdfjs';
import { downloadBlob, readBytes } from '../core/util';
import { loadPdf } from '../tools/organize';
import { Dropzone, Spinner } from './Common';
import { Icon } from './Icon';

interface Item { id: string; src: number; idx: number; rot: number; blank?: boolean; }
let n = 0;
const nid = () => `p${n++}`;

export function Organizer({ initial }: { initial: File[] }) {
  const [files, setFiles] = useState<File[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  const [drag, setDrag] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const queue = useRef<Promise<void>>(Promise.resolve());
  const loaded = useRef(0);

  const addFiles = (list: File[]) => {
    const base = loaded.current;
    loaded.current += list.length;
    setFiles((f) => [...f, ...list]);
    list.forEach((f, k) => {
      const src = base + k;
      queue.current = queue.current.then(async () => {
        try {
          const pdf = await openPdf(await readBytes(f));
          setItems((cur) => [...cur, ...Array.from({ length: pdf.numPages }, (_, i) => ({ id: nid(), src, idx: i, rot: 0 }))]);
          for (let i = 1; i <= pdf.numPages; i++) {
            const page = await pdf.getPage(i);
            const canvas = await renderPageToCanvas(page, 0.35);
            const url = URL.createObjectURL(await canvasToBlob(canvas, 'image/jpeg', 0.7));
            setThumbs((t) => ({ ...t, [`${src}-${i - 1}`]: url }));
            page.cleanup();
          }
        } catch (e: any) { setError(`« ${f.name} » : ${e?.message ?? e}`); }
      });
    });
  };
  useEffect(() => { if (initial.length) addFiles(initial); /* eslint-disable-next-line */ }, []);

  const upd = (id: string, fn: (i: Item) => Item) => setItems((c) => c.map((i) => (i.id === id ? fn(i) : i)));
  const del = (id: string) => setItems((c) => c.filter((i) => i.id !== id));
  const dup = (id: string) => setItems((c) => { const k = c.findIndex((i) => i.id === id); const it = c[k]; return [...c.slice(0, k + 1), { ...it, id: nid() }, ...c.slice(k + 1)]; });
  const drop = (target: string) => {
    if (!drag || drag === target) return;
    setItems((c) => { const a = c.filter((i) => i.id !== drag); const k = a.findIndex((i) => i.id === target); const d = c.find((i) => i.id === drag)!; a.splice(k, 0, d); return a; });
  };

  const save = async () => {
    setBusy(true); setError('');
    try {
      const docs = await Promise.all(files.map((f) => loadPdf(f)));
      const out = await PDFDocument.create();
      for (const it of items) {
        if (it.blank) {
          const ref = out.getPageCount() ? out.getPage(out.getPageCount() - 1).getSize() : { width: 595.28, height: 841.89 };
          out.addPage([ref.width, ref.height]);
          continue;
        }
        const [p] = await out.copyPages(docs[it.src], [it.idx]);
        if (it.rot) p.setRotation(degrees((p.getRotation().angle + it.rot + 360) % 360));
        out.addPage(p);
      }
      downloadBlob(new Blob([(await out.save({ useObjectStreams: true })) as BlobPart], { type: 'application/pdf' }), 'organise.pdf');
    } catch (e: any) { setError(e?.message ?? String(e)); } finally { setBusy(false); }
  };

  return (
    <div>
      {!items.length && !files.length && <Dropzone accept="pdf" multiple onFiles={addFiles} />}
      {error && <div className="err" role="alert"><Icon name="alert" /><div>{error}</div></div>}
      {files.length > 0 && (
        <>
          <div className="otb">
            <b>{items.length} page(s)</b>
            <span className="muted">Glissez les vignettes pour réordonner.</span>
            <span className="grow" />
            <label className="btn small"><Icon name="plus" size={15} /> Ajouter des PDF<input hidden type="file" accept="application/pdf" multiple onChange={(e) => { addFiles([...(e.target.files ?? [])]); e.target.value = ''; }} /></label>
            <button className="btn small" onClick={() => setItems((c) => [...c, { id: nid(), src: 0, idx: 0, rot: 0, blank: true }])}><Icon name="blank" size={15} /> Page vierge</button>
            <button className="btn small" onClick={() => setItems((c) => c.map((i) => ({ ...i, rot: (i.rot + 90) % 360 })))}><Icon name="rotr" size={15} /> Tout pivoter</button>
            <button className="btn small" onClick={() => setItems((c) => [...c].reverse())}><Icon name="reverse" size={15} /> Inverser</button>
            <button className="btn small danger" onClick={() => { setItems([]); setFiles([]); setThumbs({}); loaded.current = 0; }}>Tout effacer</button>
            <button className="btn primary" style={{ padding: '8px 16px', fontSize: 14 }} disabled={busy || !items.length} onClick={save}>{busy ? <Spinner /> : <Icon name="download" size={16} />} {busy ? 'Export en cours' : 'Enregistrer'}</button>
          </div>
          <div className="thumbs">
            {items.map((it, k) => (
              <div key={it.id} className={'thumb' + (drag === it.id ? ' drag' : '') + (over === it.id ? ' target' : '')} draggable
                onDragStart={() => setDrag(it.id)} onDragEnd={() => { setDrag(null); setOver(null); }}
                onDragOver={(e) => { e.preventDefault(); setOver(it.id); }} onDrop={(e) => { e.preventDefault(); drop(it.id); setDrag(null); setOver(null); }}>
                {it.blank ? <div className="ph">Page vierge</div>
                  : thumbs[`${it.src}-${it.idx}`] ? <img src={thumbs[`${it.src}-${it.idx}`]} draggable={false} style={{ maxWidth: '100%', maxHeight: 170, background: '#fff', boxShadow: '0 1px 6px rgba(0,0,0,.2)', transform: `rotate(${it.rot}deg)`, transition: 'transform .2s' }} />
                  : <div className="ph">…</div>}
                <span className="badge">{k + 1}</span>{!it.blank && files.length > 1 && <small>{files[it.src]?.name}</small>}
                <div className="tb">
                  <button title="Pivoter à gauche" aria-label="Pivoter à gauche" onClick={() => upd(it.id, (i) => ({ ...i, rot: (i.rot + 270) % 360 }))}><Icon name="rotl" size={16} /></button>
                  <button title="Pivoter à droite" aria-label="Pivoter à droite" onClick={() => upd(it.id, (i) => ({ ...i, rot: (i.rot + 90) % 360 }))}><Icon name="rotr" size={16} /></button>
                  <button title="Dupliquer" aria-label="Dupliquer" onClick={() => dup(it.id)}><Icon name="copy" size={16} /></button>
                  <button title="Supprimer" aria-label="Supprimer" onClick={() => del(it.id)}><Icon name="trash" size={16} /></button>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
