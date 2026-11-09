/**
 * Runs in the page's MAIN world via contextBridge.executeInMainWorld (serialized with
 * Function.prototype.toString): fully self-contained, no imports, no outer references.
 *
 * Electron is the content layer of Chromium without the Chrome browser layer, so a page sees an
 * empty `window.chrome` where every Chromium browser (Chrome, Chromium, Vivaldi, Brave, Edge) has
 * `chrome.app`, `chrome.csi` and `chrome.loadTimes`. Google's sign-in treats that gap as an
 * embedded browser. This fills it in with the same shape and behaviour, and keeps conditional
 * (autofill-style) WebAuthn requests from opening the OS passkey dialog on page load, because
 * Electron has no autofill UI to host them.
 *
 * Session preloads do not run in same-origin child documents that are not loaded from the network
 * (a new iframe's about:blank, `srcdoc`, document.write into it), yet Chromium gives those a full
 * `window.chrome` too, and `iframe.contentWindow.chrome` is a classic embedded-browser check. So
 * every DOM insertion that adds a frame shapes the new same-origin realms on the spot.
 */
export function shapeMainWorld(): void {
  type Method = (this: unknown, ...args: unknown[]) => unknown;
  type Getter = (this: unknown) => unknown;
  type Realm = typeof globalThis;

  const apply = Reflect.apply;
  const defineProperty = Object.defineProperty;
  const getDescriptor = Object.getOwnPropertyDescriptor;
  const setPrototypeOf = Object.setPrototypeOf;
  const nativeToString = Function.prototype.toString;
  const nativeSources = new WeakMap<object, string>();
  const shaped = new WeakSet<object>();

  /** A function of `realm` (its Function.prototype) whose toString reads as native code. */
  const native = (realm: Realm, name: string, impl: Method, length = 0): Method => {
    const fake = ({
      [name](this: unknown, ...args: unknown[]): unknown {
        return apply(impl, this, args);
      },
    })[name]!;
    setPrototypeOf(fake, realm.Function.prototype);
    defineProperty(fake, 'length', { value: length, configurable: true });
    nativeSources.set(fake, `function ${name}() { [native code] }`);
    return fake;
  };

  const replaceMethod = (realm: Realm, owner: object | undefined, name: string, make: (original: Method) => Method): void => {
    if (!owner) return;
    const descriptor = getDescriptor(owner, name);
    if (!descriptor || typeof descriptor.value !== 'function') return;
    const original = descriptor.value as Method;
    const fake = native(realm, name, make(original), original.length);
    nativeSources.set(fake, apply(nativeToString, original, []) as string);
    defineProperty(owner, name, { ...descriptor, value: fake });
  };

  const replaceAccessor = (realm: Realm, owner: object | undefined, name: string, kind: 'get' | 'set', make: (original: Method) => Method): void => {
    if (!owner) return;
    const descriptor = getDescriptor(owner, name);
    const original = descriptor?.[kind] as Method | undefined;
    if (!descriptor || typeof original !== 'function') return;
    const impl = make(original);
    const holder =
      kind === 'get'
        ? { get [name](): unknown { return apply(impl, this, []); } }
        : { set [name](value: unknown) { apply(impl, this, [value]); } };
    const fake = getDescriptor(holder, name)![kind] as Method;
    setPrototypeOf(fake, realm.Function.prototype);
    nativeSources.set(fake, apply(nativeToString, original, []) as string);
    defineProperty(owner, name, { ...descriptor, [kind]: fake });
  };

  const shapeChromeObject = (realm: Realm): void => {
    const existing = (realm as { chrome?: unknown }).chrome;
    const chrome = (existing && typeof existing === 'object' ? existing : new realm.Object()) as Record<string, unknown>;
    if (chrome !== existing) defineProperty(realm, 'chrome', { value: chrome, writable: true, enumerable: true, configurable: false });
    const plain = (props: Record<string, unknown>): Record<string, unknown> => realm.Object.assign(new realm.Object(), props);
    const performance = realm.performance;

    const navigationEntry = (): PerformanceNavigationTiming | undefined =>
      performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
    const paintTime = (): number => {
      const paint = performance.getEntriesByName('first-paint')[0];
      return paint ? (performance.timeOrigin + paint.startTime) / 1000 : 0;
    };
    const protocolOf = (entry: PerformanceNavigationTiming | undefined): string => entry?.nextHopProtocol || 'http/1.1';
    const navigationTypeOf = (entry: PerformanceNavigationTiming | undefined): string => {
      if (entry?.type === 'reload') return 'Reload';
      if (entry?.type === 'back_forward') return 'BackForward';
      return 'Other';
    };
    const seconds = (relative: number | undefined): number => (relative ? (performance.timeOrigin + relative) / 1000 : 0);

    if (!('loadTimes' in chrome)) {
      chrome.loadTimes = native(realm, 'loadTimes', () => {
        const entry = navigationEntry();
        const protocol = protocolOf(entry);
        const spdy = protocol === 'h2' || protocol === 'h3';
        return plain({
          requestTime: seconds(entry?.requestStart),
          startLoadTime: performance.timeOrigin / 1000,
          commitLoadTime: seconds(entry?.responseStart),
          finishDocumentLoadTime: seconds(entry?.domContentLoadedEventEnd),
          finishLoadTime: seconds(entry?.loadEventEnd),
          firstPaintTime: paintTime(),
          firstPaintAfterLoadTime: 0,
          navigationType: navigationTypeOf(entry),
          wasFetchedViaSpdy: spdy,
          wasNpnNegotiated: spdy,
          npnNegotiatedProtocol: spdy ? protocol : 'unknown',
          wasAlternateProtocolAvailable: false,
          connectionInfo: protocol,
        });
      });
    }

    if (!('csi' in chrome)) {
      chrome.csi = native(realm, 'csi', () => {
        const entry = navigationEntry();
        const types: Record<string, number> = { navigate: 0, reload: 1, back_forward: 2 };
        return plain({
          startE: Math.round(performance.timeOrigin),
          onloadT: Math.round(performance.timeOrigin + (entry?.domContentLoadedEventEnd ?? 0)),
          pageT: performance.now(),
          tran: entry ? (types[entry.type] ?? 15) : 15,
        });
      });
    }

    if (!('app' in chrome)) {
      chrome.app = plain({
        isInstalled: false,
        getDetails: native(realm, 'getDetails', () => null),
        getIsInstalled: native(realm, 'getIsInstalled', () => false),
        installState: native(realm, 'installState', (callback: unknown) => {
          if (typeof callback === 'function') queueMicrotask(() => (callback as (state: string) => void)('not_installed'));
        }),
        runningState: native(realm, 'runningState', () => 'cannot_run'),
        InstallState: plain({ DISABLED: 'disabled', INSTALLED: 'installed', NOT_INSTALLED: 'not_installed' }),
        RunningState: plain({ CANNOT_RUN: 'cannot_run', READY_TO_RUN: 'ready_to_run', RUNNING: 'running' }),
      });
    }
  };

  /**
   * Conditional mediation is the passive "offer passkeys in the username field's autofill" mode.
   * Electron has no autofill UI for it, so on Windows the request falls through to the modal
   * Windows Hello dialog the moment a sign-in page loads. Report it as unavailable and keep such
   * requests pending until the page aborts them, like a browser whose user never picks a passkey.
   * Explicit (button-initiated) WebAuthn calls are untouched.
   */
  const disableConditionalMediation = (realm: Realm): void => {
    const isConditional = (options: unknown): boolean =>
      !!options && typeof options === 'object' && (options as { mediation?: unknown }).mediation === 'conditional';
    const pendingUntilAborted = (options: unknown): Promise<never> =>
      new realm.Promise((_resolve, reject) => {
        const signal = (options as { signal?: AbortSignal }).signal;
        if (!signal) return;
        if (signal.aborted) {
          reject(signal.reason);
          return;
        }
        signal.addEventListener('abort', () => reject(signal.reason), { once: true });
      });
    const credentials = (realm as { CredentialsContainer?: { prototype: object } }).CredentialsContainer?.prototype;
    for (const name of ['get', 'create']) {
      replaceMethod(realm, credentials, name, (original) =>
        function (this: unknown, ...args: unknown[]) {
          if (isConditional(args[0]) && (args[0] as { publicKey?: unknown }).publicKey) return pendingUntilAborted(args[0]);
          return apply(original, this, args);
        },
      );
    }
    const publicKey = (realm as { PublicKeyCredential?: object }).PublicKeyCredential;
    replaceMethod(realm, publicKey, 'isConditionalMediationAvailable', () => function () {
      return realm.Promise.resolve(false);
    });
    replaceMethod(realm, publicKey, 'getClientCapabilities', (original) =>
      function (this: unknown, ...args: unknown[]) {
        return (apply(original, this, args) as Promise<Record<string, boolean>>).then((capabilities) => ({
          ...capabilities,
          conditionalGet: false,
          conditionalCreate: false,
        }));
      },
    );
  };

  const guardFrames = (realm: Realm): void => {
    const frameProto = realm.HTMLIFrameElement?.prototype;
    if (!frameProto) return;
    const shapeChild = (child: unknown): void => {
      if (!child) return;
      try {
        shapeRealm(child as Realm);
      } catch {
        /* cross-origin: shaped by its own preload */
      }
    };
    const frameCount = getDescriptor(realm, 'length')?.get as Getter | undefined;
    const countFrames = (): number => (frameCount ? (apply(frameCount, realm, []) as number) : 0);
    const watchInsertion = (original: Method): Method =>
      function (this: unknown, ...args: unknown[]) {
        const before = countFrames();
        const result = apply(original, this, args);
        const after = countFrames();
        for (let index = after > before ? 0 : after; index < after; index++) shapeChild((realm as unknown as Window)[index]);
        return result;
      };
    for (const name of ['appendChild', 'insertBefore', 'replaceChild']) replaceMethod(realm, realm.Node.prototype, name, watchInsertion);
    for (const name of ['append', 'prepend', 'after', 'before', 'replaceWith', 'insertAdjacentElement', 'insertAdjacentHTML']) {
      replaceMethod(realm, realm.Element.prototype, name, watchInsertion);
    }
    for (const name of ['write', 'writeln']) replaceMethod(realm, realm.Document.prototype, name, watchInsertion);
    for (const name of ['innerHTML', 'outerHTML']) replaceAccessor(realm, realm.Element.prototype, name, 'set', watchInsertion);
    replaceAccessor(realm, realm.ShadowRoot?.prototype, 'innerHTML', 'set', watchInsertion);
    replaceAccessor(realm, frameProto, 'contentWindow', 'get', (original) =>
      function (this: unknown) {
        const child = apply(original, this, []);
        shapeChild(child);
        return child;
      },
    );
    replaceAccessor(realm, frameProto, 'contentDocument', 'get', (original) =>
      function (this: unknown) {
        const child = apply(original, this, []) as Document | null;
        shapeChild(child?.defaultView);
        return child;
      },
    );
  };

  /** Child realms whose `chrome.app` already exists were shaped by their own preload (or are real). */
  const shapeRealm = (realm: Realm): void => {
    if (shaped.has(realm)) return;
    const existing = (realm as { chrome?: { app?: unknown } }).chrome;
    if (realm !== globalThis && existing && typeof existing === 'object' && 'app' in existing) return;
    shaped.add(realm);
    replaceMethod(realm, realm.Function.prototype, 'toString', (original) =>
      function (this: unknown, ...args: unknown[]) {
        if (typeof this === 'function') {
          const known = nativeSources.get(this);
          if (known !== undefined) return known;
        }
        return apply(original, this, args);
      },
    );
    for (const step of [shapeChromeObject, disableConditionalMediation, guardFrames]) {
      try {
        step(realm);
      } catch {
        /* never break the page */
      }
    }
  };

  try {
    shapeRealm(globalThis);
  } catch {
    /* never break the page */
  }
}
