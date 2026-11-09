import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ease, rise } from '@/lib/motion';
import { Switch } from '@/components/ui/switch';
import { useSettings, type BooleanSettingKey } from '../store';

/** Subtle "Saved" confirmation that fades in on each successful write, then out. */
export function SavedMark() {
  const { savedTick } = useSettings();
  const seen = useRef(savedTick);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (savedTick === seen.current) return;
    seen.current = savedTick;
    setVisible(true);
    const timer = window.setTimeout(() => setVisible(false), 1600);
    return () => window.clearTimeout(timer);
  }, [savedTick]);

  return (
    <div className="flex h-6 items-center" role="status" aria-live="polite">
      <AnimatePresence>
        {visible && (
          <motion.span
            key={savedTick}
            initial={{ opacity: 0, y: 3, filter: 'blur(3px)' }}
            animate={{ opacity: 1, y: 0, filter: 'blur(0px)', transition: { duration: 0.2, ease: ease.out } }}
            exit={{ opacity: 0, transition: { duration: 0.3, ease: ease.out } }}
            className="flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground ring-1 ring-border"
          >
            <Check className="size-3 text-space" strokeWidth={2.5} aria-hidden />
            Saved
          </motion.span>
        )}
      </AnimatePresence>
    </div>
  );
}

export function SectionHeader({ title, description }: { title: string; description: string }) {
  return (
    <motion.header variants={rise} className="mb-8 flex items-start justify-between gap-4">
      <div className="min-w-0">
        <h1 className="text-[22px] leading-8 font-semibold tracking-tight text-foreground">{title}</h1>
        <p className="mt-1 text-[13px] leading-5 text-muted-foreground">{description}</p>
      </div>
      <SavedMark />
    </motion.header>
  );
}

/** Grouped card: rows separated by hairlines. */
export function Group({ title, children, className }: { title?: string; children: ReactNode; className?: string }) {
  return (
    <motion.section variants={rise} className={cn('mb-8 last:mb-0', className)}>
      {title && <h2 className="mb-2 px-1 text-xs font-medium text-muted-foreground">{title}</h2>}
      <div className="divide-y divide-border overflow-hidden rounded-xl bg-card/50 ring-1 ring-border shadow-[inset_0_1px_0_var(--island-highlight)]">
        {children}
      </div>
    </motion.section>
  );
}

interface RowProps {
  title: ReactNode;
  description?: ReactNode;
  /** Id of the control this row labels (makes the title a <label>). */
  htmlFor?: string;
  descriptionId?: string;
  children: ReactNode;
  className?: string;
}

export function Row({ title, description, htmlFor, descriptionId, children, className }: RowProps) {
  const TitleTag = htmlFor ? 'label' : 'div';
  return (
    <div className={cn('flex min-h-16 items-center justify-between gap-6 px-4 py-3', className)}>
      <div className="min-w-0 flex-1">
        <TitleTag htmlFor={htmlFor} className="block text-[13px] leading-5 font-medium text-foreground">
          {title}
        </TitleTag>
        {description && (
          <div id={descriptionId} className="mt-0.5 text-xs leading-5 text-muted-foreground">
            {description}
          </div>
        )}
      </div>
      <div className="flex shrink-0 items-center">{children}</div>
    </div>
  );
}

/** Row bound to a boolean setting. */
export function SwitchRow({ title, description, setting }: { title: string; description: ReactNode; setting: BooleanSettingKey }) {
  const { settings, update } = useSettings();
  const id = useId();
  return (
    <Row title={title} description={description} htmlFor={id} descriptionId={`${id}-desc`}>
      <Switch
        id={id}
        aria-describedby={`${id}-desc`}
        checked={settings[setting]}
        onCheckedChange={(checked) => update({ [setting]: checked } as Partial<typeof settings>)}
      />
    </Row>
  );
}
