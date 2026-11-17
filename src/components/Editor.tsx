import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { openPdf, renderPageToCanvas } from '../core/pdfjs';
import { exportAnnotated, type Ann, type AnnType } from '../core/editorExport';
import { baseName, downloadBlob, readBytes } from '../core/util';
import { Dropzone, Spinner } from './Common';
import { Icon } from './Icon';

type Tool = 'select' | AnnType | 'signature';
const TOOLS: { id: Tool; label: string; icon: string }[] = [
  { id: 'select', label: 'Sélection', icon: 'cursor' },
  { id: 'text', label: 'Texte', icon: 'type' },
  { id: 'rect', label: 'Rectangle', icon: 'square' },
  { id: 'ellipse', label: 'Ellipse', icon: 'circle' },
  { id: 'highlight', label: 'Surligner', icon: 'highlight' },
  { id: 'draw', label: 'Dessin', icon: 'pen' },
  { id: 'whiteout', label: 'Blanc de correction', icon: 'eraser' },
  { id: 'redact', label: 'Caviarder (définitif)', icon: 'redact' },
  { id: 'signature', label: 'Signature', icon: 'signature' },
  { id: 'image', label: 'Image', icon: 'image' },
];
let uid = 0;
const nid = () => `a${Date.now().toString(36)}${uid++}`;
const clamp = (v: number, a = 0, b = 1) => Math.min(b, Math.max(a, v));

interface PageInfo { w: number; h: number }

function PageView(props: {
  pdf: any; num: number; info: PageInfo; zoom: number; anns: Ann[]; tool: Tool; selected: string | null;
  color: string; size: number; fill: boolean;
  onSelect: (id: string | null) => void; onActive: (n: number) => void;
  onAdd: (a: Ann) => void; onChange: (id: string, patch: Partial<Ann>, commit?: boolean) => void;
}) {
  const { pdf, num, info, zoom, anns, tool, selected } = props;
  const wrap = useRef<HTMLDivElement>(null);
  const canvasHost = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(num < 2);
  const [draft, setDraft] = useState<Ann | null>(null);
  const dragRef = useRef<{ mode: 'move' | 'resize'; id: string; sx: number; sy: number; orig: Ann } | null>(null);

  useEffect(() => {
    const el = wrap.current; if (!el) return;
    const io = new IntersectionObserver(([e]) => setVisible(e.isIntersecting), { rootMargin: '600px' });
    io.observe(el); return () => io.disconnect();
  }, []);

  useEffect(() => {
    if (!visible) { canvasHost.current?.replaceChildren(); return; }
    let cancelled = false;
    (async () => {
      const page = await pdf.getPage(num + 1);
      const canvas = await renderPageToCanvas(page, zoom * Math.min(2, window.devicePixelRatio || 1));
      if (cancelled) return;
      canvasHost.current?.replaceChildren(canvas);
      page.cleanup();
    })().catch(() => {});
    return () => { cancelled = true; };
  }, [visible, zoom, pdf, num]);

  const frac = (e: { clientX: number; clientY: number }) => {
    const r = wrap.current!.getBoundingClientRect();
    return [clamp((e.clientX - r.left) / r.width), clamp((e.clientY - r.top) / r.height)] as const;
  };

  const onDown = (e: React.PointerEvent) => {
    props.onActive(num);
    if (e.target !== e.currentTarget) return;
    if (tool === 'select') { props.onSelect(null); return; }
    if (tool === 'signature' || tool === 'image') return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    const [x, y] = frac(e);
    const base: Ann = { id: nid(), page: num, type: tool as AnnType, x, y, w: 0, h: 0, color: tool === 'highlight' ? '#ffe600' : props.color, size: props.size, fill: props.fill };
    if (tool === 'draw') base.pts = [[0, 0]];
    setDraft({ ...base, ...(tool === 'draw' ? { pts: [[x, y]] as [number, number][] } : {}) });
  };
  const onMove = (e: React.PointerEvent) => {
    if (dragRef.current) {
      const d = dragRef.current; const [x, y] = frac(e); const dx = x - d.sx, dy = y - d.sy;
      if (d.mode === 'move') props.onChange(d.id, { x: clamp(d.orig.x + dx, 0, 1 - d.orig.w), y: clamp(d.orig.y + dy, 0, 1 - d.orig.h) });
      else props.onChange(d.id, { w: clamp(d.orig.w + dx, 0.01, 1 - d.orig.x), h: clamp(d.orig.h + dy, 0.01, 1 - d.orig.y) });
      return;
    }
    if (!draft) return;
    const [x, y] = frac(e);
    if (draft.type === 'draw') setDraft({ ...draft, pts: [...(draft.pts ?? []), [x, y]] });
    else setDraft({ ...draft, w: x - draft.x, h: y - draft.y });
  };
  const onUp = () => {
    if (dragRef.current) { dragRef.current = null; return; }
    if (!draft) return;
    let a = { ...draft };
    if (a.type === 'draw') {
      const pts = a.pts ?? [];
      if (pts.length < 2) { setDraft(null); return; }
      const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
      const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
      const w = Math.max(x1 - x0, 0.002), h = Math.max(y1 - y0, 0.002);
      a = { ...a, x: x0, y: y0, w, h, pts: pts.map(([px, py]) => [(px - x0) / w, (py - y0) / h] as [number, number]) };
    } else {
      if (a.w < 0) { a.x += a.w; a.w = -a.w; }
      if (a.h < 0) { a.y += a.h; a.h = -a.h; }
      if (a.type === 'text') {
        if (a.w < 0.03) { a.w = Math.min(0.4, 1 - a.x); }
        a.h = Math.max(a.h, ((a.size ?? 14) * 1.6) / info.h);
        a.text = '';
        a.size = props.size;
      } else if (a.w < 0.005 || a.h < 0.005) { setDraft(null); return; }
    }
    props.onAdd(a);
    setDraft(null);
  };

  const startDrag = (e: React.PointerEvent, a: Ann, mode: 'move' | 'resize') => {
    if (tool !== 'select') return;
    e.stopPropagation();
    props.onSelect(a.id);
    props.onChange(a.id, {}, true); // instantané pour « Annuler »
    wrap.current!.setPointerCapture(e.pointerId);
    const [x, y] = frac(e);
    dragRef.current = { mode, id: a.id, sx: x, sy: y, orig: a };
  };

  const renderAnn = (a: Ann, isDraft = false) => {
    const sel = selected === a.id && !isDraft;
    const w = Math.abs(a.w), h = Math.abs(a.h);
    const style: React.CSSProperties = { left: `${(a.w < 0 ? a.x + a.w : a.x) * 100}%`, top: `${(a.h < 0 ? a.y + a.h : a.y) * 100}%`, width: `${w * 100}%`, height: `${h * 100}%` };
    let inner: React.ReactNode = null;
    if (a.type === 'highlight') style.background = (a.color ?? '#ffe600') + '59';
    else if (a.type === 'whiteout') { style.background = '#fff'; style.border = '1px dashed #ddd'; }
    else if (a.type === 'redact') style.background = '#000';
    else if (a.type === 'rect') { style.border = `${(a.size ?? 2) * zoom}px solid ${a.color}`; if (a.fill) style.background = a.color; }
    else if (a.type === 'ellipse') { style.border = `${(a.size ?? 2) * zoom}px solid ${a.color}`; style.borderRadius = '50%'; if (a.fill) style.background = a.color; }
    else if (a.type === 'image') inner = <img src={a.img} draggable={false} style={{ width: '100%', height: '100%', pointerEvents: 'none' }} />;
    else if (a.type === 'draw') {
      const pts = (a.pts ?? []);
      inner = <svg viewBox="0 0 1 1" preserveAspectRatio="none" style={{ width: '100%', height: '100%', overflow: 'visible' }}>
        <polyline fill="none" stroke={a.color} strokeWidth={(a.size ?? 2) * zoom} strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" points={pts.map((p) => p.join(',')).join(' ')} /></svg>;
    } else if (a.type === 'text') {
      inner = <textarea autoFocus={!a.text && sel} value={a.text ?? ''} spellCheck={false} style={{ color: a.color, fontSize: (a.size ?? 14) * zoom }}
        onPointerDown={(e) => { if (tool === 'select') { e.stopPropagation(); props.onSelect(a.id); } }}
        onChange={(e) => props.onChange(a.id, { text: e.target.value })} readOnly={tool !== 'select'} />;
    }
    return (
      <div key={a.id} className={'ann' + (sel ? ' sel' : '')} style={style} onPointerDown={(e) => startDrag(e, a, 'move')}>
        {inner}
        {sel && a.type === 'text' && <div className="grip" onPointerDown={(e) => startDrag(e, a, 'move')}><Icon name="drag" size={14} /></div>}
        {sel && <div className="h" onPointerDown={(e) => startDrag(e, a, 'resize')} />}
      </div>
    );
  };

  return (
    <div ref={wrap} className="pv" data-page={num} style={{ width: info.w * zoom, height: info.h * zoom, cursor: tool === 'select' ? 'default' : 'crosshair' }}>
      <div ref={canvasHost} style={{ position: 'absolute', inset: 0 }} />
      <div className="ov" onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp}>
        {anns.map((a) => renderAnn(a))}
        {draft && renderAnn(draft, true)}
      </div>
    </div>
  );
}

function SignaturePad({ onDone, onCancel }: { onDone: (png: string) => void; onCancel: () => void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [color, setColor] = useState('#101a4a');
  const drawing = useRef(false);
  const pos = (e: React.PointerEvent) => { const r = ref.current!.getBoundingClientRect(); return [((e.clientX - r.left) / r.width) * ref.current!.width, ((e.clientY - r.top) / r.height) * ref.current!.height]; };
  const down = (e: React.PointerEvent) => { drawing.current = true; ref.current!.setPointerCapture(e.pointerId); const ctx = ref.current!.getContext('2d')!; const [x, y] = pos(e); ctx.beginPath(); ctx.moveTo(x, y); ctx.strokeStyle = color; ctx.lineWidth = 5; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; };
  const move = (e: React.PointerEvent) => { if (!drawing.current) return; const ctx = ref.current!.getContext('2d')!; const [x, y] = pos(e); ctx.lineTo(x, y); ctx.stroke(); };
  const done = () => {
    const c = ref.current!; const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
    let x0 = c.width, y0 = c.height, x1 = -1, y1 = -1;
    for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) if (d[(y * c.width + x) * 4 + 3] > 8) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
    if (x1 < 0) return;
    const out = document.createElement('canvas'); out.width = x1 - x0 + 10; out.height = y1 - y0 + 10;
    out.getContext('2d')!.drawImage(c, x0 - 5, y0 - 5, out.width, out.height, 0, 0, out.width, out.height);
    onDone(out.toDataURL('image/png'));
  };
  return (
    <div className="modal" onClick={onCancel}>
      <div className="box" onClick={(e) => e.stopPropagation()}>
        <h3 style={{ marginTop: 0 }}>Dessinez votre signature</h3>
        <canvas ref={ref} width={1000} height={380} onPointerDown={down} onPointerMove={move} onPointerUp={() => (drawing.current = false)} />
        <div className="row" style={{ marginTop: 12 }}>
          <input type="color" value={color} onChange={(e) => setColor(e.target.value)} />
          <button className="btn" onClick={() => ref.current!.getContext('2d')!.clearRect(0, 0, 1000, 380)}>Effacer</button>
          <span className="grow" />
          <button className="btn" onClick={onCancel}>Annuler</button>
          <button className="btn primary" onClick={done}>Insérer</button>
        </div>
      </div>
    </div>
  );
}

export function Editor({ initial }: { initial: File[] }) {
  const [file, setFile] = useState<File | null>(initial[0] ?? null);
  const [bytes, setBytes] = useState<Uint8Array | null>(null);
  const [pdf, setPdf] = useState<any>(null);
  const [infos, setInfos] = useState<PageInfo[]>([]);
  const [anns, setAnns] = useState<Ann[]>([]);
  const history = useRef<Ann[][]>([]);
  const [tool, setTool] = useState<Tool>('select');
  const [sel, setSel] = useState<string | null>(null);
  const [color, setColor] = useState('#e11d48');
  const [size, setSize] = useState(16);
  const [fill, setFill] = useState(false);
  const [zoom, setZoom] = useState(1.2);
  const [active, setActive] = useState(0);
  const [pad, setPad] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const imgInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!file) return;
    let off = false;
    (async () => {
      setError('');
      const b = await readBytes(file);
      const doc = await openPdf(b);
      const list: PageInfo[] = [];
      for (let i = 1; i <= doc.numPages; i++) { const v = (await doc.getPage(i)).getViewport({ scale: 1 }); list.push({ w: v.width, h: v.height }); }
      if (off) return;
      setBytes(b); setPdf(doc); setInfos(list); setAnns([]); history.current = []; setSel(null);
    })().catch((e) => setError(`Ouverture impossible : ${e?.message ?? e}`));
    return () => { off = true; };
  }, [file]);

  const commit = useCallback((next: Ann[]) => { history.current.push(anns); if (history.current.length > 100) history.current.shift(); setAnns(next); }, [anns]);
  const undo = useCallback(() => { const p = history.current.pop(); if (p) { setAnns(p); setSel(null); } }, []);

  const add = (a: Ann) => { commit([...anns, a]); setSel(a.id); if (a.type !== 'text' && a.type !== 'draw') { /* garde l'outil actif pour enchaîner */ } if (a.type === 'text') setTool('select'); };
  const change = (id: string, patch: Partial<Ann>, isCommit?: boolean) => {
    if (isCommit) { history.current.push(anns); return; }
    setAnns((cur) => cur.map((a) => (a.id === id ? { ...a, ...patch } : a)));
  };
  const remove = useCallback(() => { if (sel) { commit(anns.filter((a) => a.id !== sel)); setSel(null); } }, [sel, anns, commit]);

  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      const typing = (e.target as HTMLElement)?.tagName === 'TEXTAREA' || (e.target as HTMLElement)?.tagName === 'INPUT';
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !typing) { e.preventDefault(); undo(); }
      if ((e.key === 'Delete' || e.key === 'Backspace') && !typing) remove();
      if (e.key === 'Escape') { setTool('select'); setSel(null); }
    };
    window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k);
  }, [undo, remove]);

  const placeImage = (dataUrl: string, nw: number, nh: number) => {
    const info = infos[active]; if (!info) return;
    const wPts = Math.min(info.w * 0.35, 220);
    const hPts = (wPts * nh) / nw;
    const a: Ann = { id: nid(), page: active, type: 'image', img: dataUrl, w: wPts / info.w, h: hPts / info.h, x: 0.5 - wPts / info.w / 2, y: 0.5 - hPts / info.h / 2 };
    commit([...anns, a]); setSel(a.id); setTool('select');
  };
  const onImageFile = async (f: File) => {
    const bmp = await createImageBitmap(f, { imageOrientation: 'from-image' } as ImageBitmapOptions);
    const k = Math.min(1, 1400 / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas'); c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
    c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height);
    placeImage(c.toDataURL('image/png'), c.width, c.height);
  };

  const pick = (t: Tool) => {
    setTool(t); setSel(null);
    if (t === 'signature') setPad(true);
    if (t === 'image') imgInput.current?.click();
  };

  const selected = anns.find((a) => a.id === sel);
  const apply = (patch: Partial<Ann>) => { if (selected) { commit(anns.map((a) => (a.id === selected.id ? { ...a, ...patch } : a))); } };

  const save = async () => {
    if (!bytes || !file) return;
    setBusy(true); setError('');
    try {
      const out = await exportAnnotated(bytes, anns);
      downloadBlob(new Blob([out as BlobPart], { type: 'application/pdf' }), `${baseName(file.name)}_edite.pdf`);
    } catch (e: any) { setError(e?.message ?? String(e)); } finally { setBusy(false); }
  };

  const grouped = useMemo(() => infos.map((_, i) => anns.filter((a) => a.page === i)), [anns, infos]);
  const redacts = anns.filter((a) => a.type === 'redact').length;

  if (!file) return <Dropzone accept="pdf" multiple={false} onFiles={(f) => setFile(f[0])} />;

  return (
    <div className="editor">
      <div className="tbar" role="toolbar" aria-label="Outils d'édition">
        <div className="tgroup">
          {TOOLS.slice(0, 2).map((t) => <button key={t.id} className={'btn icon' + (tool === t.id ? ' active' : '')} title={t.label} aria-label={t.label} aria-pressed={tool === t.id} onClick={() => pick(t.id)}><Icon name={t.icon} size={19} /></button>)}
        </div>
        <span className="sep" />
        <div className="tgroup">
          {TOOLS.slice(2, 6).map((t) => <button key={t.id} className={'btn icon' + (tool === t.id ? ' active' : '')} title={t.label} aria-label={t.label} aria-pressed={tool === t.id} onClick={() => pick(t.id)}><Icon name={t.icon} size={19} /></button>)}
        </div>
        <span className="sep" />
        <div className="tgroup">
          {TOOLS.slice(6).map((t) => <button key={t.id} className={'btn icon' + (tool === t.id ? ' active' : '')} title={t.label} aria-label={t.label} aria-pressed={tool === t.id} onClick={() => pick(t.id)}><Icon name={t.icon} size={19} /></button>)}
        </div>
        <span className="sep" />
        <div className="tpanel">
          <input type="color" title="Couleur" aria-label="Couleur" value={selected?.color ?? color} onChange={(e) => (selected && selected.type !== 'image' ? apply({ color: e.target.value }) : setColor(e.target.value))} />
          <input type="number" title="Taille du texte ou épaisseur du trait (pt)" aria-label="Taille" min={1} max={120} value={selected?.size ?? size} onChange={(e) => (selected ? apply({ size: Number(e.target.value) }) : setSize(Number(e.target.value)))} />
          <label className="switch" style={{ fontSize: 13 }}><input type="checkbox" checked={selected?.fill ?? fill} onChange={(e) => (selected ? apply({ fill: e.target.checked }) : setFill(e.target.checked))} /><span className="track" />Plein</label>
        </div>
        <span className="sep" />
        <button className="btn icon" title="Annuler (Ctrl+Z)" aria-label="Annuler" onClick={undo} disabled={!history.current.length}><Icon name="undo" size={18} /></button>
        <button className="btn icon" title="Supprimer la sélection" aria-label="Supprimer" onClick={remove} disabled={!sel}><Icon name="trash" size={18} /></button>
        <span className="sep" />
        <button className="btn icon" aria-label="Zoom arrière" onClick={() => setZoom((z) => Math.max(0.5, +(z - 0.2).toFixed(2)))}><Icon name="minus" size={17} /></button>
        <span className="zoomval">{Math.round(zoom * 100)} %</span>
        <button className="btn icon" aria-label="Zoom avant" onClick={() => setZoom((z) => Math.min(3, +(z + 0.2).toFixed(2)))}><Icon name="plus" size={17} /></button>
        <span className="grow" />
        <button className="btn small" onClick={() => setFile(null)}>Changer de fichier</button>
        <button className="btn primary" style={{ padding: '8px 16px', fontSize: 14 }} onClick={save} disabled={busy || !bytes}>{busy ? <Spinner /> : <Icon name="download" size={16} />}{busy ? 'Export en cours' : 'Enregistrer'}</button>
      </div>
      {error && <div className="err" role="alert"><Icon name="alert" /><div>{error}</div></div>}
      {redacts > 0 && <div className="note">{redacts} zone(s) de caviardage : à l'export, les pages concernées sont rasterisées pour supprimer réellement le texte caché.</div>}
      <div className="pages">
        {!pdf && <div className="muted">Chargement du document</div>}
        {pdf && infos.map((info, i) => (
          <PageView key={i} pdf={pdf} num={i} info={info} zoom={zoom} anns={grouped[i]} tool={tool} selected={sel} color={color} size={size} fill={fill}
            onSelect={setSel} onActive={setActive} onAdd={add} onChange={change} />
        ))}
      </div>
      <input ref={imgInput} hidden type="file" accept="image/*" onChange={(e) => { const f = e.target.files?.[0]; if (f) onImageFile(f); e.target.value = ''; }} />
      {pad && <SignaturePad onCancel={() => { setPad(false); setTool('select'); }} onDone={(png) => { setPad(false); const im = new Image(); im.onload = () => placeImage(png, im.width, im.height); im.src = png; }} />}
    </div>
  );
}
