import { useEffect } from 'react';
import { AnimatePresence } from 'motion/react';
import { useBrowserSlice } from '@/hooks/browser';
import { SplitDropZones } from './SplitDropZones';
import { SplitPanes } from './SplitPanes';
import { noteActiveTab, useActiveSplit, useSplitDrag } from './split-state';

/** Everything split view draws inside `#viewport`. Renders nothing while no split is on screen and no tab is dragged. */
export function SplitLayer() {
  const split = useActiveSplit();
  const activeTabId = useBrowserSlice((s) => s.activeTabId);
  const drag = useSplitDrag();

  useEffect(() => noteActiveTab(activeTabId), [activeTabId]);

  return (
    <>
      {split && activeTabId !== null && <SplitPanes split={split} focusedId={activeTabId} />}
      <AnimatePresence>{drag.tabId !== null && <SplitDropZones key="drop" tabId={drag.tabId} side={drag.side} />}</AnimatePresence>
    </>
  );
}
