import { useEffect, useState } from 'react';
import type { Options } from '../core/types';
import { defaultsOf, outputToFile } from '../core/util';
import { TOOLS, toolById } from '../tools';
import { Dropzone, FileList, OptionsForm, ProgressBar, Results, runTool, useRunner } from './Common';

interface Step { toolId: string; opts: Options }
interface Saved { name: string; steps: Step[] }

const usable = TOOLS.filter((t) => !t.custom && !t.exactFiles);
const mk = (toolId: string, over: Options = {}): Step => ({ toolId, opts: { ...defaultsOf(toolById(toolId)!.options), ...over } });

const TEMPLATES: Saved[] = [
  { name: 'Scan propre : images → PDF → OCR → compression', steps: [mk('scan-to-pdf'), mk('ocr'), mk('compress')] },
  { name: 'Envoi externe : anonymiser → filigrane → compresser', steps: [mk('metadata'), mk('watermark', { text: 'COPIE' }), mk('compress')] },
  { name: 'Dossier : fusionner → numéroter → compresser', steps: [mk('merge', { sort: 'name' }), mk('page-numbers'), mk('compress')] },
];

const KEY = 'allwithpdf.workflows.v1';
const load = (): Saved[] => { try { return JSON.parse(localStorage.getItem(KEY) ?? '[]'); } catch { return []; } };

export function Workflows() {
  const [steps, setSteps] = useState<Step[]>(TEMPLATES[2].steps);
  const [saved, setSaved] = useState<Saved[]>(load);
  const [name, setName] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const r = useRunner();
  useEffect(() => { try { localStorage.setItem(KEY, JSON.stringify(saved)); } catch { /* stockage indisponible */ } }, [saved]);

  const first = toolById(steps[0]?.toolId);
  const setStep = (i: number, s: Step) => setSteps((c) => c.map((x, k) => (k === i ? s : x)));
  const move = (i: number, d: number) => setSteps((c) => { const a = [...c]; const j = i + d; if (j < 0 || j >= a.length) return c; [a[i], a[j]] = [a[j], a[i]]; return a; });

  const run = () => r.run(async (progress) => {
    let cur = files;
    let outs: any[] = [];
    for (let i = 0; i < steps.length; i++) {
      const t = toolById(steps[i].toolId)!;
      const wantPdf = t.accept === 'pdf';
      if (cur.some((f) => (f.type === 'application/pdf' || /\.pdf$/i.test(f.name)) !== wantPdf)) throw new Error(`Étape ${i + 1} (${t.name}) : elle attend ${wantPdf ? 'des PDF' : 'des images'} en entrée, mais l'étape précédente ne produit pas ce type de fichier.`);
      outs = await runTool(t, cur, steps[i].opts, (x, m) => progress((i + x) / steps.length, `Étape ${i + 1}/${steps.length} · ${t.name}${m ? ' — ' + m : ''}`));
      if (i < steps.length - 1) {
        if (!t.outputsPdf) throw new Error(`« ${t.name} » ne produit pas de PDF : placez-le en dernière étape.`);
        cur = outs.map(outputToFile);
      }
    }
    return outs;
  });

  return (
    <div>
      <div className="page-title"><span className="ic">⛓️</span><h1>Workflows</h1></div>
      <p className="lead">Enchaînez plusieurs outils en un clic et rejouez la chaîne sur autant de fichiers que vous voulez. Vos workflows sont enregistrés sur cet appareil.</p>
      <div className="panel">
        <div className="row"><b>Modèles :</b>{TEMPLATES.map((t) => <button key={t.name} className="btn small" onClick={() => { setSteps(structuredClone(t.steps)); setFiles([]); r.reset(); }}>{t.name}</button>)}</div>
        {saved.length > 0 && <div className="row" style={{ marginTop: 8 }}><b>Mes workflows :</b>{saved.map((s) => (
          <span key={s.name} className="row" style={{ gap: 2 }}><button className="btn small" onClick={() => { setSteps(structuredClone(s.steps)); setFiles([]); r.reset(); }}>{s.name}</button><button className="btn small danger" onClick={() => setSaved((c) => c.filter((x) => x.name !== s.name))}>✕</button></span>))}</div>}

        {steps.map((s, i) => {
          const t = toolById(s.toolId)!;
          return (
            <div className="wf-step" key={i}>
              <div className="wf-head">
                <b>{i + 1}.</b>
                <select value={s.toolId} onChange={(e) => setStep(i, mk(e.target.value))}>{usable.map((u) => <option key={u.id} value={u.id}>{u.icon} {u.name}</option>)}</select>
                <button className="btn small" onClick={() => move(i, -1)} disabled={i === 0}>↑</button>
                <button className="btn small" onClick={() => move(i, 1)} disabled={i === steps.length - 1}>↓</button>
                <button className="btn small danger" onClick={() => setSteps((c) => c.filter((_, k) => k !== i))}>✕</button>
              </div>
              <OptionsForm defs={t.options} value={s.opts} onChange={(o) => setStep(i, { ...s, opts: o })} />
            </div>
          );
        })}
        <div className="row">
          <button className="btn" onClick={() => setSteps((c) => [...c, mk('compress')])}>＋ Ajouter une étape</button>
          <span className="grow" />
          <input className="search" style={{ maxWidth: 220, padding: 8 }} placeholder="Nom du workflow" value={name} onChange={(e) => setName(e.target.value)} />
          <button className="btn" disabled={!name.trim() || !steps.length} onClick={() => { setSaved((c) => [...c.filter((x) => x.name !== name.trim()), { name: name.trim(), steps: structuredClone(steps) }]); setName(''); }}>💾 Enregistrer</button>
        </div>
      </div>

      {first && steps.length > 0 && (
        <div className="panel" style={{ marginTop: 16 }}>
          <Dropzone accept={first.accept} multiple onFiles={(f) => { r.reset(); setFiles((c) => [...c, ...f]); }} label={`Déposez vos ${first.accept === 'pdf' ? 'PDF' : 'images'} (autant que vous voulez)`} />
          <FileList files={files} onChange={setFiles} reorder />
          {files.length > 0 && <div className="row"><button className="btn primary" disabled={r.busy} onClick={run}>{r.busy ? 'Traitement…' : `▶ Lancer (${steps.length} étape${steps.length > 1 ? 's' : ''})`}</button></div>}
          <ProgressBar busy={r.busy} ratio={r.ratio} msg={r.msg} />
          {r.error && <div className="err">{r.error}</div>}
          {r.outputs && <Results outputs={r.outputs} canChain={false} />}
        </div>
      )}
    </div>
  );
}
