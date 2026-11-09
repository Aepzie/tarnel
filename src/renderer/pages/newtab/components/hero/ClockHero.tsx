import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { spring } from '@/lib/motion';
import { useNow } from './useNow';

const minuteFormat = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' });
const secondFormat = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
const dateFormat = new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'long', day: 'numeric' });

interface TimeParts {
  main: string;
  seconds: string | null;
}

function formatTime(now: Date, withSeconds: boolean): TimeParts {
  const parts = (withSeconds ? secondFormat : minuteFormat).formatToParts(now);
  const hourIndex = parts.findIndex((part) => part.type === 'hour');
  const minuteIndex = parts.findIndex((part) => part.type === 'minute');
  const start = Math.min(hourIndex, minuteIndex);
  const end = Math.max(hourIndex, minuteIndex);
  const main = parts
    .slice(start, end + 1)
    .map((part) => part.value)
    .join('')
    .trim();
  const seconds = parts.find((part) => part.type === 'second')?.value ?? null;
  return { main, seconds };
}

function Digit({ char, still }: { char: string; still: boolean }) {
  return (
    <span className="vt-digit-mask relative inline-block h-[1.2em] overflow-hidden align-top">
      <span className="invisible">{char}</span>
      <AnimatePresence initial={false}>
        <motion.span
          key={char}
          className="absolute inset-0 flex items-center justify-center"
          initial={still ? { opacity: 0 } : { y: '70%', opacity: 0, filter: 'blur(6px)' }}
          animate={{ y: '0%', opacity: 1, filter: 'blur(0px)' }}
          exit={still ? { opacity: 0 } : { y: '-70%', opacity: 0, filter: 'blur(6px)' }}
          transition={still ? { duration: 0 } : spring.soft}
        >
          {char}
        </motion.span>
      </AnimatePresence>
    </span>
  );
}

function RollingText({ text, still }: { text: string; still: boolean }) {
  return (
    <>
      {Array.from(text).map((char, index) =>
        /\d/.test(char) ? (
          <Digit key={index} char={char} still={still} />
        ) : (
          <span key={index} className="relative -top-[0.06em] px-[0.02em] text-muted-foreground/50">
            {char}
          </span>
        ),
      )}
    </>
  );
}

/** hh:mm (or hh:mm:ss) with per-digit roll; seconds tick exactly on the wall-clock second. */
export function ClockHero({ seconds }: { seconds: boolean }) {
  const now = useNow(seconds ? 1000 : 60_000);
  const still = useReducedMotion() ?? false;
  const time = formatTime(now, seconds);
  const label = time.seconds ? `${time.main}:${time.seconds}` : time.main;

  return (
    <div className="flex flex-col items-center">
      <time
        dateTime={now.toISOString()}
        aria-label={label}
        className="flex items-baseline text-8xl leading-[1.2] font-light tracking-tighter tabular-nums text-foreground"
      >
        <span className="flex">
          <RollingText text={time.main} still={still} />
        </span>
        {time.seconds && (
          <span className="ml-[0.08em] flex text-[0.5em] font-extralight text-foreground/55">
            <span className="relative -top-[0.04em] px-[0.04em] text-muted-foreground/40">:</span>
            <RollingText text={time.seconds} still={still} />
          </span>
        )}
      </time>
      <p className="mt-1 text-[15px] font-medium tracking-tight text-muted-foreground">{dateFormat.format(now)}</p>
    </div>
  );
}
