import { useEffect, useMemo, useRef, useState } from 'react';
import { CATEGORIES, type CategoryId } from './core/types';
import { TOOLS, toolById } from './tools';
import { ToolPage } from './components/ToolPage';
import { Workflows } from './components/Workflows';
import { Icon } from './components/Icon';
import { LogoMark } from './components/Logo';

function useHash() {
  const [h, setH] = useState(location.hash);
  useEffect(() => { const f = () => { setH(location.hash); window.scrollTo(0, 0); }; window.addEventListener('hashchange', f); return () => window.removeEventListener('hashchange', f); }, []);
  return h;
}

const RECENT_KEY = 'awp.recent';
const getRecent = (): string[] => { try { return JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]'); } catch { return []; } };
const pushRecent = (id: string) => { try { localStorage.setItem(RECENT_KEY, JSON.stringify([id, ...getRecent().filter((x) => x !== id)].slice(0, 4))); } catch { /* stockage indisponible */ } };

function ToolCard({ t }: { t: (typeof TOOLS)[number] }) {
  return (
    <a className="tool-card" href={`#/tool/${t.id}`}>
      <span className="tile"><Icon name={t.icon} size={22} /></span>
      <div><h3>{t.name}</h3><p>{t.description}</p></div>
      <Icon name="arrow" size={16} className="go" />
    </a>
  );
}

function Home() {
  const [q, setQ] = useState('');
  const [cat, setCat] = useState<CategoryId | 'all'>('all');
  const search = useRef<HTMLInputElement>(null);
  const query = q.trim().toLowerCase();
  const recent = useMemo(() => getRecent().map((id) => toolById(id)).filter(Boolean) as typeof TOOLS, []);
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === '/' && document.activeElement?.tagName !== 'INPUT') { e.preventDefault(); search.current?.focus(); } };
    window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k);
  }, []);
  const groups = useMemo(() => CATEGORIES.filter((c) => cat === 'all' || c.id === cat).map((c) => ({ c, tools: TOOLS.filter((t) => t.category === c.id && (t.name + ' ' + t.description).toLowerCase().includes(query)) })).filter((g) => g.tools.length), [query, cat]);
  return (
    <>
      <div className="hero">
        <h1>Travaillez vos PDF, sans contrainte.</h1>
        <p>Assembler, découper, alléger, annoter, signer, protéger, convertir. Tout se fait dans votre navigateur : vos documents ne quittent jamais votre ordinateur, et il n'y a ni limite de taille ni compte à créer.</p>
        <div className="points">
          <span><Icon name="lock" /> Traitement local, rien n'est envoyé</span>
          <span><Icon name="infinity" /> Aucune limite de taille ni de nombre</span>
          <span><Icon name="shield" /> Sans compte, sans publicité</span>
        </div>
        <div className="searchbox"><Icon name="search" /><input ref={search} className="search" placeholder={`Rechercher parmi ${TOOLS.length} outils`} value={q} onChange={(e) => setQ(e.target.value)} aria-label="Rechercher un outil" /><span className="kbd">/</span></div>
      </div>

      {!query && cat === 'all' && (
        <div className="section">
          <h2>{recent.length ? 'Récemment utilisés' : 'Pour commencer'}</h2>
          <div className="grid">
            {(recent.length ? recent : ['merge', 'compress', 'editor', 'pdf-to-word'].map((id) => toolById(id)!)).map((t) => <ToolCard key={t.id} t={t} />)}
          </div>
        </div>
      )}

      <div className="tabs" role="tablist">
        <button role="tab" aria-selected={cat === 'all'} className={'tab' + (cat === 'all' ? ' on' : '')} onClick={() => setCat('all')}>Tous les outils</button>
        {CATEGORIES.map((c) => <button role="tab" aria-selected={cat === c.id} key={c.id} className={'tab' + (cat === c.id ? ' on' : '')} onClick={() => setCat(c.id)}>{c.label}</button>)}
        <a className="tab" href="#/workflows" style={{ marginLeft: 'auto' }}>Workflows</a>
      </div>

      {groups.map(({ c, tools }) => (
        <div className="section" key={c.id}>
          <h2>{c.label}</h2>
          <div className="grid">{tools.map((t) => <ToolCard key={t.id} t={t} />)}</div>
        </div>
      ))}
      {!groups.length && <p className="muted">Aucun outil ne correspond à « {q} ».</p>}
    </>
  );
}

function useTheme() {
  const system = () => (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  const [theme, setTheme] = useState<'light' | 'dark'>(() => (document.documentElement.dataset.theme as 'light' | 'dark') || system());
  const toggle = () => {
    const next = theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem('awp.theme', next); } catch { /* stockage indisponible */ }
    setTheme(next);
  };
  return { theme, toggle };
}

export default function App() {
  const { theme, toggle } = useTheme();
  const hash = useHash();
  const m = hash.match(/^#\/tool\/([\w-]+)/);
  const tool = m ? toolById(m[1]) : undefined;
  const home = !hash.startsWith('#/workflows') && !tool;
  useEffect(() => { if (tool) pushRecent(tool.id); }, [tool?.id]);
  return (
    <>
      <header className="top">
        <a className="logo" href="#/"><LogoMark size={32} /><span className="word">All With <b>PDF</b></span></a>
        <nav><a href="#/">Outils</a><a href="#/workflows">Workflows</a><button className="themebtn" onClick={toggle} aria-label={theme === 'dark' ? 'Passer en affichage clair' : 'Passer en affichage sombre'} title={theme === 'dark' ? 'Affichage clair' : 'Affichage sombre'}><Icon name={theme === 'dark' ? 'sun' : 'moon'} size={18} /></button></nav>
      </header>
      <main>
        {!home && <a className="crumb" href="#/"><Icon name="arrow" size={15} style={{ transform: 'rotate(180deg)' }} /> Tous les outils</a>}
        {hash.startsWith('#/workflows') ? <Workflows /> : tool ? <ToolPage key={tool.id + hash} tool={tool} /> : <Home />}
      </main>
      <footer className="footer"><div className="in"><span className="logo"><LogoMark size={22} /><span className="word">All With <b>PDF</b></span></span><span className="grow" /><span>Vos fichiers restent sur votre appareil.</span><a href="https://github.com/groupestudioprism/All-With-PDF" target="_blank" rel="noreferrer">Code source</a></div></footer>
    </>
  );
}
