import { useState } from 'react';
import type { Tool } from '../core/types';
import { defaultsOf } from '../core/util';
import { takeHandoff } from '../core/store';
import { Dropzone, ErrorBox, FileList, OptionsForm, ProgressBar, Results, RunButton, runTool, useRunner } from './Common';
import { Organizer } from './Organizer';
import { Editor } from './Editor';
import { FormFiller } from './FormFiller';
import { Icon } from './Icon';
import { CATEGORIES } from '../core/types';

export function ToolPage({ tool }: { tool: Tool }) {
  const [files, setFiles] = useState<File[]>(() => takeHandoff() ?? []);
  const [opts, setOpts] = useState(() => defaultsOf(tool.options));
  const r = useRunner();
  const [initialFiles] = useState(files);
  const need = tool.exactFiles ?? 1;
  const ready = files.length >= need && (!tool.exactFiles || files.length === tool.exactFiles);
  const add = (f: File[]) => { r.reset(); setFiles((cur) => (tool.multiple ? [...cur, ...f] : f)); };
  const cat = CATEGORIES.find((c) => c.id === tool.category)!;
  const generic = !tool.custom;

  return (
    <div>
      <div className="page-title">
        <span className="tile big"><Icon name={tool.icon} size={26} /></span>
        <div><div className="eyebrow">{cat.label}</div><h1>{tool.name}</h1></div>
      </div>
      <p className="lead">{tool.description}</p>
      {tool.custom === 'organize' ? <Organizer initial={initialFiles} />
        : tool.custom === 'editor' ? <Editor initial={initialFiles} />
        : tool.custom === 'forms' ? <FormFiller initial={initialFiles} />
        : generic && (
          <div className="panel steps">
            <section className="step">
              <div className="step-h"><span className="n">1</span><h2>{tool.multiple ? 'Vos fichiers' : 'Votre fichier'}</h2></div>
              {(tool.multiple || !files.length) && <Dropzone accept={tool.accept} multiple={tool.multiple} compact={files.length > 0} onFiles={add}
                label={tool.exactFiles ? `Déposez les ${tool.exactFiles} PDF à comparer` : undefined} />}
              <FileList files={files} onChange={(f) => { r.reset(); setFiles(f); }} reorder={tool.multiple} />
              {tool.exactFiles && files.length > 0 && files.length !== tool.exactFiles && <div className="hint"><Icon name="info" size={16} />Il faut exactement {tool.exactFiles} fichiers.</div>}
            </section>
            {files.length > 0 && tool.options.length > 0 && (
              <section className="step">
                <div className="step-h"><span className="n">2</span><h2>Réglages</h2></div>
                <OptionsForm defs={tool.options} value={opts} onChange={setOpts} />
              </section>
            )}
            {ready && (
              <section className="step">
                <div className="row">
                  <RunButton busy={r.busy} onClick={() => r.run((p) => runTool(tool, files, opts, p))}>{tool.name}</RunButton>
                  {!tool.multiple && files.length > 1 && <span className="muted">{files.length} fichiers, traités l'un après l'autre</span>}
                </div>
                <ProgressBar busy={r.busy} ratio={r.ratio} msg={r.msg} />
                {r.error && <ErrorBox>{r.error}</ErrorBox>}
                {r.outputs && <Results outputs={r.outputs} />}
              </section>
            )}
          </div>
        )}
    </div>
  );
}
