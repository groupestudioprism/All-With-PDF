import { useEffect, useMemo, useState } from 'react';
import { CATEGORIES, type CategoryId } from './core/types';
import { TOOLS, toolById } from './tools';
import { ToolPage } from './components/ToolPage';
import { Workflows } from './components/Workflows';

function useHash() {
  const [h, setH] = useState(location.hash);
  useEffect(() => { const f = () => { setH(location.hash); window.scrollTo(0, 0); }; window.addEventListener('hashchange', f); return () => window.removeEventListener('hashchange', f); }, []);
  return h;
}

function Home() {
  const [q, setQ] = useState('');
  const [cat, setCat] = useState<CategoryId | 'all'>('all');
  const list = useMemo(() => TOOLS.filter((t) => (cat === 'all' || t.category === cat) && (t.name + ' ' + t.description).toLowerCase().includes(q.toLowerCase())), [q, cat]);
  return (
    <>
      <div className="hero">
        <h1>Tous les outils PDF.<br /><span>Sans limites. Sans envoi.</span></h1>
        <p>Fusionner, découper, compresser, éditer, signer, caviarder, OCR… tout s'exécute dans votre navigateur : vos fichiers ne quittent jamais votre appareil.</p>
        <div className="badges"><span>♾️ Taille & nombre illimités</span><span>🔒 100 % local</span><span>🚫 Sans compte ni pub</span><span>⛓️ Workflows</span></div>
        <input className="search" placeholder="Rechercher un outil…" value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
      </div>
      <div className="chips">
        <button className={'chip' + (cat === 'all' ? ' on' : '')} onClick={() => setCat('all')}>Tous</button>
        {CATEGORIES.map((c) => <button key={c.id} className={'chip' + (cat === c.id ? ' on' : '')} onClick={() => setCat(c.id)}>{c.label}</button>)}
      </div>
      <div className="grid">
        <a className="tool-card" href="#/workflows" style={{ ['--c' as any]: '#6d5efc' }}><span className="ic">⛓️</span><h3>Workflows</h3><p>Enchaînez plusieurs outils et rejouez-les sur vos lots de fichiers.</p></a>
        {list.map((t) => (
          <a key={t.id} className="tool-card" href={`#/tool/${t.id}`} style={{ ['--c' as any]: CATEGORIES.find((c) => c.id === t.category)!.color }}>
            <span className="ic">{t.icon}</span><h3>{t.name}</h3><p>{t.description}</p>
          </a>
        ))}
      </div>
      {!list.length && <p className="muted" style={{ textAlign: 'center' }}>Aucun outil ne correspond.</p>}
    </>
  );
}

export default function App() {
  const hash = useHash();
  const m = hash.match(/^#\/tool\/([\w-]+)/);
  const tool = m ? toolById(m[1]) : undefined;
  return (
    <>
      <header className="top">
        <a className="logo" href="#/"><i>PDF</i><span>All With <b>PDF</b></span></a>
        <nav><a className="btn small" href="#/workflows">⛓️ Workflows</a><a className="btn small" href="#/">Tous les outils</a></nav>
      </header>
      <main>
        {hash.startsWith('#/workflows') ? <Workflows /> : tool ? <ToolPage key={tool.id + hash} tool={tool} /> : <Home />}
      </main>
      <div className="footer">All With PDF · open source · traitement local dans votre navigateur</div>
    </>
  );
}
