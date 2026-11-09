/**
 * Shared glass surface for floating chrome menus / popovers / dialogs (spaces + perf).
 * Matches the island recipe: translucent popover fill, hairline ring, inner top highlight, soft depth.
 */
export const GLASS_SURFACE =
  'border-0 bg-popover backdrop-blur-2xl backdrop-saturate-150 text-popover-foreground ' +
  'shadow-[0_0_0_1px_var(--island-ring),inset_0_1px_0_var(--island-highlight),0_16px_48px_-12px_rgb(0_0_0/0.55)] ' +
  'light:shadow-[0_0_0_1px_var(--island-ring),inset_0_1px_0_var(--island-highlight),0_16px_40px_-16px_rgb(0_0_0/0.25)]';

/** Menu row: 32px tall, 10px radius (concentric with a 16px surface + 6px padding). */
export const MENU_ROW =
  'h-8 gap-2.5 rounded-[10px] px-2 text-[13px] leading-none tracking-tight ' +
  'focus:bg-accent data-[highlighted]:bg-accent transition-colors duration-100';

/** Tiny uppercase section label. */
export const MENU_LABEL = 'px-2 pt-1.5 pb-1 text-[11px] font-medium tracking-wide text-muted-foreground/80 uppercase';
