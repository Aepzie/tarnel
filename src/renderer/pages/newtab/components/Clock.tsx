import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { useEffect, useState } from 'react';
import { spring } from '@/lib/motion';

const timeFormat = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' });
const dateFormat = new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'long', day: 'numeric' });

function formatTime(now: Date): string {
  return timeFormat
    .formatToParts(now)
    .filter((part) => part.type === 'hour' || part.type === 'minute' || part.type === 'literal')
    .map((part) => part.value)
    .join('')
    .trim();
}

function useMinute(): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    let timer = 0;
    const schedule = (): void => {
      const current = new Date();
      const wait = 60_000 - (current.getSeconds() * 1000 + current.getMilliseconds()) + 15;
      timer = window.setTimeout(() => {
        setNow(new Date());
        schedule();
      }, wait);
    };
    const onVisible = (): void => {
      if (!document.hidden) setNow(new Date());
    };
    schedule();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);
  return now;
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

export function Clock() {
  const now = useMinute();
  const reduced = useReducedMotion() ?? false;
  const time = formatTime(now);
  const date = dateFormat.format(now);

  return (
    <div className="flex flex-col items-center select-none">
      <time
        dateTime={now.toISOString()}
        aria-label={time}
        className="flex text-8xl leading-[1.2] font-light tracking-tighter tabular-nums text-foreground"
      >
        {Array.from(time).map((char, index) =>
          /\d/.test(char) ? (
            <Digit key={index} char={char} still={reduced} />
          ) : (
            <span key={index} className="relative -top-[0.06em] px-[0.02em] text-muted-foreground/50">
              {char}
            </span>
          ),
        )}
      </time>
      <p className="mt-1 text-[15px] font-medium tracking-tight text-muted-foreground">{date}</p>
    </div>
  );
}
