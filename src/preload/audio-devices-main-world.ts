import type { MediaRoute } from '../shared/audio-devices';

/**
 * Routes one frame's audio to the devices picked for its tab. Runs in the page's MAIN world — via
 * contextBridge.executeInMainWorld from the session preload (new documents, before page scripts) or
 * via WebFrameMain.executeJavaScript from main (documents already loaded when the choice changes) —
 * so it is serialized with Function.prototype.toString and must be fully self-contained.
 *
 * Calling it again in the same realm only swaps the route. An empty route on a realm that was never
 * routed installs nothing.
 *
 * Device ids are salted per origin, so devices are matched by label (+ ordinal among identical
 * labels) against this realm's own enumerateDevices(); generic labels (strict fingerprint
 * protection) fall back to the device's position.
 *
 * Output: every media element (play() and the document's `play` event, also detached `new Audio()`)
 * and every AudioContext (first `destination` read) gets setSinkId(chosen). A page that picks a
 * specific sink itself keeps it; a page asking for the default ('' / 'default') gets the tab's choice.
 * Input: getUserMedia audio / video constraints without a page-chosen device get
 * `deviceId: { exact }` of the chosen microphone / camera; enumerateDevices lists the chosen devices
 * first. Capture still goes through the browser's permission prompt.
 */
export function routeMediaDevices(route: MediaRoute): void {
  type Slot = 'output' | 'input' | 'camera';
  type Method = (this: unknown, ...args: unknown[]) => unknown;
  type Getter = (this: unknown) => unknown;
  type Sinkable = object;
  type Updater = (next: MediaRoute) => void;

  const KEY = Symbol.for('vela.media-route');
  const host = globalThis as unknown as Record<symbol, Updater | undefined>;
  const installed = host[KEY];
  if (installed) {
    installed(route);
    return;
  }
  if (!route.output && !route.input && !route.camera) return;

  const realm = globalThis;
  const apply = Reflect.apply;
  const defineProperty = Object.defineProperty;
  const getDescriptor = Object.getOwnPropertyDescriptor;
  const media = realm.navigator?.mediaDevices;
  const MediaDevicesClass = realm.MediaDevices;
  // Insecure contexts have neither mediaDevices nor setSinkId: nothing to route.
  if (!media || !MediaDevicesClass) return;

  const KIND: Record<Slot, string> = { output: 'audiooutput', input: 'audioinput', camera: 'videoinput' };
  const VIRTUAL = new Set(['', 'default', 'communications']);
  /** What a page passes when it wants "the default device" — the tab's choice then wins. */
  const DEFAULTS = new Set(['', 'default']);
  const GENERIC = new Set(['', 'Speakers', 'Microphone', 'Camera']);
  const noop = (): void => undefined;

  const nativeToString = realm.Function.prototype.toString;
  const sources = new WeakMap<object, string>();
  const disguise = <T extends Method | Getter>(fake: T, real: Method | Getter): T => {
    defineProperty(fake, 'name', { value: real.name, configurable: true });
    defineProperty(fake, 'length', { value: real.length, configurable: true });
    sources.set(fake, apply(nativeToString, real, []) as string);
    return fake;
  };
  /** Method-shorthand fakes have no `prototype`, like native methods. */
  const wrapMethod = (proto: object | undefined, name: string, make: (original: Method) => Method): Method | undefined => {
    const descriptor = proto ? getDescriptor(proto, name) : undefined;
    if (!proto || !descriptor || typeof descriptor.value !== 'function') return undefined;
    const original = descriptor.value as Method;
    const impl = make(original);
    const fake = ({
      [name](this: unknown, ...args: unknown[]): unknown {
        return apply(impl, this, args);
      },
    })[name]!;
    defineProperty(proto, name, { ...descriptor, value: disguise(fake, original) });
    return original;
  };
  const wrapGetter = (proto: object | undefined, name: string, make: (original: Getter) => Getter): void => {
    const descriptor = proto ? getDescriptor(proto, name) : undefined;
    if (!proto || !descriptor || typeof descriptor.get !== 'function') return;
    const original = descriptor.get as Getter;
    const impl = make(original);
    const fake = getDescriptor(
      {
        get [name](): unknown {
          return apply(impl, this, []);
        },
      },
      name,
    )!.get as Getter;
    defineProperty(proto, name, { ...descriptor, get: disguise(fake, original) });
  };
  const getterOf = (proto: object | undefined, name: string): Getter | undefined =>
    proto ? (getDescriptor(proto, name)?.get as Getter | undefined) : undefined;

  wrapMethod(realm.Function.prototype, 'toString', (original) =>
    function (this: unknown, ...args: unknown[]) {
      const known = typeof this === 'function' ? sources.get(this) : undefined;
      return known ?? apply(original, this, args);
    },
  );

  const infoProto = realm.MediaDeviceInfo?.prototype;
  const readKind = getterOf(infoProto, 'kind');
  const readLabel = getterOf(infoProto, 'label');
  const readId = getterOf(infoProto, 'deviceId');
  const read = (getter: Getter | undefined, device: unknown): string => (getter ? String(apply(getter, device, [])) : '');
  const enumerate = MediaDevicesClass.prototype.enumerateDevices as unknown as Method;

  let current: MediaRoute = route;
  const resolved = new Map<Slot, Promise<string | null>>();

  const findDevice = (devices: readonly unknown[], slot: Slot): unknown => {
    const choice = current[slot];
    if (!choice) return undefined;
    const real = devices.filter((device) => read(readKind, device) === KIND[slot] && !VIRTUAL.has(read(readId, device)));
    const named = real.filter((device) => read(readLabel, device) === choice.label);
    if (named.length > 0) return named[choice.ordinal] ?? named[0];
    if (real.every((device) => GENERIC.has(read(readLabel, device)))) return real[choice.index];
    return undefined;
  };

  /** This realm's (salted) id of the slot's chosen device; null when absent or not exposed to the page. */
  const resolve = (slot: Slot): Promise<string | null> => {
    const cached = resolved.get(slot);
    if (cached) return cached;
    const pending = (apply(enumerate, media, []) as Promise<unknown[]>).then(
      (devices) => {
        const device = findDevice(devices, slot);
        return device === undefined ? null : read(readId, device);
      },
      () => null,
    );
    resolved.set(slot, pending);
    return pending;
  };

  // ---- output -------------------------------------------------------------

  const mediaProto = realm.HTMLMediaElement?.prototype;
  const contextClass = realm.AudioContext;
  const contextProto = contextClass?.prototype;
  const elementSinkId = getterOf(mediaProto, 'sinkId');
  const contextSinkId = getterOf(contextProto, 'sinkId');
  const elementSetSink = mediaProto ? (getDescriptor(mediaProto, 'setSinkId')?.value as Method | undefined) : undefined;
  const contextSetSink = contextProto ? (getDescriptor(contextProto, 'setSinkId')?.value as Method | undefined) : undefined;

  /** Everything ever routed in this realm (weakly held), and what the page pinned itself. */
  const targets = new Set<WeakRef<Sinkable>>();
  const seen = new WeakSet<Sinkable>();
  const pageSinks = new WeakSet<Sinkable>();
  /** Sink a target is being switched to (setSinkId is async; a second call would abort the first). */
  const switching = new WeakMap<Sinkable, string>();
  let sink = '';

  const isContext = (target: Sinkable): boolean => !!contextClass && target instanceof contextClass;
  const sinkOf = (target: Sinkable): unknown => {
    const getter = isContext(target) ? contextSinkId : elementSinkId;
    return getter ? apply(getter, target, []) : '';
  };
  const setSink = (target: Sinkable, id: string): Promise<unknown> => {
    const method = isContext(target) ? contextSetSink : elementSetSink;
    if (!method) return Promise.resolve();
    try {
      return Promise.resolve(apply(method, target, [id]));
    } catch (error) {
      return Promise.reject(error);
    }
  };

  const steer = (target: Sinkable): void => {
    if (!seen.has(target)) {
      seen.add(target);
      targets.add(new WeakRef(target));
      const initial = sinkOf(target);
      // A sink set before routing was installed (live injection, new AudioContext({ sinkId })) is the page's.
      if (initial !== '' && initial !== sink) pageSinks.add(target);
    }
    if (pageSinks.has(target)) return;
    const now = sinkOf(target);
    if (typeof now !== 'string' || now === sink || switching.get(target) === sink) return;
    const wanted = sink;
    switching.set(target, wanted);
    setSink(target, wanted).then(
      () => {
        if (switching.get(target) === wanted) switching.delete(target);
      },
      (error: unknown) => {
        if (switching.get(target) !== wanted) return;
        switching.delete(target);
        // The chosen device is gone: play on the default instead of going silent.
        if (wanted && (error as { name?: string } | null)?.name === 'NotFoundError') setSink(target, '').catch(noop);
      },
    );
  };

  const steerAll = (): void => {
    for (const ref of targets) {
      const target = ref.deref();
      if (target) steer(target);
      else targets.delete(ref);
    }
    try {
      for (const element of realm.document?.querySelectorAll('audio, video') ?? []) steer(element);
    } catch {
      /* document being replaced */
    }
  };

  let generation = 0;
  const refreshOutput = (): void => {
    const run = ++generation;
    const pending = current.output ? resolve('output') : Promise.resolve(null);
    void pending.then((id) => {
      if (run !== generation) return;
      sink = id ?? '';
      steerAll();
    });
  };

  if (mediaProto) {
    wrapMethod(mediaProto, 'play', (original) =>
      function (this: unknown, ...args: unknown[]) {
        try {
          steer(this as Sinkable);
        } catch {
          /* never break playback */
        }
        return apply(original, this, args);
      },
    );
  }

  const pageSetSink = (original: Method): Method =>
    function (this: unknown, ...args: unknown[]) {
      const target = this as Sinkable;
      const requested = args[0];
      if (typeof requested === 'string' && DEFAULTS.has(requested)) {
        if (!seen.has(target)) {
          seen.add(target);
          targets.add(new WeakRef(target));
        }
        pageSinks.delete(target);
        return apply(original, this, [sink]);
      }
      pageSinks.add(target);
      return apply(original, this, args);
    };
  wrapMethod(mediaProto, 'setSinkId', pageSetSink);
  wrapMethod(contextProto, 'setSinkId', pageSetSink);

  wrapGetter(realm.BaseAudioContext?.prototype, 'destination', (original) =>
    function (this: unknown) {
      const node = apply(original, this, []);
      try {
        if (contextClass && this instanceof contextClass) steer(this);
      } catch {
        /* never break the graph */
      }
      return node;
    },
  );

  try {
    realm.document?.addEventListener(
      'play',
      (event) => {
        const target = event.target;
        if (mediaProto && target instanceof realm.HTMLMediaElement) steer(target);
      },
      true,
    );
  } catch {
    /* no document */
  }

  // ---- cross-origin iframes -------------------------------------------------

  /**
   * Chromium only exposes device ids (and AudioContext.setSinkId) to a cross-origin iframe whose
   * container delegates `microphone` and `speaker-selection`, and it reads the delegation when the
   * frame's navigation starts. Script-inserted iframes are delegated before insertion; parser- and
   * innerHTML-inserted ones are delegated right after insertion and re-inserted in the same
   * microtask, before their first document can commit. Capture stays denied in subframes (main only
   * prompts for top frames), so this exposes nothing beyond the device list.
   */
  const DELEGATED = ['microphone', 'speaker-selection'];
  const frameClass = realm.HTMLIFrameElement;
  const nativeGetAttribute = realm.Element.prototype.getAttribute;
  const nativeSetAttribute = realm.Element.prototype.setAttribute;
  const nativeInsertBefore = realm.Node.prototype.insertBefore;
  const attribute = (element: Element, name: string): string | null => apply(nativeGetAttribute, element, [name]) as string | null;

  const delegate = (frame: HTMLIFrameElement, renavigate: boolean): void => {
    if (!current.output) return;
    const src = attribute(frame, 'src');
    if (!src) return;
    let url: URL;
    try {
      url = new URL(src, realm.document.baseURI);
    } catch {
      return;
    }
    if ((url.protocol !== 'http:' && url.protocol !== 'https:') || url.origin === realm.location.origin) return;
    const allow = attribute(frame, 'allow') ?? '';
    const declared = allow.split(';').map((entry) => entry.trim().split(/\s+/)[0]);
    const missing = DELEGATED.filter((feature) => !declared.includes(feature));
    if (missing.length === 0) return;
    apply(nativeSetAttribute, frame, ['allow', [allow.trim().replace(/;$/, ''), ...missing].filter(Boolean).join('; ')]);
    // Re-inserting recreates the frame with the delegation (a same-URL `src` reset is ignored while
    // the first navigation is still pending).
    const parent = frame.parentNode;
    if (renavigate && parent) apply(nativeInsertBefore, parent, [frame, frame.nextSibling]);
  };

  const framesIn = (node: unknown): HTMLIFrameElement[] => {
    if (!frameClass) return [];
    if (node instanceof frameClass) return [node];
    if (node instanceof realm.Element || node instanceof realm.DocumentFragment) {
      return node.firstElementChild ? [...node.querySelectorAll('iframe')] : [];
    }
    return [];
  };

  const delegateAll = (renavigate: boolean, nodes: Iterable<unknown>): void => {
    for (const node of nodes) for (const frame of framesIn(node)) delegate(frame, renavigate);
  };

  if (frameClass) {
    const beforeInsert = (original: Method): Method =>
      function (this: unknown, ...args: unknown[]) {
        try {
          if (current.output) delegateAll(false, args);
        } catch {
          /* never break insertion */
        }
        return apply(original, this, args);
      };
    for (const name of ['appendChild', 'insertBefore', 'replaceChild']) wrapMethod(realm.Node.prototype, name, beforeInsert);
    for (const name of ['append', 'prepend', 'after', 'before', 'replaceWith', 'insertAdjacentElement']) wrapMethod(realm.Element.prototype, name, beforeInsert);
    for (const name of ['append', 'prepend']) wrapMethod(realm.DocumentFragment.prototype, name, beforeInsert);
    try {
      new realm.MutationObserver((records) => {
        if (!current.output) return;
        for (const record of records) delegateAll(true, record.addedNodes);
      }).observe(realm.document, { childList: true, subtree: true });
    } catch {
      /* no document */
    }
  }

  // ---- input --------------------------------------------------------------

  /** A constraint naming a specific (non-default) device is the page's own choice and is kept. */
  const pageChoseDevice = (constraint: unknown): boolean => {
    if (!constraint || typeof constraint !== 'object') return false;
    const id = (constraint as { deviceId?: unknown }).deviceId;
    if (id === undefined || id === null) return false;
    const values =
      typeof id === 'string' || Array.isArray(id)
        ? [id].flat()
        : [(id as { exact?: unknown }).exact, (id as { ideal?: unknown }).ideal].flat().filter((value) => value !== undefined);
    return values.some((value) => !DEFAULTS.has(String(value)));
  };

  const steerConstraint = async (constraint: unknown, slot: Slot): Promise<unknown> => {
    if (!constraint || !current[slot] || pageChoseDevice(constraint)) return constraint;
    const id = await resolve(slot);
    if (!id) return constraint;
    return { ...(typeof constraint === 'object' ? constraint : {}), deviceId: { exact: id } };
  };

  const RETRYABLE = new Set(['OverconstrainedError', 'NotFoundError', 'NotReadableError']);
  wrapMethod(MediaDevicesClass.prototype, 'getUserMedia', (original) =>
    function (this: unknown, ...args: unknown[]) {
      const constraints = args[0] as MediaStreamConstraints | undefined;
      if ((!current.input && !current.camera) || !constraints || typeof constraints !== 'object') return apply(original, this, args);
      const self = this;
      return (async () => {
        const audio = await steerConstraint(constraints.audio, 'input');
        const video = await steerConstraint(constraints.video, 'camera');
        if (audio === constraints.audio && video === constraints.video) return apply(original, self, args);
        try {
          return await (apply(original, self, [{ ...constraints, audio, video }]) as Promise<MediaStream>);
        } catch (error) {
          // The chosen device vanished or is busy: fall back to what the page asked for.
          if (RETRYABLE.has((error as { name?: string } | null)?.name ?? '')) return apply(original, self, args);
          throw error;
        }
      })();
    },
  );

  wrapMethod(MediaDevicesClass.prototype, 'enumerateDevices', (original) =>
    function (this: unknown, ...args: unknown[]) {
      const listed = apply(original, this, args) as Promise<unknown[]>;
      if (!current.input && !current.camera && !current.output) return listed;
      return listed.then((devices) => {
        const first: unknown[] = (['output', 'input', 'camera'] as const).map((slot) => findDevice(devices, slot)).filter((device) => device !== undefined);
        if (first.length === 0) return devices;
        return [...first, ...devices.filter((device) => !first.includes(device))];
      });
    },
  );

  const addListener = realm.EventTarget.prototype.addEventListener;
  apply(addListener, media, [
    'devicechange',
    () => {
      resolved.clear();
      refreshOutput();
    },
  ]);

  /** Frames already on the page keep their policy until they navigate again: only tag them. */
  const update = (next: MediaRoute): void => {
    current = next;
    resolved.clear();
    refreshOutput();
    try {
      if (current.output) delegateAll(false, [realm.document.documentElement]);
    } catch {
      /* no document */
    }
  };
  defineProperty(realm, KEY, { value: update });
  update(route);
}
