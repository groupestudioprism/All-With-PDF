import { useCallback, useEffect, useRef, useState } from 'react';
import type { OptionDef, Options, Progress, Tool, ToolOutput } from '../core/types';
import { downloadBlob, formatBytes, outputToFile, readBytes, sizeOf, toBlob, zipOutputs } from '../core/util';
import { canvasToBlob, openPdf, renderPageToCanvas } from '../core/pdfjs';
import { setHandoff } from '../core/store';
import { TOOLS } from '../tools';
import { Icon } from './Icon';

export function Spinner() { return <span className="spin" aria-hidden="true" />; }

export function Dropzone({ accept, multiple, onFiles, label, compact }: { accept: Tool['accept']; multiple: boolean; onFiles: (f: File[]) => void; label?: string; compact?: boolean }) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const [rejected, setRejected] = useState(false);
  const ok = (f: File) =>
    accept === 'pdf' ? f.type === 'application/pdf' || /\.pdf$/i.test(f.name)
    : accept === 'text' ? /\.(txt|md|markdown|csv|log)$/i.test(f.name) || f.type.startsWith('text/')
    : accept === 'word' ? /\.docx$/i.test(f.name)
    : f.type.startsWith('image/') || /\.(jpe?g|png|webp|gif|bmp|avif)$/i.test(f.name);
  const kind = { pdf: 'PDF', image: 'images', text: 'fichiers texte (.txt, .md)', word: 'documents Word (.docx)' }[accept];
  const accepts = { pdf: 'application/pdf,.pdf', image: 'image/*', text: '.txt,.md,.markdown,.csv,.log,text/*', word: '.docx' }[accept];
  const take = (list: FileList | File[]) => {
    const all = [...list];
    const good = all.filter(ok);
    setRejected(good.length < all.length);
    if (good.length) onFiles(multiple ? good : good.slice(0, 1));
  };
  return (
    <div
      className={'drop' + (over ? ' over' : '') + (compact ? ' compact' : '')}
      role="button" tabIndex={0}
      onClick={() => input.current?.click()}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.current?.click(); } }}
      onDragOver={(e) => { e.preventDefault(); setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); setOver(false); take(e.dataTransfer.files); }}
    >
      <span className="tile"><Icon name="upload" size={compact ? 18 : 24} /></span>
      <div>
        <b>{label ?? `${multiple ? 'Déposez' : 'Déposez'} vos ${kind} ici`}</b>
        <small>ou <u>parcourez votre ordinateur</u>. Rien n'est envoyé sur Internet.</small>
        {rejected && <small className="warn">Certains fichiers ont été ignorés : seuls les {kind} sont acceptés ici.</small>}
      </div>
      <input ref={input} hidden type="file" multiple={multiple} accept={accepts} onChange={(e) => { take(e.target.files ?? []); e.target.value = ''; }} />
    </div>
  );
}

const meta = new WeakMap<File, { thumb?: string; pages?: number }>();
function useFileMeta(f: File) {
  const [m, setM] = useState(meta.get(f) ?? {});
  useEffect(() => {
    if (meta.has(f)) return;
    let off = false;
    (async () => {
      let r: { thumb?: string; pages?: number } = {};
      if (f.type.startsWith('image/')) r = { thumb: URL.createObjectURL(f) };
      else if ((f.type === 'application/pdf' || /\.pdf$/i.test(f.name)) && f.size < 80 * 1024 * 1024) {
        try {
          const pdf = await openPdf(await readBytes(f));
          const page = await pdf.getPage(1);
          const canvas = await renderPageToCanvas(page, 0.3);
          r = { pages: pdf.numPages, thumb: URL.createObjectURL(await canvasToBlob(canvas, 'image/jpeg', 0.7)) };
        } catch { r = {}; }
      }
      meta.set(f, r);
      if (!off) setM(r);
    })();
    return () => { off = true; };
  }, [f]);
  return m;
}

function FileRow({ f, index, count, reorder, onMove, onRemove }: { f: File; index: number; count: number; reorder: boolean; onMove: (d: number) => void; onRemove: () => void }) {
  const m = useFileMeta(f);
  return (
    <div className="file">
      <div className="fthumb">{m.thumb ? <img src={m.thumb} alt="" /> : <Icon name={f.type.startsWith('image/') ? 'image' : 'file'} size={20} />}</div>
      <div className="fmeta">
        <div className="n" title={f.name}>{f.name}</div>
        <small>{formatBytes(f.size)}{m.pages ? ` · ${m.pages} page${m.pages > 1 ? 's' : ''}` : ''}</small>
      </div>
      {reorder && count > 1 && (
        <div className="seg-btns">
          <button className="btn small icon ghost" aria-label="Monter" onClick={() => onMove(-1)} disabled={index === 0}><Icon name="up" size={15} /></button>
          <button className="btn small icon ghost" aria-label="Descendre" onClick={() => onMove(1)} disabled={index === count - 1}><Icon name="down" size={15} /></button>
        </div>
      )}
      <button className="btn small icon ghost danger" aria-label="Retirer" onClick={onRemove}><Icon name="close" size={15} /></button>
    </div>
  );
}

export function FileList({ files, onChange, reorder }: { files: File[]; onChange: (f: File[]) => void; reorder: boolean }) {
  const move = (i: number, d: number) => { const a = [...files]; const j = i + d; if (j < 0 || j >= a.length) return; [a[i], a[j]] = [a[j], a[i]]; onChange(a); };
  return (
    <div className="files">
      {files.map((f, i) => <FileRow key={f.name + i + f.size} f={f} index={i} count={files.length} reorder={reorder} onMove={(d) => move(i, d)} onRemove={() => onChange(files.filter((_, k) => k !== i))} />)}
    </div>
  );
}

function Field({ d, value, set }: { d: OptionDef; value: any; set: (v: any) => void }) {
  if (d.type === 'checkbox') return <label className="switch"><input type="checkbox" checked={!!value} onChange={(e) => set(e.target.checked)} /><span className="track" /><span>{d.label}</span></label>;
  return (
    <>
      <label className="lbl">{d.label}</label>
      {d.type === 'select' ? (
        d.choices.length <= 3 && d.choices.every((c) => c.label.length <= 24)
          ? <div className="segmented" role="radiogroup">{d.choices.map((c) => <button type="button" role="radio" aria-checked={value === c.value} key={c.value} className={value === c.value ? 'on' : ''} onClick={() => set(c.value)}>{c.label}</button>)}</div>
          : <select className="input" value={value} onChange={(e) => set(e.target.value)}>{d.choices.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}</select>
      ) : d.type === 'number' ? (
        <div className="stepper">
          <button type="button" aria-label="Diminuer" onClick={() => set(Math.max(d.min ?? -Infinity, +(Number(value) - (d.step ?? 1)).toFixed(4)))}><Icon name="minus" size={14} /></button>
          <input type="number" value={value} min={d.min} max={d.max} step={d.step ?? 1} onChange={(e) => set(e.target.value === '' ? d.default : Number(e.target.value))} />
          <button type="button" aria-label="Augmenter" onClick={() => set(Math.min(d.max ?? Infinity, +(Number(value) + (d.step ?? 1)).toFixed(4)))}><Icon name="plus" size={14} /></button>
        </div>
      ) : d.type === 'color' ? (
        <label className="colorfield"><input type="color" value={value} onChange={(e) => set(e.target.value)} /><span>{String(value).toUpperCase()}</span></label>
      ) : d.type === 'password' ? (
        <input className="input" type="password" autoComplete="new-password" value={value} placeholder={d.placeholder} onChange={(e) => set(e.target.value)} />
      ) : (
        <input className="input" type="text" value={value} placeholder={d.placeholder} onChange={(e) => set(e.target.value)} />
      )}
    </>
  );
}

export function OptionsForm({ defs, value, onChange }: { defs: OptionDef[]; value: Options; onChange: (o: Options) => void }) {
  if (!defs.length) return null;
  const set = (k: string, v: any) => onChange({ ...value, [k]: v });
  return (
    <div className="opts">
      {defs.map((d) => (
        <div key={d.key} className={'opt' + (d.type === 'checkbox' ? ' check' : '') + (d.type === 'select' && d.choices.length <= 3 && d.choices.every((c) => c.label.length <= 24) ? ' wide' : '')}>
          <Field d={d} value={value[d.key]} set={(v) => set(d.key, v)} />
          {d.help && <div className="help">{d.help}</div>}
        </div>
      ))}
    </div>
  );
}

/** Exécute un outil sur les fichiers donnés (par fichier, ou groupé pour les outils « multiple »). */
export async function runTool(tool: Tool, files: File[], opts: Options, progress: Progress): Promise<ToolOutput[]> {
  if (tool.multiple || tool.exactFiles) return tool.run(files, opts, progress);
  const all: ToolOutput[] = [];
  for (let i = 0; i < files.length; i++) {
    const res = await tool.run([files[i]], opts, (r, m) => progress((i + r) / files.length, files.length > 1 ? `${files[i].name}${m ? ' : ' + m : ''}` : m));
    all.push(...res);
  }
  return all;
}

export function useRunner() {
  const [busy, setBusy] = useState(false);
  const [ratio, setRatio] = useState(0);
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');
  const [outputs, setOutputs] = useState<ToolOutput[] | null>(null);
  const run = useCallback(async (fn: (p: Progress) => Promise<ToolOutput[]>) => {
    setBusy(true); setError(''); setOutputs(null); setRatio(0); setMsg('');
    try {
      const res = await fn((r, m) => { setRatio(Math.min(1, r)); if (m !== undefined) setMsg(m); });
      setOutputs(res);
    } catch (e: any) {
      console.error(e);
      setError(e?.message ?? String(e));
    } finally { setBusy(false); }
  }, []);
  return { busy, ratio, msg, error, outputs, run, reset: () => { setOutputs(null); setError(''); } };
}

export function ProgressBar({ busy, ratio, msg }: { busy: boolean; ratio: number; msg: string }) {
  if (!busy) return null;
  return (
    <div className="progress" role="status" aria-live="polite">
      <div className="bar"><div style={{ width: `${Math.max(3, Math.round(ratio * 100))}%` }} /></div>
      <div className="pmeta"><span>{msg || 'Traitement en cours'}</span><span>{Math.round(ratio * 100)} %</span></div>
    </div>
  );
}

export function ErrorBox({ children }: { children: React.ReactNode }) {
  return <div className="err" role="alert"><Icon name="alert" /><div>{children}</div></div>;
}

export function RunButton({ busy, onClick, children, disabled }: { busy: boolean; onClick: () => void; children: React.ReactNode; disabled?: boolean }) {
  return <button className="btn primary lg" disabled={busy || disabled} onClick={onClick}>{busy ? <Spinner /> : <Icon name="play" size={16} />}{busy ? 'Traitement en cours' : children}</button>;
}

const extIcon = (o: ToolOutput) => (o.mime === 'application/pdf' ? 'file' : o.mime.startsWith('image/') ? 'image' : o.mime === 'text/html' ? 'search' : o.mime.includes('word') ? 'word' : o.mime.includes('presentation') ? 'slides' : o.mime === 'text/csv' ? 'table' : 'text');

export function Results({ outputs, canChain = true }: { outputs: ToolOutput[]; canChain?: boolean }) {
  const [chainTo, setChainTo] = useState('');
  const allPdf = outputs.every((o) => o.mime === 'application/pdf');
  const total = outputs.reduce((s, o) => s + sizeOf(o), 0);
  const html = outputs.find((o) => o.mime === 'text/html');
  const preview = () => html && window.open(URL.createObjectURL(toBlob(html)), '_blank');
  const notes = [...new Set(outputs.map((o) => o.note).filter(Boolean))] as string[];
  return (
    <div className="result">
      <div className="rhead">
        <span className="rcheck"><Icon name="check" size={18} /></span>
        <div><b>Terminé</b><div className="muted">{outputs.length} fichier{outputs.length > 1 ? 's' : ''} · {formatBytes(total)}</div></div>
      </div>
      {notes.map((n, i) => <div className="rnote" key={i}><Icon name="info" size={16} />{n}</div>)}
      <div className="files">
        {outputs.map((o, i) => (
          <div className="file" key={i}>
            <div className="fthumb"><Icon name={extIcon(o)} size={20} /></div>
            <div className="fmeta"><div className="n" title={o.name}>{o.name}</div><small>{formatBytes(sizeOf(o))}</small></div>
            <button className="btn small" onClick={() => downloadBlob(toBlob(o), o.name)}><Icon name="download" size={15} /> Télécharger</button>
          </div>
        ))}
      </div>
      <div className="row ractions">
        {outputs.length === 1 && <button className="btn primary" onClick={() => downloadBlob(toBlob(outputs[0]), outputs[0].name)}><Icon name="download" /> Télécharger</button>}
        {outputs.length > 1 && <button className="btn primary" onClick={async () => downloadBlob(await zipOutputs(outputs), 'resultat.zip')}><Icon name="download" /> Tout télécharger (.zip)</button>}
        {html && <button className="btn" onClick={preview}><Icon name="search" /> Ouvrir le rapport</button>}
        {canChain && allPdf && (
          <span className="chain">
            <select className="input" value={chainTo} onChange={(e) => setChainTo(e.target.value)} aria-label="Continuer avec un autre outil">
              <option value="">Continuer avec un autre outil</option>
              {TOOLS.filter((t) => t.accept === 'pdf').map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
            <button className="btn" disabled={!chainTo} onClick={() => { setHandoff(outputs.map(outputToFile)); location.hash = `#/tool/${chainTo}`; }}>Ouvrir <Icon name="arrow" size={15} /></button>
          </span>
        )}
      </div>
    </div>
  );
}
