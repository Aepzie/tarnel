import { useState, type ReactNode } from 'react';
import { Kbd, KbdGroup } from '@/components/ui/kbd';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useOverlayPresence } from '@/hooks/overlay';

interface IslandTooltipProps {
  label: string;
  keys?: readonly string[];
  children: ReactNode;
}

/**
 * Tooltip for island controls. Controlled so it can hold the overlay while open — it hangs below
 * the island and would otherwise render underneath the page view.
 */
export function IslandTooltip({ label, keys, children }: IslandTooltipProps) {
  const [open, setOpen] = useState(false);
  useOverlayPresence(open, 120);

  return (
    <Tooltip open={open} onOpenChange={setOpen}>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent
        side="bottom"
        sideOffset={8}
        className="flex items-center gap-2 rounded-[8px] px-2 py-1 text-[12px] font-medium tracking-tight"
      >
        <span>{label}</span>
        {keys && keys.length > 0 && (
          <KbdGroup>
            {keys.map((key) => (
              <Kbd key={key} className="h-[18px] min-w-[18px] rounded-[5px] px-1 text-[11px]">
                {key}
              </Kbd>
            ))}
          </KbdGroup>
        )}
      </TooltipContent>
    </Tooltip>
  );
}
