import { useCallback, useEffect, useRef, useState } from 'react';
import Board from './Board';
import Guide from './Guide';
import { GitHubMark, LampMark } from './Icons';
import {
  buildReducer, currentStep, DONE, initialState, instruction, note, primaryAction, progressCount, restoreBuild, secondaryAction,
  steps, STORAGE_KEY, type BuildAction, type BuildState,
} from './build';

type Route = 'build' | 'guide';

/** The repo is created at publish time; the link is wired now so it only has to be right once. */
const REPO_URL = 'https://github.com/juliamuiruri4/octolamp-assemble';
const routeFromHash = (): Route => (window.location.hash === '#/guide' ? 'guide' : 'build');

function readStorage(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch (error) {
    console.error('Local storage is unavailable:', error);
    return null;
  }
}

export default function App() {
  const [restored] = useState(() => restoreBuild(readStorage));
  const [build, setBuild] = useState<BuildState>(restored.state);
  const [history, setHistory] = useState<BuildState[]>([]);
  const [route, setRoute] = useState<Route>(routeFromHash);
  const [notice, setNotice] = useState(restored.notice);
  const [confirming, setConfirming] = useState(false);
  const saveBlocked = useRef(restored.blocked);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const step = currentStep(build);
  const primary = primaryAction(build);
  const secondary = secondaryAction(build);
  const progress = progressCount(build);
  const hint = note(build);

  useEffect(() => {
    const onHash = () => {
      setRoute(routeFromHash());
      window.scrollTo({ top: 0 });
      requestAnimationFrame(() => document.querySelector<HTMLElement>('h1')?.focus());
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  useEffect(() => {
    if (saveBlocked.current) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(build));
    } catch (error) {
      console.error('Could not save the build:', error);
      setNotice('This browser could not save your build.');
    }
  }, [build]);

  const act = useCallback((action: BuildAction) => {
    setBuild((current) => {
      const next = buildReducer(current, action);
      if (next !== current) setHistory((h) => [...h, current]);
      return next;
    });
  }, []);

  const undo = useCallback(() => {
    setHistory((h) => {
      if (!h.length) return h;
      setBuild(h[h.length - 1]);
      return h.slice(0, -1);
    });
    setConfirming(false);
  }, []);

  const startOver = () => {
    saveBlocked.current = false;
    setBuild(initialState);
    setHistory([]);
    setNotice('');
    setConfirming(false);
    try { localStorage.removeItem(STORAGE_KEY); } catch (error) { console.error('Could not clear the saved build:', error); }
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); undo(); return; }
      if (e.key === 'Escape') { setConfirming(false); return; }
      const t = e.target as HTMLElement;
      if (route !== 'build' || e.metaKey || e.ctrlKey || e.altKey) return;
      if (t.closest('button, a, input, textarea, select, iframe, canvas')) return;
      if ((e.key === 'Enter' || e.key === ' ') && primary) { e.preventDefault(); act(primary.action); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [act, undo, primary, route]);

  return (
    <div className="app">
      <header className="top">
        <a className="brand" href="#/" aria-label="Octolamp Assemble">
          <LampMark />
          <span>Octolamp Assemble</span>
        </a>
        <nav aria-label="Main">
          <a href="#/" aria-current={route === 'build' ? 'page' : undefined}>Build</a>
          <a href="#/guide" aria-current={route === 'guide' ? 'page' : undefined}>Guide</a>
          <a className="repo" href={REPO_URL} aria-label="Octolamp Assemble on GitHub"><GitHubMark /></a>
        </nav>
      </header>

      {route === 'guide' ? <Guide /> : (
        <main className="build">
          <Board build={build} />
          <section className="panel" aria-labelledby="step-title">
            <ol className="rail" aria-label="Steps">
              {steps.map((s, i) => (
                <li key={s.name} className={i < step ? 'done' : i === step ? 'current' : ''} aria-current={i === step ? 'step' : undefined}>
                  <span className="mark" aria-hidden="true">{i < step ? '✓' : i + 1}</span>
                  <span className="sr-only">{s.name}{i < step ? ', done' : ''}</span>
                </li>
              ))}
            </ol>

            {step === DONE ? (
              <div className="finish">
                <h1 id="step-title" ref={headingRef} tabIndex={-1}>Go explore Universe.</h1>
                <p>At home, join the <code>WLED-AP</code> network (password <code>wled1234</code>) to change colours and effects.</p>
                <ul className="links">
                  <li><a href="https://kno.wled.ge/">WLED</a></li>
                  <li><a href="https://www.home-assistant.io/integrations/wled/">Home Assistant</a></li>
                  <li><a href="https://github.com/martinwoodward/octolamp/discussions/categories/show-and-tell">Share your make #MadeAtGitHubUniverse</a></li>
                </ul>
              </div>
            ) : (
              <>
                <h1 id="step-title" ref={headingRef} tabIndex={-1}>{instruction(build)}</h1>
                <p className="note" role={hint ? 'note' : undefined}>{hint}</p>
                {progress && (
                  <div className="progress" aria-live="polite">
                    <div className="bar" aria-hidden="true"><i style={{ width: `${(progress.done / progress.total) * 100}%` }} /></div>
                    <span>{progress.done}/{progress.total} {progress.noun}</span>
                  </div>
                )}
                <div className="actions">
                  {primary && <button type="button" className="primary" onClick={() => act(primary.action)}>{primary.label}</button>}
                  {secondary && <button type="button" className="text" onClick={() => act(secondary.action)}>{secondary.label}</button>}
                </div>
              </>
            )}

            {notice && <p className="notice" role="alert">{notice}</p>}
            <div className="tools">
              <button type="button" className="tool" onClick={undo} disabled={!history.length}>Undo</button>
              {confirming ? (
                <>
                  <button type="button" className="tool danger" onClick={startOver}>Erase and start over</button>
                  <button type="button" className="tool" onClick={() => setConfirming(false)}>Cancel</button>
                </>
              ) : (
                <button type="button" className="tool" onClick={() => setConfirming(true)}>Start over</button>
              )}
            </div>
          </section>
        </main>
      )}
    </div>
  );
}
