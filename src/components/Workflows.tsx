import { useEffect, useState } from 'react';
import type { Options } from '../core/types';
import { defaultsOf, outputToFile } from '../core/util';
import { TOOLS, toolById } from '../tools';
import { Icon } from './Icon';
import { Dropzone, ErrorBox, FileList, OptionsForm, ProgressBar, Results, RunButton, runTool, useRunner } from './Common';

interface Step { toolId: string; opts: Options }
interface Saved { name: string; steps: Step[]; desc?: string }

const usable = TOOLS.filter((t) => !t.custom && !t.exactFiles);
const mk = (toolId: string, over: Options = {}): Step => ({ toolId, opts: { ...defaultsOf(toolById(toolId)!.options), ...over } });

const TEMPLATES: Saved[] = [
  { name: 'Scan propre', desc: 'Images, mode scan, OCR puis compression', steps: [mk('scan-to-pdf'), mk('ocr'), mk('compress')] },
  { name: 'Envoi externe', desc: 'Anonymiser, filigrane, compression', steps: [mk('metadata'), mk('watermark', { text: 'COPIE' }), mk('compress')] },
  { name: 'Dossier complet', desc: 'Fusion, numérotation, compression', steps: [mk('merge', { sort: 'name' }), mk('page-numbers'), mk('compress')] },
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
      if (cur.some((f) => (f.type === 'application/pdf' || /\.pdf$/i.test(f.name)) !== wantPdf)) throw new Error(`Étape ${i + 1} (${t.name}) : elle attend ${wantPdf ? 'des PDF' : 'un autre type de fichier'} en entrée, mais l'étape précédente ne produit pas ce type de fichier.`);
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
      <div className="page-title"><span className="tile big"><Icon name="workflow" size={26} /></span><div><div className="eyebrow">Automatisation</div><h1>Workflows</h1></div></div>
      <p className="lead">Enchaînez plusieurs outils en un clic et rejouez la chaîne sur autant de fichiers que vous voulez. Vos workflows sont enregistrés sur cet appareil.</p>
      <div className="panel">
        <div className="subh">Modèles</div>
        <div className="tpl">{TEMPLATES.map((t) => <button key={t.name} onClick={() => { setSteps(structuredClone(t.steps)); setFiles([]); r.reset(); }}><b>{t.name}</b><span>{t.desc}</span></button>)}</div>
        {saved.length > 0 && <><div className="subh" style={{ marginTop: 18 }}>Mes workflows</div><div className="row">{saved.map((s) => (
          <span key={s.name} className="row" style={{ gap: 2 }}><button className="btn small" onClick={() => { setSteps(structuredClone(s.steps)); setFiles([]); r.reset(); }}>{s.name}</button><button className="btn small danger" onClick={() => setSaved((c) => c.filter((x) => x.name !== s.name))}><Icon name="close" size={14} /></button></span>))}</div></>}

        {steps.map((s, i) => {
          const t = toolById(s.toolId)!;
          return (
            <div className="wf-step" key={i}>
              <div className="wf-head">
                <span className="num">{i + 1}</span>
                <select className="input" value={s.toolId} onChange={(e) => setStep(i, mk(e.target.value))}>{usable.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select>
                <button className="btn small icon" aria-label="Monter" onClick={() => move(i, -1)} disabled={i === 0}><Icon name="up" size={15} /></button>
                <button className="btn small icon" aria-label="Descendre" onClick={() => move(i, 1)} disabled={i === steps.length - 1}><Icon name="down" size={15} /></button>
                <button className="btn small icon danger" aria-label="Retirer l'étape" onClick={() => setSteps((c) => c.filter((_, k) => k !== i))}><Icon name="close" size={15} /></button>
              </div>
              <OptionsForm defs={t.options} value={s.opts} onChange={(o) => setStep(i, { ...s, opts: o })} />
            </div>
          );
        })}
        <div className="row">
          <button className="btn" onClick={() => setSteps((c) => [...c, mk('compress')])}><Icon name="plus" size={15} /> Ajouter une étape</button>
          <span className="grow" />
          <input className="search" style={{ maxWidth: 220, padding: 8 }} placeholder="Nom du workflow" value={name} onChange={(e) => setName(e.target.value)} />
          <button className="btn" disabled={!name.trim() || !steps.length} onClick={() => { setSaved((c) => [...c.filter((x) => x.name !== name.trim()), { name: name.trim(), steps: structuredClone(steps) }]); setName(''); }}><Icon name="save" size={15} /> Enregistrer</button>
        </div>
      </div>

      {first && steps.length > 0 && (
        <div className="panel" style={{ marginTop: 16 }}>
          <Dropzone accept={first.accept} multiple onFiles={(f) => { r.reset(); setFiles((c) => [...c, ...f]); }} />
          <FileList files={files} onChange={setFiles} reorder />
          {files.length > 0 && <div className="row"><RunButton busy={r.busy} onClick={run}>{`Lancer (${steps.length} étape${steps.length > 1 ? 's' : ''})`}</RunButton></div>}
          <ProgressBar busy={r.busy} ratio={r.ratio} msg={r.msg} />
          {r.error && <ErrorBox>{r.error}</ErrorBox>}
          {r.outputs && <Results outputs={r.outputs} canChain={false} />}
        </div>
      )}
    </div>
  );
}
