import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Monitor, RotateCw } from 'lucide-react';
import type { FrameRateMode, FrameRateStatus } from '@shared/types';
import { Button } from '@/components/ui/button';
import { ease } from '@/lib/motion';
import { velaPages } from '@/lib/vela';
import { cn } from '@/lib/utils';
import { Segmented, type SegmentOption } from './controls';
import { Group, Row } from './layout';
import { errorText, hasBridge, useSettings } from '../store';

const MODES: readonly SegmentOption<FrameRateMode>[] = [
  { value: 'match', label: 'Match display' },
  { value: 'highest', label: 'Highest' },
  { value: 'primary', label: 'Primary display' },
];

const MODE_TEXT: Record<FrameRateMode, string> = {
  match: 'Draw at the refresh rate of the display Vela opens on.',
  highest: 'Always draw at your fastest display’s rate, also on slower displays (more GPU work there).',
  primary: 'Draw at the primary display’s rate, like stock Chromium. Can save power on a fast laptop panel.',
};

/** Re-read on mount and whenever the page becomes visible (the window may have moved to another display). */
function useFrameRateStatus(): FrameRateStatus | null {
  const [status, setStatus] = useState<FrameRateStatus | null>(null);
  const { settings } = useSettings();

  useEffect(() => {
    if (!hasBridge()) return;
    let alive = true;
    const load = (): void => {
      if (document.hidden) return;
      velaPages()
        .frameRate()
        .then((next) => alive && setStatus(next), () => undefined);
    };
    const listeners = new AbortController();
    document.addEventListener('visibilitychange', load, { signal: listeners.signal });
    window.addEventListener('focus', load, { signal: listeners.signal });
    load();
    return () => {
      alive = false;
      listeners.abort();
    };
  }, [settings.frameRate]);

  return status;
}

/** Frames per second this page actually gets (requestAnimationFrame over one second). */
function useMeasuredFps(trigger: unknown): number | null {
  const [fps, setFps] = useState<number | null>(null);

  useEffect(() => {
    let frame = 0;
    let start = 0;
    let count = 0;
    const step = (now: number): void => {
      if (!start) start = now;
      count += 1;
      if (now - start >= 1000) {
        setFps(Math.round(((count - 1) * 1000) / (now - start)));
        return;
      }
      frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [trigger]);

  return fps;
}

function displaySummary(status: FrameRateStatus): string {
  return status.displays
    .map((d) => {
      const tags = [d.current && 'this window', d.primary && status.displays.length > 1 && 'primary'].filter(Boolean);
      return `${d.label}: ${d.hz} Hz${tags.length ? ` (${tags.join(', ')})` : ''}`;
    })
    .join(' · ');
}

/** Settings → Performance: frame rate mode, detected displays, measured fps and "Restart to apply". */
export function FrameRateGroup() {
  const { settings, update } = useSettings();
  const status = useFrameRateStatus();
  const fps = useMeasuredFps(status?.pacedHz);
  const [error, setError] = useState<string | null>(null);

  if (!status) return null;

  const measured = fps !== null ? `This page draws at ${fps} fps.` : 'Measuring…';

  return (
    <Group title="Display">
      {status.supported && (
        <Row title="Frame rate" description={MODE_TEXT[settings.frameRate]}>
          <Segmented
            label="Frame rate"
            value={settings.frameRate}
            options={MODES}
            onChange={(frameRate) => update({ frameRate })}
          />
        </Row>
      )}
      <Row
        title={
          <span className="flex items-center gap-1.5">
            <Monitor className="size-3.5 text-muted-foreground" strokeWidth={1.75} aria-hidden />
            {status.displays.length === 1 ? 'Display' : 'Displays'}
          </span>
        }
        description={
          <>
            <span className="block">{displaySummary(status)}</span>
            <span role="status" aria-live="polite" className={cn('block tabular-nums', error && 'text-destructive')}>
              {error ?? (status.supported ? measured : `${measured} Vela follows each display’s refresh rate automatically.`)}
            </span>
          </>
        }
      >
        <AnimatePresence initial={false}>
          {status.restartRequired && (
            <motion.div
              initial={{ opacity: 0, scale: 0.96 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.96 }}
              transition={{ duration: 0.18, ease: ease.out }}
              className="flex items-center gap-2"
            >
              <span className="text-xs text-muted-foreground">Restart to apply</span>
              <Button
                type="button"
                size="sm"
                onClick={() => velaPages().relaunch().catch((e: unknown) => setError(errorText(e, 'Could not restart.')))}
                className="h-8 gap-1.5 rounded-lg px-2.5 text-xs font-semibold active:scale-[0.96]"
              >
                <RotateCw className="size-3.5" strokeWidth={2} aria-hidden />
                Restart
              </Button>
            </motion.div>
          )}
        </AnimatePresence>
      </Row>
    </Group>
  );
}
