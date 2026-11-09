import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { SpaceId, TabGroup, TabGroupId, TabState } from '@shared/types';
import { vela } from '@/lib/vela';
import { buildUnits, groupKey, orderUnits, resolveDrop, type Unit, type UnitKey } from './units';

const noop = (): void => {};
/** Keep the local order this long after a drop so main's reordered state lands before we hand back. */
const SETTLE_MS = 160;

export interface UnitDrag {
  units: Unit[];
  onReorder: (keys: UnitKey[]) => void;
  onTabDragStart: (id: number) => void;
  onTabDragEnd: (id: number) => void;
  onGroupDragStart: (groupId: TabGroupId) => void;
  onGroupDragEnd: (groupId: TabGroupId) => void;
}

/**
 * Drag & drop of unpinned tabs and groups over one motion `Reorder.Group`, shared by the
 * horizontal strip and the vertical list. Holds a local order while dragging; dragging a group
 * header folds its tabs into the header; the drop is translated into one main-process move.
 */
export function useUnitDrag(tabs: TabState[], groups: TabGroup[], activeTabId: number | null, spaceId: SpaceId): UnitDrag {
  const [keys, setKeys] = useState<UnitKey[] | null>(null);
  const [folded, setFolded] = useState<TabGroupId | null>(null);
  const dragging = useRef(false);
  const draggedTab = useRef<number | null>(null);

  const units = useMemo(
    () => orderUnits(buildUnits(tabs, groups, activeTabId, folded), keys),
    [tabs, groups, activeTabId, folded, keys],
  );
  const latest = useRef({ units, tabs });
  latest.current = { units, tabs };

  useEffect(() => {
    if (dragging.current && draggedTab.current !== null && !tabs.some((tab) => tab.id === draggedTab.current)) {
      dragging.current = false;
      draggedTab.current = null;
    }
    if (!dragging.current) setKeys(null);
  }, [tabs]);

  useEffect(() => {
    dragging.current = false;
    draggedTab.current = null;
    setKeys(null);
    setFolded(null);
  }, [spaceId]);

  const finish = useCallback((move: Promise<unknown>) => {
    dragging.current = false;
    draggedTab.current = null;
    void move.catch(noop).finally(() =>
      window.setTimeout(() => {
        if (dragging.current) return;
        setKeys(null);
        setFolded(null);
      }, SETTLE_MS),
    );
  }, []);

  const onTabDragStart = useCallback((id: number) => {
    dragging.current = true;
    draggedTab.current = id;
  }, []);

  const onTabDragEnd = useCallback(
    (id: number) => {
      const { units: current, tabs: all } = latest.current;
      const drop = resolveDrop(current.map((unit) => unit.key), id, all);
      finish(drop?.kind === 'tab' ? vela().groups.placeTab(drop.tabId, drop.before, drop.groupId) : Promise.resolve());
    },
    [finish],
  );

  const onGroupDragStart = useCallback((groupId: TabGroupId) => {
    dragging.current = true;
    setFolded(groupId);
  }, []);

  const onGroupDragEnd = useCallback(
    (groupId: TabGroupId) => {
      const { units: current, tabs: all } = latest.current;
      const drop = resolveDrop(current.map((unit) => unit.key), groupKey(groupId), all);
      finish(drop?.kind === 'group' ? vela().groups.move(drop.groupId, drop.before) : Promise.resolve());
    },
    [finish],
  );

  return { units, onReorder: setKeys, onTabDragStart, onTabDragEnd, onGroupDragStart, onGroupDragEnd };
}
