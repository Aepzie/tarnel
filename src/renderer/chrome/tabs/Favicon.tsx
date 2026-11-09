import { memo, useState, type CSSProperties } from 'react';
import { MoonIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { hostOf, letterOf } from '@/lib/vela';

interface FaviconProps {
  src: string | null;
  url: string;
  title: string;
  asleep?: boolean;
  className?: string;
}

/** Deterministic hue per host so letter tiles are stable and distinct. */
function hueOf(text: string): number {
  let hash = 0;
  for (let i = 0; i < text.length; i++) hash = (hash * 31 + text.charCodeAt(i)) | 0;
  return Math.abs(hash) % 360;
}

/** 16px favicon with a tinted letter-tile fallback and an "asleep" treatment. */
export const Favicon = memo(function Favicon({ src, url, title, asleep = false, className }: FaviconProps) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const showImage = !!src && failedSrc !== src;
  const hue = hueOf(hostOf(url) || title);

  return (
    <span className={cn('relative inline-flex size-4 shrink-0 items-center justify-center', className)} aria-hidden="true">
      <span
        className={cn(
          'inline-flex size-4 items-center justify-center transition-[filter,opacity] duration-200',
          asleep && 'opacity-60 saturate-[0.3] light:opacity-70',
        )}
      >
        {showImage ? (
          <img
            src={src}
            alt=""
            draggable={false}
            decoding="async"
            referrerPolicy="no-referrer"
            className="size-4 rounded-[3px] object-contain"
            onError={() => setFailedSrc(src)}
          />
        ) : (
          <span
            className={cn(
              'inline-flex size-4 items-center justify-center rounded-[5px] text-[9px] leading-none font-semibold',
              'bg-[hsl(var(--tile-hue)_70%_60%/0.2)] text-[hsl(var(--tile-hue)_75%_72%)]',
              'light:bg-[hsl(var(--tile-hue)_70%_50%/0.14)] light:text-[hsl(var(--tile-hue)_60%_36%)]',
            )}
            style={{ '--tile-hue': hue } as CSSProperties}
          >
            {letterOf(url, title)}
          </span>
        )}
      </span>
      {asleep && (
        <span className="absolute -right-1 -bottom-1 inline-flex size-2.5 items-center justify-center rounded-full bg-zinc-800 ring-1 ring-white/10 light:bg-white light:ring-black/10">
          <MoonIcon className="size-[7px] text-zinc-300 light:text-zinc-600" strokeWidth={2.5} />
        </span>
      )}
    </span>
  );
});
