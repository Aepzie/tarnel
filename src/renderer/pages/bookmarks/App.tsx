import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent, type FormEvent } from 'react';
import { MotionConfig } from 'motion/react';
import { Bookmark, ChevronRight, Download, Folder, FolderPlus, Pencil, Plus, Search, Trash2, X } from 'lucide-react';
import type { BookmarkNode } from '@shared/bookmarks';
import { BOOKMARK_ROOTS } from '@shared/bookmarks-ipc';
import { cn } from '@/lib/utils';
import { letterOf, settle, velaPages } from '@/lib/vela';

const DRAG_TYPE = 'application/x-vela-bookmark';

function childrenOf(nodes: readonly BookmarkNode[], parentId: string | null): BookmarkNode[] {
  return nodes.filter((node) => node.parentId === parentId).sort((a, b) => a.index - b.index);
}

function hostOf(url: string | undefined): string {
  if (!url) return '';
  try {
    const parsed = new URL(url);
    return parsed.host || parsed.protocol;
  } catch {
    return url;
  }
}

function pathTo(nodes: readonly BookmarkNode[], id: string): BookmarkNode[] {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const out: BookmarkNode[] = [];
  let current = byId.get(id);
  while (current) {
    out.unshift(current);
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }
  return out;
}

function useBookmarkList() {
  const [nodes, setNodes] = useState<BookmarkNode[] | null>(null);
  const [error, setError] = useState(false);
  const refresh = useCallback(() => {
    velaPages()
      .bookmarks.list()
      .then((snapshot) => {
        setNodes(snapshot.nodes);
        setError(false);
      })
      .catch(() => setError(true));
  }, []);
  useEffect(() => {
    refresh();
    const onVisible = (): void => {
      if (document.visibilityState === 'visible') refresh();
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', refresh);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', refresh);
    };
  }, [refresh]);
  const run = useCallback(
    (action: Promise<unknown>) => {
      action.catch(() => undefined).finally(refresh);
    },
    [refresh],
  );
  return { nodes, error, run };
}

type Editing = { id: string } | { newIn: string; kind: 'folder' | 'bookmark' } | null;

export function App() {
  const { nodes, error, run } = useBookmarkList();
  const [folderId, setFolderId] = useState<string>(BOOKMARK_ROOTS.bar);
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState<Editing>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    document.title = 'Bookmarks';
    const onKey = (event: KeyboardEvent): void => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f') {
        event.preventDefault();
        searchRef.current?.focus();
        searchRef.current?.select();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    if (nodes && !nodes.some((node) => node.id === folderId)) setFolderId(BOOKMARK_ROOTS.bar);
  }, [nodes, folderId]);

  const text = query.trim().toLowerCase();
  const rows = useMemo(() => {
    if (!nodes) return [];
    if (!text) return childrenOf(nodes, folderId);
    const tokens = text.split(/\s+/);
    return nodes.filter(
      (node) =>
        node.parentId !== null &&
        tokens.every((token) => node.title.toLowerCase().includes(token) || (node.url ?? '').toLowerCase().includes(token)),
    );
  }, [nodes, folderId, text]);

  const bookmarkCount = nodes ? nodes.filter((node) => node.kind === 'bookmark').length : 0;

  const moveInto = (id: string, parentId: string, index?: number): void => {
    if (id === parentId) return;
    run(velaPages().bookmarks.update(id, index === undefined ? { parentId } : { parentId, index }));
  };

  const onDropOnFolder = (event: DragEvent, parentId: string): void => {
    const id = event.dataTransfer.getData(DRAG_TYPE);
    setDropTarget(null);
    if (!id) return;
    event.preventDefault();
    moveInto(id, parentId);
  };

  const open = (url: string, newTab: boolean): void => {
    if (newTab) {
      window.open(url, '_blank');
      return;
    }
    settle(velaPages().navigate(url));
  };

  return (
    <MotionConfig reducedMotion="user">
      <div className="relative isolate min-h-screen bg-background text-foreground">
        <header className="mx-auto w-full max-w-5xl px-8 pt-10 pb-5">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <span className="grid size-9 place-items-center rounded-[11px] bg-card shadow-[inset_0_1px_0_var(--island-highlight)] ring-1 ring-border">
                <Bookmark className="size-[17px] text-space" strokeWidth={1.75} />
              </span>
              <div>
                <h1 className="text-[20px] leading-tight font-semibold tracking-tight">Bookmarks</h1>
                <p className="text-[12px] text-muted-foreground tabular-nums">
                  {nodes ? `${bookmarkCount} ${bookmarkCount === 1 ? 'bookmark' : 'bookmarks'} in this Space` : 'Loading…'}
                </p>
              </div>
            </div>
            <button type="button" onClick={() => settle(velaPages().navigate('vela://settings/#import'))} className={secondaryButton}>
              <Download className="size-[14px]" strokeWidth={1.75} />
              Import bookmarks…
            </button>
          </div>
          <label className="island mt-6 flex h-11 cursor-text items-center gap-3 rounded-full px-4">
            <Search className="size-[16px] shrink-0 text-muted-foreground" strokeWidth={1.75} />
            <input
              ref={searchRef}
              autoFocus
              value={query}
              onChange={(event) => setQuery(event.target.value.slice(0, 200))}
              placeholder="Search bookmarks"
              spellCheck={false}
              aria-label="Search bookmarks"
              className="h-full min-w-0 flex-1 bg-transparent text-[14px] tracking-tight outline-none placeholder:text-muted-foreground/70"
            />
            {query && (
              <button
                type="button"
                aria-label="Clear search"
                onClick={() => setQuery('')}
                className="grid size-6 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              >
                <X className="size-[13px]" strokeWidth={2} />
              </button>
            )}
          </label>
        </header>

        <div className="mx-auto flex w-full max-w-5xl gap-6 px-8 pb-24">
          <aside className="w-56 shrink-0" aria-label="Folders">
            {nodes && (
              <FolderTree
                nodes={nodes}
                parentId={null}
                depth={0}
                selected={text ? null : folderId}
                dropTarget={dropTarget}
                onSelect={(id) => {
                  setQuery('');
                  setFolderId(id);
                }}
                onDragTarget={setDropTarget}
                onDrop={onDropOnFolder}
              />
            )}
          </aside>

          <main className="min-w-0 flex-1">
            <div className="mb-2 flex h-8 items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-1 text-[12.5px] text-muted-foreground">
                {text ? (
                  <span>
                    {rows.length} {rows.length === 1 ? 'result' : 'results'}
                  </span>
                ) : (
                  nodes &&
                  pathTo(nodes, folderId).map((crumb, index) => (
                    <span key={crumb.id} className="flex min-w-0 items-center gap-1">
                      {index > 0 && <ChevronRight className="size-3 shrink-0 opacity-60" strokeWidth={1.75} />}
                      <button type="button" className="truncate hover:text-foreground" onClick={() => setFolderId(crumb.id)}>
                        {crumb.title}
                      </button>
                    </span>
                  ))
                )}
              </div>
              {!text && (
                <div className="flex shrink-0 items-center gap-1.5">
                  <button type="button" className={secondaryButton} onClick={() => setEditing({ newIn: folderId, kind: 'bookmark' })}>
                    <Plus className="size-[14px]" strokeWidth={1.75} />
                    Add
                  </button>
                  <button type="button" className={secondaryButton} onClick={() => setEditing({ newIn: folderId, kind: 'folder' })}>
                    <FolderPlus className="size-[14px]" strokeWidth={1.75} />
                    New folder
                  </button>
                </div>
              )}
            </div>

            <div role="list" aria-label="Bookmarks" className="rounded-2xl bg-card/60 p-1.5 ring-1 ring-border">
              {editing && 'newIn' in editing && (
                <EditRow
                  kind={editing.kind}
                  initialTitle=""
                  initialUrl=""
                  onCancel={() => setEditing(null)}
                  onSave={(title, url) => {
                    setEditing(null);
                    run(velaPages().bookmarks.add({ parentId: editing.newIn, kind: editing.kind, title, url: editing.kind === 'bookmark' ? url : undefined }));
                  }}
                />
              )}
              {error && <p className="px-3 py-8 text-center text-[13px] text-muted-foreground">Bookmarks could not be loaded.</p>}
              {nodes && rows.length === 0 && !editing && (
                <p className="px-3 py-10 text-center text-[13px] text-muted-foreground">
                  {text ? 'No bookmarks match your search.' : 'This folder is empty. Bookmark a page with Ctrl+D.'}
                </p>
              )}
              {rows.map((node, index) =>
                editing && 'id' in editing && editing.id === node.id ? (
                  <EditRow
                    key={node.id}
                    kind={node.kind}
                    initialTitle={node.title}
                    initialUrl={node.url ?? ''}
                    onCancel={() => setEditing(null)}
                    onSave={(title, url) => {
                      setEditing(null);
                      run(velaPages().bookmarks.update(node.id, node.kind === 'bookmark' ? { title, url } : { title }));
                    }}
                  />
                ) : (
                  <Row
                    key={node.id}
                    node={node}
                    location={text && nodes ? pathTo(nodes, node.parentId ?? '').map((crumb) => crumb.title).join(' / ') : null}
                    dropActive={dropTarget === node.id}
                    draggable={!text}
                    onOpen={(newTab) => {
                      if (node.kind === 'folder') {
                        setQuery('');
                        setFolderId(node.id);
                      } else if (node.url) open(node.url, newTab);
                    }}
                    onEdit={() => setEditing({ id: node.id })}
                    onDelete={() => run(velaPages().bookmarks.remove(node.id))}
                    onDragTarget={setDropTarget}
                    onDropRow={(event, after) => {
                      const id = event.dataTransfer.getData(DRAG_TYPE);
                      setDropTarget(null);
                      if (!id || id === node.id) return;
                      event.preventDefault();
                      if (node.kind === 'folder' && !after) {
                        moveInto(id, node.id);
                        return;
                      }
                      moveInto(id, node.parentId ?? folderId, after ? index + 1 : index);
                    }}
                  />
                ),
              )}
            </div>
          </main>
        </div>
      </div>
    </MotionConfig>
  );
}

const secondaryButton = cn(
  'inline-flex h-8 items-center gap-2 rounded-[10px] px-3 text-[12.5px] font-medium text-muted-foreground',
  'ring-1 ring-border transition-[background-color,color,transform] duration-150 outline-none',
  'hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.96]',
);

interface FolderTreeProps {
  nodes: readonly BookmarkNode[];
  parentId: string | null;
  depth: number;
  selected: string | null;
  dropTarget: string | null;
  onSelect: (id: string) => void;
  onDragTarget: (id: string | null) => void;
  onDrop: (event: DragEvent, folderId: string) => void;
}

function FolderTree({ nodes, parentId, depth, selected, dropTarget, onSelect, onDragTarget, onDrop }: FolderTreeProps) {
  const folders = childrenOf(nodes, parentId).filter((node) => node.kind === 'folder');
  if (folders.length === 0) return null;
  return (
    <ul className="flex flex-col gap-0.5">
      {folders.map((folder) => (
        <li key={folder.id}>
          <button
            type="button"
            onClick={() => onSelect(folder.id)}
            onDragOver={(event) => {
              if (!event.dataTransfer.types.includes(DRAG_TYPE)) return;
              event.preventDefault();
              onDragTarget(`tree:${folder.id}`);
            }}
            onDragLeave={() => onDragTarget(null)}
            onDrop={(event) => onDrop(event, folder.id)}
            style={{ paddingLeft: 10 + depth * 14 }}
            className={cn(
              'flex h-8 w-full items-center gap-2 rounded-[8px] pr-2 text-left text-[13px] transition-colors duration-150',
              selected === folder.id ? 'bg-foreground/[0.07] text-foreground' : 'text-muted-foreground hover:bg-foreground/[0.04] hover:text-foreground',
              dropTarget === `tree:${folder.id}` && 'ring-1 ring-space/60',
            )}
          >
            <Folder className={cn('size-[15px] shrink-0', selected === folder.id && 'text-space')} strokeWidth={1.75} />
            <span className="truncate">{folder.title}</span>
          </button>
          <FolderTree
            nodes={nodes}
            parentId={folder.id}
            depth={depth + 1}
            selected={selected}
            dropTarget={dropTarget}
            onSelect={onSelect}
            onDragTarget={onDragTarget}
            onDrop={onDrop}
          />
        </li>
      ))}
    </ul>
  );
}

interface RowProps {
  node: BookmarkNode;
  location: string | null;
  dropActive: boolean;
  draggable: boolean;
  onOpen: (newTab: boolean) => void;
  onEdit: () => void;
  onDelete: () => void;
  onDragTarget: (id: string | null) => void;
  onDropRow: (event: DragEvent, after: boolean) => void;
}

function Row({ node, location, dropActive, draggable, onOpen, onEdit, onDelete, onDragTarget, onDropRow }: RowProps) {
  const [edge, setEdge] = useState<'before' | 'after' | 'inside' | null>(null);
  const zone = (event: DragEvent<HTMLElement>): 'before' | 'after' | 'inside' => {
    const rect = event.currentTarget.getBoundingClientRect();
    const ratio = (event.clientY - rect.top) / rect.height;
    if (node.kind === 'folder' && ratio > 0.25 && ratio < 0.75) return 'inside';
    return ratio < 0.5 ? 'before' : 'after';
  };
  return (
    <div
      role="listitem"
      draggable={draggable}
      onDragStart={(event) => {
        event.dataTransfer.setData(DRAG_TYPE, node.id);
        event.dataTransfer.effectAllowed = 'move';
      }}
      onDragOver={(event) => {
        if (!draggable || !event.dataTransfer.types.includes(DRAG_TYPE)) return;
        event.preventDefault();
        setEdge(zone(event));
        onDragTarget(node.id);
      }}
      onDragLeave={() => setEdge(null)}
      onDrop={(event) => {
        const where = zone(event);
        setEdge(null);
        onDropRow(event, where === 'after');
      }}
      onClick={(event) => onOpen(event.ctrlKey || event.metaKey)}
      onAuxClick={(event) => {
        if (event.button === 1) onOpen(true);
      }}
      className={cn(
        'group relative flex h-10 cursor-default items-center gap-3 rounded-[10px] px-2.5 transition-colors duration-150 hover:bg-foreground/[0.045]',
        dropActive && edge === 'inside' && 'bg-space/10 ring-1 ring-space/40',
      )}
    >
      {dropActive && edge === 'before' && <span aria-hidden className="absolute inset-x-2 -top-px h-0.5 rounded-full bg-space" />}
      {dropActive && edge === 'after' && <span aria-hidden className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-space" />}
      {node.kind === 'folder' ? (
        <Folder className="size-4 shrink-0 text-muted-foreground" strokeWidth={1.75} />
      ) : (
        <span className="grid size-5 shrink-0 place-items-center rounded-[5px] bg-secondary text-[10px] font-semibold text-muted-foreground ring-1 ring-border">
          {letterOf(node.url ?? '', node.title)}
        </span>
      )}
      <span className="flex min-w-0 flex-1 items-baseline gap-2.5">
        <span className="max-w-[60%] shrink-0 truncate text-[13px] font-medium tracking-tight">{node.title}</span>
        <span className="min-w-0 truncate text-[12px] text-muted-foreground/80">{location ?? hostOf(node.url)}</span>
      </span>
      <span className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity duration-150 group-focus-within:opacity-100 group-hover:opacity-100">
        <IconButton label="Edit" onClick={onEdit}>
          <Pencil className="size-[13px]" strokeWidth={1.75} />
        </IconButton>
        <IconButton label="Delete" onClick={onDelete}>
          <Trash2 className="size-[13px]" strokeWidth={1.75} />
        </IconButton>
      </span>
    </div>
  );
}

function IconButton({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
      className="grid size-7 place-items-center rounded-[8px] text-muted-foreground transition-colors duration-150 outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
    >
      {children}
    </button>
  );
}

interface EditRowProps {
  kind: 'folder' | 'bookmark';
  initialTitle: string;
  initialUrl: string;
  onSave: (title: string, url: string) => void;
  onCancel: () => void;
}

function EditRow({ kind, initialTitle, initialUrl, onSave, onCancel }: EditRowProps) {
  const [title, setTitle] = useState(initialTitle);
  const [url, setUrl] = useState(initialUrl);
  const [invalid, setInvalid] = useState(false);
  const submit = (event: FormEvent): void => {
    event.preventDefault();
    if (kind === 'bookmark') {
      const candidate = /^[a-z][a-z0-9+.-]*:/i.test(url.trim()) ? url.trim() : `https://${url.trim()}`;
      try {
        new URL(candidate);
      } catch {
        setInvalid(true);
        return;
      }
      onSave(title.trim() || candidate, candidate);
      return;
    }
    onSave(title.trim() || 'New folder', '');
  };
  const field = 'h-8 min-w-0 rounded-lg bg-secondary px-2.5 text-[13px] ring-1 ring-border outline-none focus-visible:ring-2 focus-visible:ring-ring';
  return (
    <form
      onSubmit={submit}
      onKeyDown={(event) => {
        if (event.key === 'Escape') onCancel();
      }}
      className="flex items-center gap-2 rounded-[10px] bg-foreground/[0.04] p-1.5"
    >
      <input autoFocus value={title} onChange={(event) => setTitle(event.target.value)} placeholder={kind === 'folder' ? 'Folder name' : 'Name'} aria-label="Name" className={cn(field, 'flex-1')} />
      {kind === 'bookmark' && (
        <input
          value={url}
          onChange={(event) => {
            setUrl(event.target.value);
            setInvalid(false);
          }}
          placeholder="https://"
          aria-label="URL"
          aria-invalid={invalid}
          spellCheck={false}
          className={cn(field, 'flex-[1.4]', invalid && 'ring-destructive/70')}
        />
      )}
      <button type="submit" className="h-8 rounded-lg bg-foreground/90 px-3 text-[12px] font-medium text-background transition-colors hover:bg-foreground">
        Save
      </button>
      <button type="button" onClick={onCancel} className="h-8 rounded-lg px-2.5 text-[12px] text-muted-foreground hover:text-foreground">
        Cancel
      </button>
    </form>
  );
}
