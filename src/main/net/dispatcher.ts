import type { Session } from 'electron';

/**
 * One webRequest pipeline per session.
 *
 * Electron keeps exactly ONE listener per webRequest event per session: a second
 * `session.webRequest.onBeforeRequest(…)` silently replaces the first. Every feature that needs a
 * blocking webRequest hook (Ghostery, extension declarativeNetRequest, privacy / identity headers)
 * therefore registers a *stage* here, and the dispatcher owns the single Electron listener and runs
 * the stages in `order` (ascending).
 *
 * Composition:
 * - beforeRequest: the first stage that cancels or redirects decides; later stages are skipped.
 * - beforeSendHeaders: every stage edits the same header object in place; a cancel stops the chain.
 * - headersReceived: every stage sees the headers left by the previous one; returned headers replace
 *   them (and are sent back only if some stage changed them); a cancel stops the chain.
 *
 * The Electron listener of an event exists only while that event has stages, so a session with
 * nothing to do (adblock off, no extension rules) pays nothing. Stages must be synchronous and
 * should be cheap: they run on the browser's UI thread for every request. A throwing stage is
 * skipped (fail open).
 */

export type BeforeRequestStage = (details: Electron.OnBeforeRequestListenerDetails) => Electron.CallbackResponse | void;
export type BeforeSendHeadersStage = (
  details: Electron.OnBeforeSendHeadersListenerDetails,
  headers: Record<string, string>,
) => { cancel?: boolean } | void;
export type HeadersReceivedStage = (
  details: Electron.OnHeadersReceivedListenerDetails,
) => Electron.HeadersReceivedResponse | void;

interface StageMap {
  beforeRequest: BeforeRequestStage;
  beforeSendHeaders: BeforeSendHeadersStage;
  headersReceived: HeadersReceivedStage;
}

export type WebRequestEvent = keyof StageMap;

/** Order of the built-in stages (lower runs first). */
export const STAGE_ORDER = {
  /** Tracking-parameter removal on main-frame navigations: redirects before anything is blocked or counted. */
  urlClean: 50,
  /** Ghostery: the browser's own blocker, runs before extensions (keeps its stats unchanged). */
  adblock: 100,
  /** DNT / GPC, client hints, fingerprint header reduction, third-party cookie stripping. */
  privacy: 100,
  /** Extension declarativeNetRequest. */
  dnr: 200,
} as const;

interface Entry<E extends WebRequestEvent> {
  name: string;
  order: number;
  fn: StageMap[E];
}

interface Pipeline {
  beforeRequest: Entry<'beforeRequest'>[];
  beforeSendHeaders: Entry<'beforeSendHeaders'>[];
  headersReceived: Entry<'headersReceived'>[];
  attached: Set<WebRequestEvent>;
}

/**
 * URL filters per event, matching what each listener used before the dispatcher existed:
 * Ghostery registered onBeforeRequest / onHeadersReceived for `<all_urls>`, privacy registered
 * onBeforeSendHeaders without a filter.
 */
const ALL_URLS: Electron.WebRequestFilter = { urls: ['<all_urls>'] };

const pipelines = new WeakMap<Session, Pipeline>();

function pipelineOf(session: Session): Pipeline {
  let pipeline = pipelines.get(session);
  if (!pipeline) {
    pipeline = { beforeRequest: [], beforeSendHeaders: [], headersReceived: [], attached: new Set() };
    pipelines.set(session, pipeline);
  }
  return pipeline;
}

function runBeforeRequest(pipeline: Pipeline, details: Electron.OnBeforeRequestListenerDetails): Electron.CallbackResponse {
  for (const stage of pipeline.beforeRequest) {
    let result: Electron.CallbackResponse | void;
    try {
      result = stage.fn(details);
    } catch (error) {
      console.error(`[net] ${stage.name} onBeforeRequest failed`, error);
      continue;
    }
    if (result && (result.cancel || result.redirectURL)) return result;
  }
  return {};
}

function runBeforeSendHeaders(pipeline: Pipeline, details: Electron.OnBeforeSendHeadersListenerDetails): Electron.BeforeSendResponse {
  const headers = details.requestHeaders;
  for (const stage of pipeline.beforeSendHeaders) {
    try {
      if (stage.fn(details, headers)?.cancel) return { cancel: true };
    } catch (error) {
      console.error(`[net] ${stage.name} onBeforeSendHeaders failed`, error);
    }
  }
  return { requestHeaders: headers };
}

function runHeadersReceived(pipeline: Pipeline, details: Electron.OnHeadersReceivedListenerDetails): Electron.HeadersReceivedResponse {
  let changed = false;
  let statusLine: string | undefined;
  for (const stage of pipeline.headersReceived) {
    let result: Electron.HeadersReceivedResponse | void;
    try {
      result = stage.fn(details);
    } catch (error) {
      console.error(`[net] ${stage.name} onHeadersReceived failed`, error);
      continue;
    }
    if (!result) continue;
    if (result.cancel) return { cancel: true };
    if (result.responseHeaders) {
      details.responseHeaders = normalizeResponseHeaders(result.responseHeaders);
      changed = true;
    }
    if (result.statusLine) statusLine = result.statusLine;
  }
  if (!changed) return {};
  return statusLine ? { responseHeaders: details.responseHeaders, statusLine } : { responseHeaders: details.responseHeaders };
}

function normalizeResponseHeaders(headers: Record<string, string | string[]>): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const [name, value] of Object.entries(headers)) out[name] = Array.isArray(value) ? value : [value];
  return out;
}

function attach(session: Session, pipeline: Pipeline, event: WebRequestEvent): void {
  const wanted = pipeline[event].length > 0;
  if (wanted === pipeline.attached.has(event)) return;
  const webRequest = session.webRequest;
  if (!wanted) {
    pipeline.attached.delete(event);
    if (event === 'beforeRequest') webRequest.onBeforeRequest(null);
    else if (event === 'beforeSendHeaders') webRequest.onBeforeSendHeaders(null);
    else webRequest.onHeadersReceived(null);
    return;
  }
  pipeline.attached.add(event);
  if (event === 'beforeRequest') {
    webRequest.onBeforeRequest(ALL_URLS, (details, callback) => callback(runBeforeRequest(pipeline, details)));
  } else if (event === 'beforeSendHeaders') {
    webRequest.onBeforeSendHeaders((details, callback) => callback(runBeforeSendHeaders(pipeline, details)));
  } else {
    webRequest.onHeadersReceived(ALL_URLS, (details, callback) => callback(runHeadersReceived(pipeline, details)));
  }
}

/**
 * Add a stage to a session's pipeline. A stage name is unique per event and session: adding the
 * same name again replaces the previous stage. Returns a function that removes it.
 */
export function addWebRequestStage<E extends WebRequestEvent>(session: Session, event: E, name: string, order: number, fn: StageMap[E]): () => void {
  const pipeline = pipelineOf(session);
  const list = pipeline[event] as Entry<E>[];
  const existing = list.findIndex((entry) => entry.name === name);
  if (existing >= 0) list.splice(existing, 1);
  const entry: Entry<E> = { name, order, fn };
  list.push(entry);
  list.sort((a, b) => a.order - b.order);
  attach(session, pipeline, event);
  return () => removeWebRequestStage(session, event, name, entry);
}

export function removeWebRequestStage(session: Session, event: WebRequestEvent, name: string, only?: Entry<WebRequestEvent>): void {
  const pipeline = pipelines.get(session);
  if (!pipeline) return;
  const list = pipeline[event] as Entry<WebRequestEvent>[];
  const index = list.findIndex((entry) => entry.name === name && (!only || entry === only));
  if (index < 0) return;
  list.splice(index, 1);
  attach(session, pipeline, event);
}

export function hasWebRequestStage(session: Session, event: WebRequestEvent, name: string): boolean {
  return pipelines.get(session)?.[event].some((entry) => entry.name === name) ?? false;
}
