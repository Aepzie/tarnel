import { ipcRenderer, webFrame } from 'electron';
import AutoConsent, { evalSnippets, type BackgroundMessage, type ContentScriptMessage } from '@duckduckgo/autoconsent';
import { COOKIE_BANNER_IPC } from '../shared/cookie-banners';

/**
 * Session preload for cookie banner auto-reject (src/main/cookie-banners). Runs in every web
 * frame, in the preload's isolated world, so page scripts can neither see nor patch it. It asks
 * main once for rules (main says null when the feature is off or the site is an exception — then
 * nothing else happens), lets autoconsent detect the CMP and opt out, and reports the result.
 *
 * Rules that need page state ("eval" steps) run one of autoconsent's bundled snippets in the
 * page's main world; arbitrary code from the message is never evaluated.
 */

type SnippetId = keyof typeof evalSnippets;

const isWebFrame = location.protocol === 'https:' || location.protocol === 'http:';

function runSnippet(snippetId: string | undefined): Promise<unknown> {
  if (!snippetId || !Object.hasOwn(evalSnippets, snippetId)) return Promise.resolve(false);
  const source = evalSnippets[snippetId as SnippetId].toString();
  return webFrame.executeJavaScript(`(${source})()`).catch(() => false);
}

function start(): void {
  let consent: AutoConsent | null = null;
  const reply = (message: BackgroundMessage): void => {
    void consent?.receiveMessageCallback(message);
  };

  const send = async (message: ContentScriptMessage): Promise<void> => {
    switch (message.type) {
      case 'init': {
        const answer = (await ipcRenderer.invoke(COOKIE_BANNER_IPC.frameInit).catch(() => null)) as Omit<Extract<BackgroundMessage, { type: 'initResp' }>, 'type'> | null;
        if (!answer) return;
        reply({ type: 'initResp', config: answer.config, rules: answer.rules });
        return;
      }
      case 'eval': {
        const result = await runSnippet(message.snippetId);
        reply({ type: 'evalResp', id: message.id, result });
        return;
      }
      case 'autoconsentDone':
        ipcRenderer.send(COOKIE_BANNER_IPC.frameDone, { cmp: message.cmp, cosmetic: message.isCosmetic });
        return;
      default:
        return;
    }
  };

  consent = new AutoConsent(send);
}

if (isWebFrame) {
  try {
    start();
  } catch {
    /* never break the page */
  }
}
