import { Menu, clipboard, type MenuItemConstructorOptions, type WebContents } from 'electron';
import { getSettings } from './settings';
import { getSpace, listSpaces } from './spaces';
import { createTab, getTabSpaceId } from './tabs';
import { isOpenableFromWeb, searchUrl } from './url';
import { getMainWindow } from './window';

function truncate(text: string, max: number): string {
  const single = text.replace(/\s+/g, ' ').trim();
  return single.length > max ? `${single.slice(0, max - 1)}…` : single;
}

export function attachContextMenu(wc: WebContents, tabId: number): void {
  wc.on('context-menu', (_event, params) => {
    const spaceId = getTabSpaceId(tabId) ?? undefined;
    const template: MenuItemConstructorOptions[] = [];
    const separator = (): void => {
      if (template.length > 0 && template[template.length - 1]?.type !== 'separator') template.push({ type: 'separator' });
    };

    const link = params.linkURL && isOpenableFromWeb(params.linkURL) ? params.linkURL : '';
    if (link) {
      template.push(
        { label: 'Open link in new tab', click: () => createTab({ url: link, spaceId, active: false, afterId: tabId }) },
        {
          label: 'Open link in Space',
          submenu: listSpaces()
            .filter((space) => space.id !== spaceId)
            .map((space) => ({
              label: space.ephemeral ? `${space.name} (burner)` : space.name,
              click: () => {
                if (getSpace(space.id)) createTab({ url: link, spaceId: space.id, active: false });
              },
            })),
        },
        { label: 'Copy link address', click: () => clipboard.writeText(link) },
      );
    }

    if (params.mediaType === 'image' && params.srcURL) {
      separator();
      const src = params.srcURL;
      if (isOpenableFromWeb(src)) {
        template.push({ label: 'Open image in new tab', click: () => createTab({ url: src, spaceId, active: false, afterId: tabId }) });
      }
      template.push(
        { label: 'Copy image', click: () => wc.copyImageAt(params.x, params.y) },
        { label: 'Save image', click: () => wc.downloadURL(src) },
      );
    }

    if (params.isEditable) {
      separator();
      template.push(
        { label: 'Cut', role: 'cut', enabled: params.editFlags.canCut },
        { label: 'Copy', role: 'copy', enabled: params.editFlags.canCopy },
        { label: 'Paste', role: 'paste', enabled: params.editFlags.canPaste },
        { label: 'Select all', role: 'selectAll', enabled: params.editFlags.canSelectAll },
      );
    } else if (params.selectionText.trim()) {
      separator();
      const selection = params.selectionText.trim().slice(0, 500);
      template.push(
        { label: 'Copy', role: 'copy' },
        {
          label: `Search "${truncate(selection, 24)}"`,
          click: () => createTab({ url: searchUrl(selection, getSettings().searchEngine), spaceId, active: true, afterId: tabId }),
        },
      );
    }

    if (!link && params.mediaType === 'none' && !params.isEditable && !params.selectionText.trim()) {
      const history = wc.navigationHistory;
      template.push(
        { label: 'Back', enabled: history.canGoBack(), click: () => history.goBack() },
        { label: 'Forward', enabled: history.canGoForward(), click: () => history.goForward() },
        { label: 'Reload', click: () => wc.reload() },
      );
    }

    separator();
    template.push({ label: 'Inspect element', click: () => wc.inspectElement(params.x, params.y) });

    const win = getMainWindow();
    Menu.buildFromTemplate(template).popup(win ? { window: win } : {});
  });
}
