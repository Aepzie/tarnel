import { Languages } from 'lucide-react';
import type { BrowserState } from '@shared/types';
import { languageName } from '@shared/translate';
import type { PaletteCommand } from '../palette/commands';
import { toggleTranslation, translateStateOf } from './translate-store';

export function translateCommands(state: BrowserState): PaletteCommand[] {
  const tabId = state.activeTabId;
  if (tabId === null) return [];
  const current = translateStateOf(tabId);
  const translated = current?.phase === 'translated';
  return [
    {
      id: 'cmd:translate',
      title: translated ? 'Show original page' : 'Translate page',
      icon: Languages,
      keywords: 'translate translation language übersetzen sprache german english on-device offline',
      hint: current ? `→ ${languageName(current.targetLang)}` : 'On device',
      active: translated,
      run: () => toggleTranslation(tabId),
    },
  ];
}
