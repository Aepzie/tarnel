import { useEffect, useId, useRef, useState, type CSSProperties, type FormEvent } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { ChevronRight, Flame, Loader2, ShieldCheck } from 'lucide-react';
import { SPACE_COLORS, type FingerprintLevel, type Space, type SpaceColor, type SpaceId } from '@shared/types';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { useOverlayPresence } from '@/hooks/overlay';
import { useBrowserSlice } from '@/hooks/browser';
import { SPACE_HEX, vela } from '@/lib/vela';
import { ease, spring } from '@/lib/motion';
import { cn } from '@/lib/utils';
import { ColorSwatches } from './ColorSwatches';
import { FingerprintPicker, RegionFields } from './FingerprintPicker';
import { SpaceMark } from './SpaceMark';
import { GLASS_SURFACE } from './surface';

const NAME_MAX = 32;

interface CreateSpaceDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** When set, the dialog edits this space (rename / recolor / proxy) instead of creating one. */
  editing?: Space | null;
}

/** Strips Electron's "Error invoking remote method 'x': Error: " prefix from IPC rejections. */
export function ipcErrorMessage(error: unknown, fallback: string): string {
  const raw = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
  const clean = raw.replace(/^Error invoking remote method '[^']*':\s*/, '').replace(/^(Type|Range)?Error:\s*/, '').trim();
  return clean || fallback;
}

/** Create (or edit) a Space: name, color, Burner switch, optional per-space proxy and fingerprint level. */
export function CreateSpaceDialog({ open, onOpenChange, editing = null }: CreateSpaceDialogProps) {
  useOverlayPresence(open);
  const reduce = useReducedMotion();
  const spaces = useBrowserSlice((s) => s.spaces);
  const ids = useId();
  const nameRef = useRef<HTMLInputElement>(null);
  /** Space already created by a submit whose activate step failed — a retry must not create it again. */
  const createdRef = useRef<SpaceId | null>(null);

  const [name, setName] = useState('');
  const [color, setColor] = useState<SpaceColor>('blue');
  const [ephemeral, setEphemeral] = useState(false);
  const [proxy, setProxy] = useState('');
  const [fingerprint, setFingerprint] = useState<FingerprintLevel>('standard');
  const [timezone, setTimezone] = useState('');
  const [language, setLanguage] = useState('');
  /** Until the user picks a level, Burner implies Strict. */
  const fingerprintTouched = useRef(false);
  const [advanced, setAdvanced] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    if (editing) {
      setName(editing.name);
      setColor(editing.color);
      setEphemeral(editing.ephemeral);
      setProxy(editing.proxy);
      setFingerprint(editing.fingerprint);
      setTimezone(editing.timezone ?? '');
      setLanguage(editing.language ?? '');
      setAdvanced(Boolean(editing.proxy) || editing.fingerprint !== (editing.ephemeral ? 'strict' : 'standard'));
    } else {
      const used = new Set(spaces.map((space) => space.color));
      setName('');
      setColor(SPACE_COLORS.find((c) => !used.has(c)) ?? 'blue');
      setEphemeral(false);
      setProxy('');
      setFingerprint('standard');
      setTimezone('');
      setLanguage('');
      setAdvanced(false);
    }
    fingerprintTouched.current = false;
    setBusy(false);
    setError('');
    createdRef.current = null;
    // Reset only when the dialog (re)opens, not on every state push.
  }, [open, editing?.id]);

  const hex = SPACE_HEX[color];
  const fallbackName = ephemeral ? 'Burner' : 'Space';
  const isEdit = Boolean(editing);

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    const finalName = name.trim() || (editing?.name ?? fallbackName);
    try {
      if (editing) {
        await vela().spaces.update(editing.id, { name: finalName, color, proxy: proxy.trim(), fingerprint, timezone, language });
      } else {
        const createdId = createdRef.current ?? (await vela().spaces.create({ name: finalName, color, ephemeral, proxy: proxy.trim(), fingerprint, timezone, language })).id;
        createdRef.current = createdId;
        try {
          await vela().spaces.activate(createdId);
        } catch (activateError) {
          setError(ipcErrorMessage(activateError, 'Space created, but switching to it failed. Try again.'));
          setBusy(false);
          return;
        }
        createdRef.current = null;
      }
      onOpenChange(false);
    } catch (err) {
      setError(ipcErrorMessage(err, isEdit ? 'Could not save this Space.' : 'Could not create the Space.'));
      setBusy(false);
    }
  };

  const fadeTransition = reduce ? { duration: 0 } : { duration: 0.2, ease: ease.out };

  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogContent
        showCloseButton={false}
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          nameRef.current?.focus();
          nameRef.current?.select();
        }}
        className={cn(GLASS_SURFACE, 'w-[380px] max-w-[calc(100%-32px)] gap-0 overflow-hidden rounded-2xl p-0 sm:max-w-[380px]')}
      >
        {/* Accent wash: the only gradient allowed — a faint glow of the chosen color. */}
        <motion.div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 -top-24 h-40 rounded-full blur-3xl"
          initial={false}
          animate={{ backgroundColor: hex, opacity: 0.16 }}
          transition={fadeTransition}
        />

        <form onSubmit={submit} className="relative flex flex-col">
          <header className="flex items-start gap-3 px-5 pt-5 pb-4">
            <motion.span
              className="grid size-9 shrink-0 place-items-center rounded-[10px]"
              initial={false}
              animate={{ backgroundColor: `${hex}1f`, boxShadow: `inset 0 0 0 1px ${hex}40` }}
              transition={fadeTransition}
            >
              <SpaceMark space={{ color, ephemeral }} glow />
            </motion.span>
            <div className="flex min-w-0 flex-col gap-1">
              <DialogTitle className="text-[15px] leading-5 font-semibold tracking-tight">
                {isEdit ? 'Edit Space' : 'New Space'}
              </DialogTitle>
              <DialogDescription className="text-[12px] leading-4 text-muted-foreground">
                Each Space is a sealed sandbox — own cookies, logins, cache and storage.
              </DialogDescription>
            </div>
          </header>

          <div className="flex flex-col gap-4 px-5 pb-5">
            <div className="flex flex-col gap-2">
              <Label htmlFor={`${ids}-name`} className="text-[12px] font-medium text-muted-foreground">
                Name
              </Label>
              <div className="relative">
                <Input
                  id={`${ids}-name`}
                  ref={nameRef}
                  value={name}
                  maxLength={NAME_MAX}
                  spellCheck={false}
                  autoComplete="off"
                  placeholder={editing?.name ?? fallbackName}
                  onChange={(event) => setName(event.target.value)}
                  className="h-9 rounded-[10px] pr-12 text-[13px]"
                  style={{ '--ring': `${hex}99` } as CSSProperties}
                />
                <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-[11px] text-muted-foreground/70 tabular-nums">
                  {name.length}/{NAME_MAX}
                </span>
              </div>
            </div>

            <div className="flex flex-col gap-2">
              <span className="text-[12px] font-medium text-muted-foreground">Color</span>
              <ColorSwatches value={color} onChange={setColor} className="-mx-0.5" />
            </div>

            {isEdit ? (
              ephemeral && (
                <div className="flex items-center gap-2 rounded-[10px] bg-orange-400/10 px-3 py-2 text-[12px] text-orange-600 dark:text-orange-300">
                  <Flame className="size-3.5 shrink-0" strokeWidth={1.75} />
                  Burner Space — everything is wiped when it closes.
                </div>
              )
            ) : (
              <label
                htmlFor={`${ids}-burner`}
                className={cn(
                  'flex cursor-pointer items-center gap-3 rounded-xl px-3 py-2.5 transition-colors duration-150',
                  ephemeral ? 'bg-orange-400/10 ring-1 ring-orange-400/25' : 'bg-muted ring-1 ring-transparent hover:bg-accent',
                )}
              >
                <Flame
                  className={cn('size-4 shrink-0 transition-colors', ephemeral ? 'text-orange-500 dark:text-orange-400' : 'text-muted-foreground')}
                  strokeWidth={1.75}
                />
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="text-[13px] leading-4 font-medium">Burner — wiped when closed</span>
                  <span className="text-[11px] leading-4 text-muted-foreground">
                    Lives in memory only. No history, cookies or cache survive.
                  </span>
                </span>
                <Switch
                  id={`${ids}-burner`}
                  checked={ephemeral}
                  onCheckedChange={(burner) => {
                    setEphemeral(burner);
                    if (!fingerprintTouched.current) setFingerprint(burner ? 'strict' : 'standard');
                  }}
                />
              </label>
            )}

            <div className="flex flex-col">
              <button
                type="button"
                aria-expanded={advanced}
                onClick={() => setAdvanced((v) => !v)}
                className="-mx-1 flex h-7 w-fit items-center gap-1 rounded-md px-1 text-[12px] font-medium text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
              >
                <motion.span
                  className="grid place-items-center"
                  animate={{ rotate: advanced ? 90 : 0 }}
                  transition={reduce ? { duration: 0 } : spring.snappy}
                >
                  <ChevronRight className="size-3.5" strokeWidth={2} />
                </motion.span>
                Advanced
              </button>
              <AnimatePresence initial={false}>
                {advanced && (
                  <motion.div
                    key="advanced"
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={reduce ? { duration: 0 } : { height: spring.soft, opacity: { duration: 0.16 } }}
                    className="overflow-hidden"
                  >
                    <div className="flex flex-col gap-2 pt-2">
                      <Label htmlFor={`${ids}-proxy`} className="text-[12px] font-medium text-muted-foreground">
                        Proxy for this Space
                      </Label>
                      <Input
                        id={`${ids}-proxy`}
                        value={proxy}
                        spellCheck={false}
                        autoComplete="off"
                        placeholder="socks5://127.0.0.1:9050"
                        onChange={(event) => setProxy(event.target.value)}
                        className="h-9 rounded-[10px] font-mono text-[12px]"
                        style={{ '--ring': `${hex}99` } as CSSProperties}
                      />
                      <span className="flex items-center gap-1.5 text-[11px] leading-4 text-muted-foreground">
                        <ShieldCheck className="size-3 shrink-0" strokeWidth={1.75} />
                        Only this Space's traffic is routed. Leave empty for direct.
                      </span>
                    </div>
                    <div className="pt-4">
                      <FingerprintPicker
                        value={fingerprint}
                        hex={hex}
                        spaceId={editing?.id}
                        onChange={(level) => {
                          fingerprintTouched.current = true;
                          setFingerprint(level);
                        }}
                      />
                    </div>
                    <div className="pt-3">
                      <RegionFields
                        timezone={timezone}
                        language={language}
                        onTimezone={setTimezone}
                        onLanguage={setLanguage}
                        disabled={fingerprint === 'off'}
                      />
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            <AnimatePresence initial={false}>
              {error && (
                <motion.p
                  key="error"
                  role="alert"
                  initial={{ height: 0, opacity: 0, y: -4 }}
                  animate={{ height: 'auto', opacity: 1, y: 0 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={reduce ? { duration: 0 } : spring.snappy}
                  className="overflow-hidden text-[12px] leading-4 text-destructive"
                >
                  {error}
                </motion.p>
              )}
            </AnimatePresence>
          </div>

          <footer className="flex items-center justify-end gap-2 border-t border-border/60 bg-muted/40 px-5 py-3">
            <button
              type="button"
              disabled={busy}
              onClick={() => onOpenChange(false)}
              className="h-8 rounded-[10px] px-3 text-[13px] font-medium text-muted-foreground transition-[color,background-color,transform] duration-150 outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.96] disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={busy}
              className="relative flex h-8 min-w-20 items-center justify-center gap-1.5 rounded-[10px] px-3.5 text-[13px] font-semibold text-zinc-950 transition-[background-color,box-shadow,transform,filter] duration-300 outline-none hover:brightness-110 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background active:scale-[0.96] disabled:opacity-70"
              style={{
                backgroundColor: hex,
                boxShadow: `inset 0 1px 0 rgb(255 255 255 / 0.35), 0 6px 20px -8px ${hex}`,
              }}
            >
              {busy && <Loader2 className="size-3.5 animate-spin" strokeWidth={2.25} />}
              {isEdit ? 'Save' : ephemeral ? 'Create Burner' : 'Create'}
            </button>
          </footer>
        </form>
      </DialogContent>
    </Dialog>
  );
}
