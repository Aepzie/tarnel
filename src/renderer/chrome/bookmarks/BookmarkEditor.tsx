import { useEffect, useRef, useState, type FormEvent } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { Star } from 'lucide-react';
import type { BookmarkNode } from '@shared/bookmarks';
import { BOOKMARK_ROOTS } from '@shared/bookmarks-ipc';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { getBrowserStateSnapshot } from '@/hooks/browser';
import { useOverlayPresence } from '@/hooks/overlay';
import { ease, spring } from '@/lib/motion';
import { settle } from '@/lib/vela';
import { ui, useChromeUI } from '../ui-store';
import { folderOptions, isBookmarkable, useBookmarks } from './bookmarks-store';

/**
 * "Bookmark this page" popover (star button / Ctrl+D). Opening it bookmarks the active page in the
 * Bookmarks bar when it is not bookmarked yet; Done / Enter / clicking outside keeps the edits.
 */
export function BookmarkEditor() {
  const { bookmarkEditor } = useChromeUI();
  useOverlayPresence(bookmarkEditor.open);
  return <AnimatePresence>{bookmarkEditor.open && <EditorLayer key="bookmark-editor" />}</AnimatePresence>;
}

function comparable(url: string): string {
  return url.replace(/#.*$/, '').replace(/\/$/, '');
}

function EditorLayer() {
  const reduce = useReducedMotion();
  const nodes = useBookmarks();
  const [node, setNode] = useState<BookmarkNode | null>(null);
  const [created, setCreated] = useState(false);
  const [title, setTitle] = useState('');
  const [folder, setFolder] = useState<string>(BOOKMARK_ROOTS.bar);
  const started = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (started.current || !nodes) return;
    started.current = true;
    const { tabs, activeTabId } = getBrowserStateSnapshot();
    const tab = tabs.find((candidate) => candidate.id === activeTabId);
    if (!tab || !isBookmarkable(tab.url)) {
      ui.closeBookmarkEditor();
      return;
    }
    const existing = nodes.find((candidate) => candidate.kind === 'bookmark' && !!candidate.url && comparable(candidate.url) === comparable(tab.url));
    const adopt = (target: BookmarkNode): void => {
      setNode(target);
      setTitle(target.title);
      setFolder(target.parentId ?? BOOKMARK_ROOTS.bar);
    };
    if (existing) {
      adopt(existing);
      return;
    }
    window.vela.bookmarks
      .add({ parentId: BOOKMARK_ROOTS.bar, kind: 'bookmark', title: tab.title || tab.url, url: tab.url })
      .then((added) => {
        setCreated(true);
        adopt(added);
      })
      .catch(() => ui.closeBookmarkEditor());
  }, [nodes]);

  const nodeId = node?.id;
  useEffect(() => {
    if (!nodeId) return;
    const frame = requestAnimationFrame(() => {
      inputRef.current?.focus({ preventScroll: true });
      inputRef.current?.select();
    });
    return () => cancelAnimationFrame(frame);
  }, [nodeId]);

  const save = (): void => {
    ui.closeBookmarkEditor();
    if (!node) return;
    const patch: { title?: string; parentId?: string } = {};
    if (title.trim() && title.trim() !== node.title) patch.title = title;
    if (folder !== node.parentId) patch.parentId = folder;
    if (Object.keys(patch).length > 0) settle(window.vela.bookmarks.update(node.id, patch));
  };

  const remove = (): void => {
    ui.closeBookmarkEditor();
    if (node) settle(window.vela.bookmarks.remove(node.id));
  };

  const onSubmit = (event: FormEvent): void => {
    event.preventDefault();
    save();
  };

  const folders = nodes ? folderOptions(nodes) : [];

  return (
    <div className="fixed inset-0 z-[110]" role="presentation">
      <motion.div
        className="absolute inset-0"
        onPointerDown={save}
        onContextMenu={(event) => event.preventDefault()}
      />
      <div className="pointer-events-none absolute inset-x-0 top-[10vh] flex justify-center">
        <motion.form
          role="dialog"
          aria-label={created ? 'Bookmark added' : 'Edit bookmark'}
          onSubmit={onSubmit}
          onKeyDown={(event) => {
            if (event.key !== 'Escape') return;
            event.preventDefault();
            save();
          }}
          className="pointer-events-auto w-[min(360px,92vw)] rounded-2xl bg-popover p-4 text-foreground shadow-[0_0_0_1px_var(--island-ring),inset_0_1px_0_var(--island-highlight),0_24px_80px_-12px_rgb(0_0_0/0.55)]"
          initial={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.96, y: -6 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.97, y: -4, transition: { duration: 0.14, ease: ease.out } }}
          transition={reduce ? { duration: 0 } : spring.soft}
        >
          <div className="mb-3 flex items-center gap-2">
            <Star className="size-4 text-space" strokeWidth={1.75} fill="currentColor" />
            <h2 className="text-[13px] font-medium tracking-tight">{created ? 'Bookmark added' : 'Edit bookmark'}</h2>
          </div>
          <label className="mb-1 block text-[11.5px] text-muted-foreground" htmlFor="bookmark-title">
            Name
          </label>
          <input
            id="bookmark-title"
            ref={inputRef}
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            disabled={!node}
            spellCheck={false}
            autoComplete="off"
            className="mb-3 h-8 w-full rounded-lg bg-secondary px-2.5 text-[13px] text-foreground ring-1 ring-border outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
          />
          <label className="mb-1 block text-[11.5px] text-muted-foreground">Folder</label>
          <Select value={folder} onValueChange={setFolder} disabled={!node}>
            <SelectTrigger size="sm" className="mb-4 w-full rounded-lg text-[13px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="z-[120]">
              {folders.map((option) => (
                <SelectItem key={option.id} value={option.id} className="text-[13px]">
                  <span style={{ paddingLeft: option.depth * 12 }}>{option.title}</span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="flex items-center justify-between gap-2">
            <button
              type="button"
              onClick={() => {
                ui.closeBookmarkEditor();
                settle(window.vela.bookmarks.openManager());
              }}
              className="rounded-lg px-2 py-1 text-[12px] text-muted-foreground transition-colors duration-150 hover:text-foreground"
            >
              All bookmarks
            </button>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={remove}
                disabled={!node}
                className="h-7 rounded-lg px-3 text-[12px] text-muted-foreground ring-1 ring-border transition-colors duration-150 hover:bg-secondary hover:text-foreground active:scale-[0.96]"
              >
                Remove
              </button>
              <button
                type="submit"
                disabled={!node}
                className="h-7 rounded-lg bg-foreground/90 px-3 text-[12px] font-medium text-background transition-colors duration-150 hover:bg-foreground active:scale-[0.96]"
              >
                Done
              </button>
            </div>
          </div>
        </motion.form>
      </div>
    </div>
  );
}
