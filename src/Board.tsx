import { useEffect, useRef, useState } from 'react';
import { currentStep, type BuildState } from './build';
import type { OctolampScene, ViewMode } from './scene/OctolampScene';

const MODES: ReadonlyArray<{ id: ViewMode; label: string }> = [
  { id: 'solid', label: 'Solid' },
  { id: 'wireframe', label: 'Wireframe' },
  { id: 'angle', label: 'Angle' },
];

/** The only place the 3D scene is loaded, and only through a dynamic import, so the shell paints first. */
export default function Board({ build }: { build: BuildState }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sceneRef = useRef<OctolampScene | null>(null);
  const latest = useRef(build);
  latest.current = build;
  const [focus, setFocus] = useState<string | null>(null);
  const [mode, setMode] = useState<ViewMode>('solid');
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let created: OctolampScene | null = null;
    let observer: ResizeObserver | null = null;
    const canvas = canvasRef.current!;
    const host = hostRef.current!;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    import('./scene/OctolampScene').then(async ({ OctolampScene }) => {
      if (cancelled) return;
      try {
        const scene = await OctolampScene.create(canvas, { reducedMotion: reduced, onReady: () => setReady(true), onFocus: setFocus });
        if (cancelled) { scene.dispose(); return; }
        created = scene;
        sceneRef.current = scene;
        const fit = () => scene.resize(host.clientWidth, host.clientHeight);
        fit();
        observer = new ResizeObserver(fit);
        observer.observe(host);
        scene.setViewMode(modeRef.current);
        scene.setBuild(latest.current);
      } catch (error) {
        console.error('The 3D scene could not start:', error);
        setFailed(true);
      }
    }).catch((error) => {
      console.error('The 3D scene could not load:', error);
      setFailed(true);
    });
    return () => {
      cancelled = true;
      observer?.disconnect();
      created?.dispose();
      sceneRef.current = null;
    };
  }, []);

  useEffect(() => { sceneRef.current?.setBuild(build); }, [build]);
  useEffect(() => { sceneRef.current?.setViewMode(mode); }, [mode]);

  return (
    <div className="board" ref={hostRef} data-ready={ready ? 'true' : 'false'} data-step={currentStep(build)}>
      <canvas
        ref={canvasRef}
        tabIndex={0}
        className="board-canvas"
        role="img"
        aria-label="3D Octolamp build. Drag to orbit, scroll or pinch to zoom, right-drag or two fingers to pan, tap a part to focus. Arrow keys orbit, Shift and arrows pan, plus and minus zoom, brackets step through parts, Home resets."
      />
      <div className="modes" role="radiogroup" aria-label="View mode">
        {MODES.map((m) => (
          <label key={m.id} className={mode === m.id ? 'on' : ''}>
            <input type="radio" name="view-mode" value={m.id} checked={mode === m.id} onChange={() => setMode(m.id)} />
            {m.label}
          </label>
        ))}
      </div>
      <div className="nav" role="group" aria-label="Move between parts">
        <button type="button" aria-label="Previous part" onClick={() => sceneRef.current?.focusStep(-1)}>‹</button>
        <span className="nav-name" aria-live="polite">{focus ?? 'Tap a part'}</span>
        <button type="button" aria-label="Next part" onClick={() => sceneRef.current?.focusStep(1)}>›</button>
        <button type="button" className="nav-reset" onClick={() => sceneRef.current?.recenter()}>Overview</button>
      </div>
      {!ready && !failed && <p className="board-status" role="status">Loading the lamp…</p>}
      {failed && <p className="board-status" role="alert">The 3D view could not start in this browser. The steps still work.</p>}
    </div>
  );
}
