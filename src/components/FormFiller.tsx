import { useEffect, useState } from 'react';
import { PDFCheckBox, PDFDocument, PDFDropdown, PDFOptionList, PDFRadioGroup, PDFTextField } from 'pdf-lib';
import { baseName, downloadBlob, readBytes } from '../core/util';
import { Dropzone } from './Common';
import { Icon } from './Icon';

interface Field { name: string; kind: 'text' | 'check' | 'select' | 'radio' | 'list' | 'other'; value: string | boolean; options?: string[]; multiline?: boolean }

export function FormFiller({ initial }: { initial: File[] }) {
  const [file, setFile] = useState<File | null>(initial[0] ?? null);
  const [fields, setFields] = useState<Field[] | null>(null);
  const [flatten, setFlatten] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!file) return;
    (async () => {
      setError(''); setFields(null);
      const doc = await PDFDocument.load(await readBytes(file), { ignoreEncryption: true });
      const list: Field[] = doc.getForm().getFields().map((f): Field => {
        const name = f.getName();
        if (f instanceof PDFTextField) return { name, kind: 'text', value: f.getText() ?? '', multiline: f.isMultiline() };
        if (f instanceof PDFCheckBox) return { name, kind: 'check', value: f.isChecked() };
        if (f instanceof PDFDropdown) return { name, kind: 'select', value: f.getSelected()[0] ?? '', options: f.getOptions() };
        if (f instanceof PDFRadioGroup) return { name, kind: 'radio', value: f.getSelected() ?? '', options: f.getOptions() };
        if (f instanceof PDFOptionList) return { name, kind: 'list', value: f.getSelected()[0] ?? '', options: f.getOptions() };
        return { name, kind: 'other', value: '' };
      });
      setFields(list);
    })().catch((e) => setError(`Lecture impossible : ${e?.message ?? e}`));
  }, [file]);

  const set = (name: string, value: string | boolean) => setFields((c) => c!.map((f) => (f.name === name ? { ...f, value } : f)));

  const save = async () => {
    if (!file || !fields) return;
    setBusy(true); setError('');
    try {
      const doc = await PDFDocument.load(await readBytes(file), { ignoreEncryption: true });
      const form = doc.getForm();
      for (const f of fields) {
        if (f.kind === 'other') continue;
        const fld = form.getField(f.name);
        if (fld instanceof PDFTextField) fld.setText(String(f.value));
        else if (fld instanceof PDFCheckBox) (f.value ? fld.check() : fld.uncheck());
        else if (fld instanceof PDFDropdown) { if (f.value) fld.select(String(f.value)); }
        else if (fld instanceof PDFRadioGroup) { if (f.value) fld.select(String(f.value)); }
        else if (fld instanceof PDFOptionList) { if (f.value) fld.select(String(f.value)); }
      }
      if (flatten) form.flatten();
      downloadBlob(new Blob([(await doc.save({ useObjectStreams: true })) as BlobPart], { type: 'application/pdf' }), `${baseName(file.name)}_rempli.pdf`);
    } catch (e: any) { setError(e?.message ?? String(e)); } finally { setBusy(false); }
  };

  if (!file) return <Dropzone accept="pdf" multiple={false} onFiles={(f) => setFile(f[0])} />;
  return (
    <div className="panel">
      <div className="row" style={{ marginBottom: 12 }}>
        <Icon name="file" /><b>{file.name}</b>
        <span className="grow" />
        <button className="btn small" onClick={() => setFile(null)}>Changer de fichier</button>
      </div>
      {error && <div className="err"><Icon name="alert" />{error}</div>}
      {!fields && !error && <div className="muted">Analyse du formulaire</div>}
      {fields && !fields.length && <div className="empty"><Icon name="info" size={20} /><div><b>Aucun champ de formulaire dans ce document.</b><div className="muted">Pour écrire sur un PDF ordinaire, utilisez l'éditeur : il permet d'ajouter du texte n'importe où.</div></div><a className="btn" href="#/tool/editor">Ouvrir l'éditeur</a></div>}
      {fields && fields.length > 0 && (
        <>
          <div className="formgrid">
            {fields.map((f) => (
              <div className="opt" key={f.name}>
                <label>{f.name}</label>
                {f.kind === 'text' && (f.multiline ? <textarea className="input" rows={3} value={String(f.value)} onChange={(e) => set(f.name, e.target.value)} /> : <input className="input" type="text" value={String(f.value)} onChange={(e) => set(f.name, e.target.value)} />)}
                {f.kind === 'check' && <label className="switch"><input type="checkbox" checked={!!f.value} onChange={(e) => set(f.name, e.target.checked)} /><span className="track" /> {f.value ? 'Coché' : 'Décoché'}</label>}
                {(f.kind === 'select' || f.kind === 'radio' || f.kind === 'list') && (
                  <select className="input" value={String(f.value)} onChange={(e) => set(f.name, e.target.value)}><option value="">Aucun choix</option>{f.options!.map((o) => <option key={o}>{o}</option>)}</select>
                )}
                {f.kind === 'other' && <span className="muted">Champ non modifiable ici</span>}
              </div>
            ))}
          </div>
          <div className="row" style={{ marginTop: 18 }}>
            <label className="switch"><input type="checkbox" checked={flatten} onChange={(e) => setFlatten(e.target.checked)} /><span className="track" /> Aplatir après remplissage (champs non modifiables)</label>
            <span className="grow" />
            <button className="btn primary" disabled={busy} onClick={save}><Icon name="download" /> {busy ? 'Export en cours' : 'Enregistrer le PDF'}</button>
          </div>
        </>
      )}
    </div>
  );
}
