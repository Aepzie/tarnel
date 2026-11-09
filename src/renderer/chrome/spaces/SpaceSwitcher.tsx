import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion, type Variants } from 'motion/react';
import { Check, ChevronDown, Ellipsis, Eraser, Flame, Pencil, Plus, Trash2 } from 'lucide-react';
import { DropdownMenu as DropdownMenuPrimitive } from 'radix-ui';
import type { Space, SpaceId, UICommand } from '@shared/types';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Kbd, KbdGroup } from '@/components/ui/kbd';
import { useOverlayPresence } from '@/hooks/overlay';
import { shallowEqual, useBrowserSlice, useCommand } from '@/hooks/browser';
import { settle, vela } from '@/lib/vela';
import { ease, spring } from '@/lib/motion';
import { cn } from '@/lib/utils';
import { SpaceColorRow } from './SpaceColorRow';
import { SpaceMark } from './SpaceMark';
import { GLASS_SURFACE, MENU_LABEL, MENU_ROW } from './surface';

/** Dialogs are rarely opened: keep them out of the startup bundle, prefetch when the menu opens. */
const loadCreateDialog = () => import('./CreateSpaceDialog');
const loadDeleteDialog = () => import('./DeleteSpaceDialog');
const CreateSpaceDialog = lazy(() => loadCreateDialog().then((module) => ({ default: module.CreateSpaceDialog })));
const DeleteSpaceDialog = lazy(() => loadDeleteDialog().then((module) => ({ default: module.DeleteSpaceDialog })));

const BURNER_INPUT = { name: 'Burner', color: 'orange', ephemeral: true } as const;

/**
 * The submenu anchors to the row's "…" button (right-8 / top-1 inside the row, row inside p-1.5 content),
 * so offsets are shifted to place it 6px past the main menu's edge, aligned with the row's top.
 */
const SUB_GAP = 6;
const MENU_PAD = 6;
const SUB_SIDE_OFFSET = 32 + MENU_PAD + SUB_GAP;
const SUB_ALIGN_OFFSET = -(4 + MENU_PAD);

interface DialogState {
  open: boolean;
  editing: Space | null;
}

/**
 * Top-island Space switcher: animated identity pill + glass dropdown with per-space actions.
 * `compact` = mark only (collapsed vertical tab island).
 */
export function SpaceSwitcher({ compact = false }: { compact?: boolean }) {
  const spaces = useBrowserSlice((s) => s.spaces);
  const activeSpaceId = useBrowserSlice((s) => s.activeSpaceId);
  const tabSpaceIds = useBrowserSlice((s) => s.tabs.map((tab) => tab.spaceId), shallowEqual);
  const active = useMemo(() => spaces.find((space) => space.id === activeSpaceId), [spaces, activeSpaceId]);
  const reduce = useReducedMotion();

  const [menuOpen, setMenuOpen] = useState(false);
  const [rowMenu, setRowMenu] = useState<SpaceId | null>(null);
  const [handoff, setHandoff] = useState(false);
  const [dialog, setDialog] = useState<DialogState>({ open: false, editing: null });
  const [deleting, setDeleting] = useState<Space | null>(null);
  const skipFocusRestore = useRef(false);
  // Mounted on first use, then kept mounted so close animations still play.
  const createUsed = useRef(false);
  const deleteUsed = useRef(false);
  if (dialog.open) createUsed.current = true;
  if (deleting) deleteUsed.current = true;

  useEffect(() => {
    if (!menuOpen) return;
    void loadCreateDialog();
    void loadDeleteDialog();
  }, [menuOpen]);

  // Bridges the gap between the menu closing and a dialog mounting so the page never flashes on top.
  useOverlayPresence(menuOpen || handoff);

  const tabCounts = useMemo(() => {
    const counts = new Map<SpaceId, number>();
    for (const spaceId of tabSpaceIds) counts.set(spaceId, (counts.get(spaceId) ?? 0) + 1);
    return counts;
  }, [tabSpaceIds]);

  /** Close the menu, then run `open` once it is gone (Radix menus and dialogs must not overlap). */
  const handOff = useCallback((open: () => void) => {
    skipFocusRestore.current = true;
    setHandoff(true);
    setRowMenu(null);
    setMenuOpen(false);
    window.setTimeout(() => {
      open();
      setHandoff(false);
    }, 0);
  }, []);

  const openCreate = useCallback(() => setDialog({ open: true, editing: null }), []);

  const createBurner = useCallback(async () => {
    try {
      const space = await vela().spaces.create({ ...BURNER_INPUT });
      await vela().spaces.activate(space.id);
    } catch {
      /* main rejected (e.g. shutting down) — nothing to roll back */
    }
  }, []);

  const onCommand = useCallback(
    (command: UICommand) => {
      if (command === 'new-space') handOff(openCreate);
    },
    [handOff, openCreate],
  );
  useCommand(onCommand);

  const isMac = vela()?.platform === 'darwin';
  const hotkey = isMac ? ['⌘', '⇧', 'N'] : ['Ctrl', 'Shift', 'N'];

  return (
    <>
      <DropdownMenu
        open={menuOpen}
        onOpenChange={(open) => {
          setMenuOpen(open);
          if (!open) setRowMenu(null);
        }}
      >
        <DropdownMenuTrigger asChild disabled={!active}>
          <motion.button
            type="button"
            aria-label={active ? `Space: ${active.name}${active.ephemeral ? ' (Burner)' : ''}. Switch space` : 'Spaces'}
            whileTap={reduce ? undefined : { scale: 0.96 }}
            transition={spring.snappy}
            className={cn(
              'no-drag group/trigger relative flex h-8 max-w-44 shrink-0 items-center gap-1.5 rounded-[10px] text-[13px] text-foreground',
              compact ? 'w-8 justify-center' : 'pr-1.5 pl-2',
              'transition-colors duration-150 outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring data-[state=open]:bg-accent',
              active?.ephemeral && 'bg-orange-400/[0.06]',
            )}
          >
            {active?.ephemeral && <BurnerShimmer reduce={Boolean(reduce)} />}
            {active ? (
              <SpaceMark space={active} glow />
            ) : (
              <span aria-hidden className="grid size-4 place-items-center">
                <span className="size-2 rounded-full bg-muted-foreground/40" />
              </span>
            )}
            {!compact && <SpaceName space={active} reduce={Boolean(reduce)} spaces={spaces} />}
            {!compact && <motion.span
              aria-hidden
              className="grid size-4 shrink-0 place-items-center text-muted-foreground transition-colors group-hover/trigger:text-foreground"
              animate={{ rotate: menuOpen ? 180 : 0 }}
              transition={reduce ? { duration: 0 } : spring.snappy}
            >
              <ChevronDown className="size-3.5" strokeWidth={2} />
            </motion.span>}
          </motion.button>
        </DropdownMenuTrigger>

        <DropdownMenuContent
          align="start"
          sideOffset={8}
          collisionPadding={8}
          className={cn(
            GLASS_SURFACE,
            'max-h-[min(60vh,var(--radix-dropdown-menu-content-available-height))] w-64 overflow-x-hidden overflow-y-auto overscroll-contain rounded-xl p-1.5',
          )}
          onCloseAutoFocus={(event) => {
            if (skipFocusRestore.current) event.preventDefault();
            skipFocusRestore.current = false;
          }}
        >
          <div className={MENU_LABEL}>Spaces</div>
          {spaces.map((space) => (
            <SpaceRow
              key={space.id}
              space={space}
              active={space.id === activeSpaceId}
              tabCount={tabCounts.get(space.id) ?? 0}
              canDelete={spaces.length > 1}
              subOpen={rowMenu === space.id}
              onSubOpenChange={(open) => setRowMenu(open ? space.id : null)}
              onRename={() => handOff(() => setDialog({ open: true, editing: space }))}
              onDelete={() => handOff(() => setDeleting(space))}
            />
          ))}

          <DropdownMenuSeparator className="-mx-1.5 my-1.5 bg-border/70" />

          <DropdownMenuItem className={MENU_ROW} onSelect={() => handOff(openCreate)}>
            <span className="grid size-4 place-items-center">
              <Plus className="size-4" strokeWidth={1.75} />
            </span>
            New Space…
          </DropdownMenuItem>
          <DropdownMenuItem className={MENU_ROW} onSelect={() => void createBurner()}>
            <span className="grid size-4 place-items-center">
              <Flame className="size-4 text-orange-500! dark:text-orange-400!" strokeWidth={1.75} />
            </span>
            New Burner Space
            <KbdGroup className="ml-auto">
              {hotkey.map((key) => (
                <Kbd
                  key={key}
                  className="h-[18px] min-w-[18px] rounded-[5px] bg-foreground/[0.06] px-1 text-[10px] leading-none font-medium text-muted-foreground"
                >
                  {key}
                </Kbd>
              ))}
            </KbdGroup>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Suspense fallback={null}>
        {createUsed.current && (
          <CreateSpaceDialog
            open={dialog.open}
            editing={dialog.editing}
            onOpenChange={(open) => setDialog((current) => ({ ...current, open }))}
          />
        )}
        {deleteUsed.current && (
          <DeleteSpaceDialog space={deleting} onOpenChange={(open) => !open && setDeleting(null)} />
        )}
      </Suspense>
    </>
  );
}

/* ------------------------------------------------------------------------------------------------ */

const nameVariants: Variants = {
  enter: (dir: number) => ({ y: dir * 14, opacity: 0, filter: 'blur(3px)' }),
  center: { y: 0, opacity: 1, filter: 'blur(0px)' },
  exit: (dir: number) => ({ y: dir * -14, opacity: 0, filter: 'blur(3px)' }),
};

/** Active space name; slides vertically in the direction of travel through the space list. */
function SpaceName({ space, spaces, reduce }: { space: Space | undefined; spaces: Space[]; reduce: boolean }) {
  const index = space ? spaces.findIndex((s) => s.id === space.id) : -1;
  const [travel, setTravel] = useState({ index, direction: 1 });
  if (travel.index !== index) setTravel({ index, direction: index >= travel.index ? 1 : -1 });
  const direction = travel.index === index ? travel.direction : index >= travel.index ? 1 : -1;

  return (
    <span className="relative flex h-5 max-w-28 min-w-0 items-center overflow-hidden">
      <AnimatePresence mode="popLayout" initial={false} custom={direction}>
        <motion.span
          key={space ? `${space.id}:${space.name}` : 'none'}
          custom={direction}
          variants={reduce ? undefined : nameVariants}
          initial="enter"
          animate="center"
          exit="exit"
          transition={{ y: spring.snappy, opacity: { duration: 0.16, ease: ease.out }, filter: { duration: 0.16 } }}
          className="block truncate leading-5 font-medium tracking-tight"
        >
          {space?.name ?? 'Spaces'}
        </motion.span>
      </AnimatePresence>
    </span>
  );
}

/**
 * Thin orange light that sweeps around the pill border of a Burner space. A few CSS sweeps on entry,
 * then it rests: an endless background-position loop repainted the island for as long as you browsed.
 */
function BurnerShimmer({ reduce }: { reduce: boolean }) {
  return (
    <span
      aria-hidden
      className={cn('pointer-events-none absolute inset-0 rounded-[10px] p-px', !reduce && 'vela-burner-sweep')}
      style={{
        backgroundImage:
          'linear-gradient(110deg, rgb(251 146 60 / 0.22) 0%, rgb(251 146 60 / 0.22) 42%, rgb(254 215 170 / 0.95) 50%, rgb(251 146 60 / 0.22) 58%, rgb(251 146 60 / 0.22) 100%)',
        backgroundSize: '250% 100%',
        backgroundPosition: '100% 0%',
        WebkitMask: 'linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0)',
        WebkitMaskComposite: 'xor',
        mask: 'linear-gradient(#000 0 0) content-box exclude, linear-gradient(#000 0 0)',
      }}
    />
  );
}

/* ------------------------------------------------------------------------------------------------ */

interface SpaceRowProps {
  space: Space;
  active: boolean;
  tabCount: number;
  canDelete: boolean;
  subOpen: boolean;
  onSubOpenChange: (open: boolean) => void;
  onRename: () => void;
  onDelete: () => void;
}

function SpaceRow({ space, active, tabCount, canDelete, subOpen, onSubOpenChange, onRename, onDelete }: SpaceRowProps) {
  return (
    <DropdownMenuSub open={subOpen} onOpenChange={onSubOpenChange}>
      <div
        className="group/row relative"
        onContextMenu={(event) => {
          event.preventDefault();
          onSubOpenChange(true);
        }}
      >
        <DropdownMenuItem
          className={MENU_ROW}
          onSelect={() => {
            if (!active) settle(vela().spaces.activate(space.id));
          }}
          onKeyDown={(event) => {
            if (event.key !== 'ArrowRight') return;
            event.preventDefault();
            onSubOpenChange(true);
          }}
        >
          <SpaceMark space={space} glow={active} />
          <span className={cn('min-w-0 flex-1 truncate', active ? 'font-medium' : 'text-foreground/85')}>{space.name}</span>
          <span
            className={cn(
              'text-[11px] text-muted-foreground tabular-nums transition-opacity duration-100',
              'group-hover/row:opacity-0 group-has-[[data-state=open]]/row:opacity-0',
            )}
            aria-label={`${tabCount} ${tabCount === 1 ? 'tab' : 'tabs'}`}
          >
            {tabCount}
          </span>
          <span className="grid size-4 shrink-0 place-items-center">
            {active && <Check className="size-3.5 text-foreground!" strokeWidth={2.25} />}
          </span>
        </DropdownMenuItem>

        <DropdownMenuPrimitive.SubTrigger
          aria-label={`${space.name} options`}
          className={cn(
            'absolute top-1 right-8 grid size-6 place-items-center rounded-md text-muted-foreground outline-none',
            'opacity-0 transition-[opacity,background-color,color] duration-100',
            'group-hover/row:opacity-100 data-[highlighted]:opacity-100 data-[state=open]:opacity-100',
            'data-[highlighted]:bg-foreground/10 data-[highlighted]:text-foreground data-[state=open]:bg-foreground/10 data-[state=open]:text-foreground',
          )}
        >
          <Ellipsis className="size-4" strokeWidth={1.75} />
        </DropdownMenuPrimitive.SubTrigger>
      </div>

      <DropdownMenuSubContent
        sideOffset={SUB_SIDE_OFFSET}
        alignOffset={SUB_ALIGN_OFFSET}
        collisionPadding={8}
        className={cn(GLASS_SURFACE, 'w-56 rounded-xl p-1.5')}
      >
        <DropdownMenuItem className={MENU_ROW} onSelect={onRename}>
          <Pencil className="size-4" strokeWidth={1.75} />
          Rename…
        </DropdownMenuItem>
        <div className={MENU_LABEL}>Color</div>
        <SpaceColorRow space={space} />
        <DropdownMenuItem
          className={MENU_ROW}
          onSelect={() => settle(vela().tabs.create({ url: 'vela://settings/#spaces', active: true }))}
        >
          <Eraser className="size-4" strokeWidth={1.75} />
          Clear data…
        </DropdownMenuItem>
        <DropdownMenuSeparator className="-mx-1.5 my-1.5 bg-border/70" />
        <DropdownMenuItem className={MENU_ROW} variant="destructive" disabled={!canDelete} onSelect={onDelete}>
          <Trash2 className="size-4" strokeWidth={1.75} />
          {canDelete ? 'Delete Space…' : 'Delete Space'}
          {!canDelete && <span className="ml-auto text-[11px] text-muted-foreground">Last one</span>}
        </DropdownMenuItem>
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
}
