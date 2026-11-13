import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { ArrowUp, Pause, Play, RotateCcw, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { act, createRun, frame as step, SCENE, type RunAction, type RunState } from './engine';

const SCENERY = <>
  <path d="M0 144H640" className="stroke-border" fill="none" />
  <path d="M352 144 397 100 428 130 459 112 495 144M420 144 473 83 534 144" className="stroke-border" fill="none" />
</>;

/** Entirely local and ephemeral: a closed or inactive game owns no animation frames. */
export function OfflineGame({ onClose }: { onClose: () => void }) {
  const [run, setRun] = useState(createRun);
  const [best, setBest] = useState(0);
  const current = useRef(run);
  const area = useRef<HTMLDivElement>(null);
  const start = useRef<HTMLButtonElement>(null);
  const instructions = useId();
  const title = useId();
  const publish = useCallback((next: RunState) => {
    current.current = next;
    setRun(next);
    if (next.mode === 'over') setBest((value) => Math.max(value, next.score));
  }, []);
  const dispatch = useCallback((action: RunAction) => publish(act(current.current, action)), [publish]);

  useEffect(() => { start.current?.focus({ preventScroll: true }); }, []);

  useEffect(() => {
    const events = new AbortController();
    const pause = () => dispatch('pause');
    window.addEventListener('blur', pause, { signal: events.signal });
    window.addEventListener('pagehide', pause, { signal: events.signal });
    document.addEventListener('freeze', pause, { signal: events.signal });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) pause();
    }, { signal: events.signal });
    return () => events.abort();
  }, [dispatch]);

  useEffect(() => {
    if (run.mode !== 'running') return;
    let frame: number;
    let previous: number | undefined;
    const tick = (time: number) => {
      if (current.current.mode !== 'running') return;
      if (document.hidden) { dispatch('pause'); return; }
      const next = step(current.current, previous === undefined ? 0 : time - previous, Math.random);
      previous = time;
      publish(next);
      if (next.mode === 'running') frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [run.mode, dispatch, publish]);

  const control = (action: RunAction) => {
    dispatch(action);
    area.current?.focus({ preventScroll: true });
  };
  const keyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.altKey || event.ctrlKey || event.metaKey || event.repeat) return;
    if (event.key === 'Escape') {
      if (current.current.mode !== 'running') return;
      event.preventDefault();
      dispatch('pause');
    } else if (event.target === area.current && (event.code === 'Space' || event.key === 'ArrowUp')) {
      event.preventDefault();
      control(run.mode === 'running' ? 'jump' : run.mode === 'paused' ? 'resume' : 'start');
    }
  };
  const message = run.mode === 'ready' ? 'Ready when you are.'
    : run.mode === 'paused' ? "Paused. Resume when you're ready."
      : run.mode === 'over' ? `Game over. Score ${run.score}.`
        : 'Jump over the rocks. Escape pauses the game.';

  return (
    <section
      aria-labelledby={title}
      className="mt-6 w-full rounded-xl border border-border bg-card/50 p-4 text-left"
      onKeyDown={keyDown}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) dispatch('pause');
      }}
    >
      <div className="flex items-center justify-between gap-3">
        <h2 id={title} className="text-sm font-medium text-foreground">Trail hop</h2>
        <div className="flex items-center gap-3">
          <p className="text-xs tabular-nums text-muted-foreground">
            Score <span className="text-foreground">{run.score}</span>
            <span className="ml-3">Best {best}</span>
          </p>
          <Button type="button" variant="ghost" size="icon-sm" aria-label="Close game" onClick={onClose}>
            <X aria-hidden="true" />
          </Button>
        </div>
      </div>
      <p id={instructions} className="mt-1 text-xs leading-5 text-muted-foreground">
        Space, ↑ or Jump to clear the rocks. Escape to pause.
      </p>
      <div
        ref={area}
        role="group"
        aria-label="Trail hop play area"
        aria-describedby={instructions}
        tabIndex={0}
        className="relative mt-3 overflow-hidden rounded-lg border border-border bg-background outline-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
      >
        <svg viewBox={`0 0 ${SCENE.width} ${SCENE.height}`} className="block w-full" aria-hidden="true">
          {SCENERY}
          {run.obstacles.map((rock) => (
            <rect key={rock.id} x={rock.x} y={SCENE.ground - rock.height} width={rock.width} height={rock.height} rx="4" className="fill-muted-foreground" />
          ))}
          <rect x={SCENE.runnerX} y={SCENE.ground - SCENE.runnerSize - run.height} width={SCENE.runnerSize} height={SCENE.runnerSize} rx="5" strokeWidth="1.5" className="fill-space stroke-foreground" />
          <path d={`M${SCENE.runnerX + 15} ${SCENE.ground - run.height - 16}v3`} className="stroke-background" strokeWidth="3" strokeLinecap="round" />
        </svg>
        {run.mode !== 'running' && (
          <p aria-hidden="true" className="pointer-events-none absolute inset-0 flex items-center justify-center text-sm font-medium text-foreground">
            {run.mode === 'ready' ? 'Ready when you are' : run.mode === 'paused' ? 'Paused' : 'Game over'}
          </p>
        )}
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <p role="status" aria-live="polite" aria-atomic="true" className="sr-only">{message}</p>
        <div className="ml-auto flex items-center gap-1">
          {run.mode === 'running' ? <>
            <Button type="button" variant="ghost" size="sm" onClick={() => control('pause')}><Pause aria-hidden="true" />Pause</Button>
            <Button type="button" variant="outline" size="sm" onClick={() => control('jump')}><ArrowUp aria-hidden="true" />Jump</Button>
          </> : (
            <Button ref={start} type="button" variant="outline" size="sm" onClick={() => control(run.mode === 'paused' ? 'resume' : 'start')}>
              {run.mode === 'over' ? <RotateCcw aria-hidden="true" /> : <Play aria-hidden="true" />}
              {run.mode === 'paused' ? 'Resume' : run.mode === 'over' ? 'Play again' : 'Start game'}
            </Button>
          )}
        </div>
      </div>
    </section>
  );
}
