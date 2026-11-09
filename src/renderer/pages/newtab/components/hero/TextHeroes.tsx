import { useNow, locale } from './useNow';

/** Big weekday with a day/month line underneath. */
export function DateHero() {
  const now = useNow(60_000);
  const lang = locale();
  const weekday = new Intl.DateTimeFormat(lang, { weekday: 'long' }).format(now);
  const dayMonth = new Intl.DateTimeFormat(lang, { day: 'numeric', month: 'long', year: 'numeric' }).format(now);
  return (
    <div className="flex flex-col items-center">
      <p className="text-8xl leading-[1.2] font-light tracking-tighter text-foreground">{weekday}</p>
      <p className="mt-1 text-[15px] font-medium tracking-tight text-muted-foreground">{dayMonth}</p>
    </div>
  );
}

type DayPart = 'morning' | 'afternoon' | 'evening' | 'night';

const GREETINGS: Record<'de' | 'en', Record<DayPart, string>> = {
  de: { morning: 'Guten Morgen', afternoon: 'Guten Tag', evening: 'Guten Abend', night: 'Gute Nacht' },
  en: { morning: 'Good morning', afternoon: 'Good afternoon', evening: 'Good evening', night: 'Good night' },
};

function dayPart(hour: number): DayPart {
  if (hour >= 5 && hour < 12) return 'morning';
  if (hour >= 12 && hour < 18) return 'afternoon';
  if (hour >= 18 && hour < 22) return 'evening';
  return 'night';
}

/** Localized time-of-day greeting with the time underneath. */
export function GreetingHero() {
  const now = useNow(60_000);
  const lang = locale();
  const words = GREETINGS[lang.toLowerCase().startsWith('de') ? 'de' : 'en'];
  const time = new Intl.DateTimeFormat(lang, { hour: '2-digit', minute: '2-digit' }).format(now);
  return (
    <div className="flex flex-col items-center">
      <p className="text-7xl leading-[1.2] font-light tracking-tighter text-foreground">{words[dayPart(now.getHours())]}</p>
      <time dateTime={now.toISOString()} className="mt-2 text-[15px] font-medium tracking-tight tabular-nums text-muted-foreground">
        {time}
      </time>
    </div>
  );
}
