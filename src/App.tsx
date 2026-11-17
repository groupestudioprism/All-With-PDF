import { useEffect, useMemo, useState } from 'react';
import { CATEGORIES } from './core/types';
import { TOOLS, toolById } from './tools';
import { ToolPage } from './components/ToolPage';
import { Workflows } from './components/Workflows';
import { Icon } from './components/Icon';

function useHash() {
  const [h, setH] = useState(location.hash);
  useEffect(() => { const f = () => { setH(location.hash); window.scrollTo(0, 0); }; window.addEventListener('hashchange', f); return () => window.removeEventListener('hashchange', f); }, []);
  return h;
}

function Home() {
  const [q, setQ] = useState('');
  const query = q.trim().toLowerCase();
  const groups = useMemo(() => CATEGORIES.map((c) => ({ c, tools: TOOLS.filter((t) => t.category === c.id && (t.name + ' ' + t.description).toLowerCase().includes(query)) })).filter((g) => g.tools.length), [query]);
  return (
    <>
      <div className="hero">
        <h1>Travaillez vos PDF, sans contrainte.</h1>
        <p>Assembler, découper, alléger, annoter, signer, caviarder. Tout se fait dans votre navigateur : vos documents ne quittent jamais votre ordinateur, et il n'y a ni limite de taille ni compte à créer.</p>
        <div className="points">
          <span><Icon name="lock" /> Traitement local, rien n'est envoyé</span>
          <span><Icon name="infinity" /> Aucune limite de taille ni de nombre</span>
          <span><Icon name="shield" /> Sans compte, sans publicité</span>
        </div>
        <div className="searchbox"><Icon name="search" /><input className="search" placeholder="Rechercher un outil" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Rechercher un outil" /></div>
      </div>

      {!query && (
        <div className="section">
          <h2>Automatisation</h2>
          <div className="grid">
            <a className="tool-card feature" href="#/workflows"><span className="tile"><Icon name="workflow" size={22} /></span><div><h3>Workflows</h3><p>Enchaînez plusieurs outils et rejouez la même chaîne sur tous vos fichiers.</p></div></a>
          </div>
        </div>
      )}
      {groups.map(({ c, tools }) => (
        <div className="section" key={c.id}>
          <h2>{c.label}</h2>
          <div className="grid">
            {tools.map((t) => (
              <a key={t.id} className="tool-card" href={`#/tool/${t.id}`}>
                <span className="tile"><Icon name={t.icon} size={22} /></span>
                <div><h3>{t.name}</h3><p>{t.description}</p></div>
              </a>
            ))}
          </div>
        </div>
      ))}
      {!groups.length && <p className="muted">Aucun outil ne correspond à « {q} ».</p>}
    </>
  );
}

export default function App() {
  const hash = useHash();
  const m = hash.match(/^#\/tool\/([\w-]+)/);
  const tool = m ? toolById(m[1]) : undefined;
  const home = !hash.startsWith('#/workflows') && !tool;
  return (
    <>
      <header className="top">
        <a className="logo" href="#/"><span className="mark">PDF</span><span>All With PDF</span></a>
        <nav><a href="#/">Outils</a><a href="#/workflows">Workflows</a></nav>
      </header>
      <main>
        {!home && <a className="crumb" href="#/"><Icon name="arrow" size={15} style={{ transform: 'rotate(180deg)' }} /> Tous les outils</a>}
        {hash.startsWith('#/workflows') ? <Workflows /> : tool ? <ToolPage key={tool.id + hash} tool={tool} /> : <Home />}
      </main>
      <div className="footer">All With PDF. Vos fichiers sont traités sur votre appareil.</div>
    </>
  );
}
