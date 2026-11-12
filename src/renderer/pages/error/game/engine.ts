export const SCENE = { width: 640, height: 180, ground: 144, runnerX: 64, runnerSize: 24 } as const;
export interface Obstacle { id: number; x: number; width: number; height: number }
export interface RunState {
  mode: 'ready' | 'running' | 'paused' | 'over';
  height: number;
  velocity: number;
  distance: number;
  score: number;
  spawnIn: number;
  nextId: number;
  obstacles: Obstacle[];
}
export type RunAction = 'start' | 'jump' | 'pause' | 'resume';

export function createRun(): RunState {
  return { mode: 'ready', height: 0, velocity: 0, distance: 0, score: 0, spawnIn: 0.9, nextId: 1, obstacles: [] };
}

/** Seconds of travel kept free ahead of the runner when a paused run resumes. */
export const RESUME_GRACE = 0.6;

function speedAt(distance: number): number {
  return 220 + Math.min(distance / 80, 100);
}

/** Drops rocks the runner would reach within the grace window so a resume never lands straight in a collision. */
export function clearForResume(run: RunState): RunState {
  const reach = SCENE.runnerX + SCENE.runnerSize + speedAt(run.distance) * RESUME_GRACE;
  const obstacles = run.obstacles.filter((rock) => rock.x + rock.width <= SCENE.runnerX || rock.x >= reach);
  return obstacles.length === run.obstacles.length ? run : { ...run, obstacles };
}

export function act(run: RunState, action: RunAction): RunState {
  if (action === 'start') return { ...createRun(), mode: 'running' };
  if (action === 'pause' && run.mode === 'running') return { ...run, mode: 'paused' };
  if (action === 'resume' && run.mode === 'paused') return { ...clearForResume(run), mode: 'running' };
  if (action === 'jump' && run.mode === 'running' && run.height === 0 && run.velocity === 0) {
    return { ...run, velocity: 430 };
  }
  return run;
}

/** Bounded substeps prevent tunnelling through rocks or catching up after a stalled frame. */
export function advance(run: RunState, milliseconds: number, random: () => number): RunState {
  if (run.mode !== 'running' || !Number.isFinite(milliseconds) || milliseconds <= 0) return run;
  let next = { ...run, obstacles: run.obstacles.map((rock) => ({ ...rock })) };
  let remaining = Math.min(milliseconds, 50) / 1000;
  while (remaining > 0 && next.mode === 'running') {
    const dt = Math.min(remaining, 1 / 120);
    remaining -= dt;
    const speed = speedAt(next.distance);
    next.distance += speed * dt;
    next.score = Math.floor(next.distance / 10);
    next.height = Math.max(0, next.height + next.velocity * dt - 700 * dt * dt);
    next.velocity = next.height === 0 ? 0 : next.velocity - 1400 * dt;
    next.spawnIn -= dt;
    next.obstacles = next.obstacles
      .map((rock) => ({ ...rock, x: rock.x - speed * dt }))
      .filter((rock) => rock.x + rock.width > 0);
    if (next.spawnIn <= 0) {
      const value = random();
      const variation = Number.isFinite(value) ? Math.max(0, Math.min(value, 1)) : 0.5;
      next.obstacles.push({ id: next.nextId++, x: SCENE.width, width: 20 + variation * 12, height: 24 + variation * 12 });
      // More than a full jump between rocks, even at the maximum speed.
      next.spawnIn = 1.15 + variation * 0.65;
    }
    if (next.obstacles.some((rock) =>
      rock.x < SCENE.runnerX + SCENE.runnerSize - 3 &&
      rock.x + rock.width > SCENE.runnerX + 3 && next.height + 3 < rock.height,
    )) next = { ...next, mode: 'over' };
  }
  return next;
}
