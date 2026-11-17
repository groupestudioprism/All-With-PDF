import { useState } from 'react';
import type { Tool } from '../core/types';
import { defaultsOf } from '../core/util';
import { takeHandoff } from '../core/store';
import { Dropzone, FileList, OptionsForm, ProgressBar, Results, runTool, useRunner } from './Common';
import { Organizer } from './Organizer';
import { Editor } from './Editor';

export function ToolPage({ tool }: { tool: Tool }) {
  const [files, setFiles] = useState<File[]>(() => takeHandoff() ?? []);
  const [opts, setOpts] = useState(() => defaultsOf(tool.options));
  const r = useRunner();
  const [initialFiles] = useState(files);
  const need = tool.exactFiles ?? 1;
  const ready = files.length >= need && (!tool.exactFiles || files.length === tool.exactFiles);
  const add = (f: File[]) => { r.reset(); setFiles((cur) => (tool.multiple ? [...cur, ...f] : f)); };

  return (
    <div>
      <div className="page-title"><span className="ic">{tool.icon}</span><h1>{tool.name}</h1></div>
      <p className="lead">{tool.description}</p>
      {tool.custom === 'organize' ? <Organizer initial={initialFiles} />
        : tool.custom === 'editor' ? <Editor initial={initialFiles} />
        : (
          <div className="panel">
            {(tool.multiple || !files.length) && <Dropzone accept={tool.accept} multiple={tool.multiple} onFiles={add}
              label={tool.exactFiles ? `Déposez ${tool.exactFiles} PDF à comparer` : undefined} />}
            <FileList files={files} onChange={(f) => { r.reset(); setFiles(f); }} reorder={tool.multiple} />
            {files.length > 0 && <OptionsForm defs={tool.options} value={opts} onChange={setOpts} />}
            {tool.exactFiles && files.length > 0 && files.length !== tool.exactFiles && <div className="note">Il faut exactement {tool.exactFiles} fichiers.</div>}
            {ready && (
              <div className="row">
                <button className="btn primary" disabled={r.busy} onClick={() => r.run((p) => runTool(tool, files, opts, p))}>
                  {r.busy ? 'Traitement…' : `${tool.icon} ${tool.name}`}
                </button>
                {!tool.multiple && files.length > 1 && <span className="muted">{files.length} fichiers : traitement un par un (traitement par lots illimité)</span>}
              </div>
            )}
            <ProgressBar busy={r.busy} ratio={r.ratio} msg={r.msg} />
            {r.error && <div className="err">{r.error}</div>}
            {r.outputs && <Results outputs={r.outputs} />}
          </div>
        )}
    </div>
  );
}
