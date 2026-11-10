import { cn } from '@/lib/utils';

let supported: boolean | null = null;

/** Windows ships no flag glyphs (regional indicators render as letters), so probe for color once. */
function flagsSupported(): boolean {
  if (supported !== null) return supported;
  try {
    const canvas = document.createElement('canvas');
    canvas.width = 20;
    canvas.height = 20;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) return (supported = false);
    context.font = '16px sans-serif';
    context.fillText('\u{1F1E9}\u{1F1EA}', 0, 16);
    const pixels = context.getImageData(0, 0, 20, 20).data;
    let colored = false;
    for (let index = 0; index < pixels.length && !colored; index += 4) {
      const red = pixels[index]!;
      const green = pixels[index + 1]!;
      const blue = pixels[index + 2]!;
      colored = pixels[index + 3]! > 0 && (Math.abs(red - green) > 30 || Math.abs(green - blue) > 30);
    }
    supported = colored;
  } catch {
    supported = false;
  }
  return supported;
}

export function flagEmoji(countryCode: string): string {
  return String.fromCodePoint(...[...countryCode.toUpperCase()].map((char) => 0x1f1e6 + char.charCodeAt(0) - 65));
}

/** Country flag emoji, or a compact country-code chip where the OS font has no flags. */
export function Flag({ code, className }: { code: string; className?: string }) {
  if (flagsSupported()) {
    return (
      <span aria-hidden className={cn('inline-block w-5 shrink-0 text-center text-[15px] leading-none', className)}>
        {flagEmoji(code)}
      </span>
    );
  }
  return (
    <span
      aria-hidden
      className={cn(
        'inline-grid h-3.5 w-5 shrink-0 place-items-center rounded-[3px] bg-foreground/[0.09] font-mono text-[8.5px] font-semibold tracking-tight text-foreground/70 ring-1 ring-foreground/10 ring-inset',
        className,
      )}
    >
      {code}
    </span>
  );
}
