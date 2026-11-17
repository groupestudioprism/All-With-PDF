import { useCallback, useRef, useState } from 'react';
import type { OptionDef, Options, Progress, Tool, ToolOutput } from '../core/types';
import { downloadBlob, formatBytes, outputToFile, sizeOf, toBlob, zipOutputs } from '../core/util';
import { setHandoff } from '../core/store';
import { TOOLS } from '../tools';

export function Dropzone({ accept, multiple, onFiles, label }: { accept: 'pdf' | 'image'; multiple: boolean; onFiles: (f: File[]) => void; label?: string }) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const filter = (list: FileList | File[]) =>
    [...list].filter((f) => (accept === 'pdf' ? f.type === 'application/pdf' || /\.pdf$/i.test(f.name) : f.type.startsWith('image/') || /\.(jpe?g|png|webp|gif|bmp|avif)$/i.test(f.name)));
  return (
    <div
      className={'drop' + (over ? ' over' : '')}
      onClick={() => input.current?.click()}
      onDragOver={(e) => { e.preventDefault(); setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); setOver(false); const f = filter(e.dataTransfer.files); if (f.length) onFiles(multiple ? f : f.slice(0, 1)); }}
    >
      <b>{label ?? (accept === 'pdf' ? 'Déposez vos PDF ici' : 'Déposez vos images ici')}</b>
      <small>ou cliquez pour parcourir — aucun envoi : tout reste sur votre appareil</small>
      <input ref={input} hidden type="file" multiple={multiple} accept={accept === 'pdf' ? 'application/pdf,.pdf' : 'image/*'} onChange={(e) => { const f = filter(e.target.files ?? []); if (f.length) onFiles(multiple ? f : f.slice(0, 1)); e.target.value = ''; }} />
    </div>
  );
}

export function FileList({ files, onChange, reorder }: { files: File[]; onChange: (f: File[]) => void; reorder: boolean }) {
  const move = (i: number, d: number) => { const a = [...files]; const j = i + d; if (j < 0 || j >= a.length) return; [a[i], a[j]] = [a[j], a[i]]; onChange(a); };
  return (
    <div className="files">
      {files.map((f, i) => (
        <div className="file" key={f.name + i + f.size}>
          <span>{f.type.startsWith('image/') ? '🖼️' : '📄'}</span>
          <span className="n">{f.name}</span>
          <small>{formatBytes(f.size)}</small>
          {reorder && files.length > 1 && (<><button className="btn small" onClick={() => move(i, -1)} disabled={i === 0}>↑</button><button className="btn small" onClick={() => move(i, 1)} disabled={i === files.length - 1}>↓</button></>)}
          <button className="btn small danger" onClick={() => onChange(files.filter((_, k) => k !== i))}>✕</button>
        </div>
      ))}
    </div>
  );
}

export function OptionsForm({ defs, value, onChange }: { defs: OptionDef[]; value: Options; onChange: (o: Options) => void }) {
  if (!defs.length) return null;
  const set = (k: string, v: any) => onChange({ ...value, [k]: v });
  return (
    <div className="opts">
      {defs.map((d) => (
        <div key={d.key} className={'opt' + (d.type === 'checkbox' ? ' check' : '')}>
          {d.type === 'checkbox' ? (
            <label><input type="checkbox" checked={!!value[d.key]} onChange={(e) => set(d.key, e.target.checked)} /> {d.label}</label>
          ) : (
            <>
              <label>{d.label}</label>
              {d.type === 'select' ? (
                <select value={value[d.key]} onChange={(e) => set(d.key, e.target.value)}>{d.choices.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}</select>
              ) : d.type === 'number' ? (
                <input type="number" value={value[d.key]} min={d.min} max={d.max} step={d.step ?? 1} onChange={(e) => set(d.key, e.target.value === '' ? d.default : Number(e.target.value))} />
              ) : d.type === 'color' ? (
                <input type="color" value={value[d.key]} onChange={(e) => set(d.key, e.target.value)} />
              ) : (
                <input type="text" value={value[d.key]} placeholder={d.placeholder} onChange={(e) => set(d.key, e.target.value)} />
              )}
            </>
          )}
          {d.help && <div className="note">{d.help}</div>}
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
    const res = await tool.run([files[i]], opts, (r, m) => progress((i + r) / files.length, files.length > 1 ? `${files[i].name}${m ? ' — ' + m : ''}` : m));
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
  return (<div><div className="bar"><div style={{ width: `${Math.round(ratio * 100)}%` }} /></div><div className="note">{Math.round(ratio * 100)} % {msg && `— ${msg}`}</div></div>);
}

export function Results({ outputs, canChain = true }: { outputs: ToolOutput[]; canChain?: boolean }) {
  const [chainTo, setChainTo] = useState('');
  const allPdf = outputs.every((o) => o.mime === 'application/pdf');
  const total = outputs.reduce((s, o) => s + sizeOf(o), 0);
  const html = outputs.find((o) => o.mime === 'text/html');
  const preview = () => html && window.open(URL.createObjectURL(toBlob(html)), '_blank');
  return (
    <div className="ok-box">
      <div className="row"><b>✅ Terminé — {outputs.length} fichier{outputs.length > 1 ? 's' : ''} ({formatBytes(total)})</b></div>
      {outputs.map((o, i) => o.note && <div key={i} className="note">{o.name} : {o.note}</div>)}
      <div className="files">
        {outputs.map((o, i) => (
          <div className="file" key={i}><span className="n">{o.name}</span><small>{formatBytes(sizeOf(o))}</small>
            <button className="btn small" onClick={() => downloadBlob(toBlob(o), o.name)}>Télécharger</button></div>
        ))}
      </div>
      <div className="row">
        {outputs.length === 1 && <button className="btn primary" onClick={() => downloadBlob(toBlob(outputs[0]), outputs[0].name)}>⬇ Télécharger</button>}
        {outputs.length > 1 && <button className="btn primary" onClick={async () => downloadBlob(await zipOutputs(outputs), 'resultat.zip')}>⬇ Tout télécharger (.zip)</button>}
        {html && <button className="btn" onClick={preview}>👁 Ouvrir le rapport</button>}
        {canChain && allPdf && (
          <>
            <select className="btn" value={chainTo} onChange={(e) => setChainTo(e.target.value)}>
              <option value="">Continuer avec un autre outil…</option>
              {TOOLS.filter((t) => t.accept === 'pdf').map((t) => <option key={t.id} value={t.id}>{t.icon} {t.name}</option>)}
            </select>
            {chainTo && <button className="btn" onClick={() => { setHandoff(outputs.map(outputToFile)); location.hash = `#/tool/${chainTo}`; }}>Go →</button>}
          </>
        )}
      </div>
    </div>
  );
}
