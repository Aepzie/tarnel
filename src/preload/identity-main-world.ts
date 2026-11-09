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
 */
export function shapeMainWorld(): void {
  type Method = (this: unknown, ...args: unknown[]) => unknown;

  const apply = Reflect.apply;
  const defineProperty = Object.defineProperty;
  const getDescriptor = Object.getOwnPropertyDescriptor;
  const nativeToString = Function.prototype.toString;
  const nativeSources = new WeakMap<object, string>();

  const native = (name: string, impl: Method, length = 0): Method => {
    const fake = ({
      [name](this: unknown, ...args: unknown[]): unknown {
        return apply(impl, this, args);
      },
    })[name]!;
    defineProperty(fake, 'length', { value: length, configurable: true });
    nativeSources.set(fake, `function ${name}() { [native code] }`);
    return fake;
  };

  const replaceMethod = (owner: object | undefined, name: string, make: (original: Method) => Method): void => {
    if (!owner) return;
    const descriptor = getDescriptor(owner, name);
    if (!descriptor || typeof descriptor.value !== 'function') return;
    const original = descriptor.value as Method;
    const fake = native(name, make(original), original.length);
    nativeSources.set(fake, apply(nativeToString, original, []) as string);
    defineProperty(owner, name, { ...descriptor, value: fake });
  };

  replaceMethod(Function.prototype, 'toString', (original) =>
    function (this: unknown, ...args: unknown[]) {
      if (typeof this === 'function') {
        const known = nativeSources.get(this);
        if (known !== undefined) return known;
      }
      return apply(original, this, args);
    },
  );

  const shapeChromeObject = (): void => {
    const existing = (globalThis as { chrome?: unknown }).chrome;
    const chrome = (existing && typeof existing === 'object' ? existing : {}) as Record<string, unknown>;
    if (chrome !== existing) defineProperty(globalThis, 'chrome', { value: chrome, writable: true, enumerable: true, configurable: false });

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
      chrome.loadTimes = native('loadTimes', () => {
        const entry = navigationEntry();
        const protocol = protocolOf(entry);
        const spdy = protocol === 'h2' || protocol === 'h3';
        return {
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
        };
      });
    }

    if (!('csi' in chrome)) {
      chrome.csi = native('csi', () => {
        const entry = navigationEntry();
        const types: Record<string, number> = { navigate: 0, reload: 1, back_forward: 2 };
        return {
          startE: Math.round(performance.timeOrigin),
          onloadT: Math.round(performance.timeOrigin + (entry?.domContentLoadedEventEnd ?? 0)),
          pageT: performance.now(),
          tran: entry ? (types[entry.type] ?? 15) : 15,
        };
      });
    }

    if (!('app' in chrome)) {
      const installState = { DISABLED: 'disabled', INSTALLED: 'installed', NOT_INSTALLED: 'not_installed' };
      const runningState = { CANNOT_RUN: 'cannot_run', READY_TO_RUN: 'ready_to_run', RUNNING: 'running' };
      chrome.app = {
        isInstalled: false,
        getDetails: native('getDetails', () => null),
        getIsInstalled: native('getIsInstalled', () => false),
        installState: native('installState', (callback: unknown) => {
          if (typeof callback === 'function') queueMicrotask(() => (callback as (state: string) => void)('not_installed'));
        }),
        runningState: native('runningState', () => 'cannot_run'),
        InstallState: installState,
        RunningState: runningState,
      };
    }
  };

  /**
   * Conditional mediation is the passive "offer passkeys in the username field's autofill" mode.
   * Electron has no autofill UI for it, so on Windows the request falls through to the modal
   * Windows Hello dialog the moment a sign-in page loads. Report it as unavailable and keep such
   * requests pending until the page aborts them, like a browser whose user never picks a passkey.
   * Explicit (button-initiated) WebAuthn calls are untouched.
   */
  const disableConditionalMediation = (): void => {
    const isConditional = (options: unknown): boolean =>
      !!options && typeof options === 'object' && (options as { mediation?: unknown }).mediation === 'conditional';
    const pendingUntilAborted = (options: unknown): Promise<never> =>
      new Promise((_resolve, reject) => {
        const signal = (options as { signal?: AbortSignal }).signal;
        if (!signal) return;
        if (signal.aborted) {
          reject(signal.reason);
          return;
        }
        signal.addEventListener('abort', () => reject(signal.reason), { once: true });
      });
    const credentials = (globalThis as { CredentialsContainer?: { prototype: object } }).CredentialsContainer?.prototype;
    for (const name of ['get', 'create']) {
      replaceMethod(credentials, name, (original) =>
        function (this: unknown, ...args: unknown[]) {
          if (isConditional(args[0]) && (args[0] as { publicKey?: unknown }).publicKey) return pendingUntilAborted(args[0]);
          return apply(original, this, args);
        },
      );
    }
    const publicKey = (globalThis as { PublicKeyCredential?: object }).PublicKeyCredential;
    replaceMethod(publicKey, 'isConditionalMediationAvailable', () => function () {
      return Promise.resolve(false);
    });
    replaceMethod(publicKey, 'getClientCapabilities', (original) =>
      function (this: unknown, ...args: unknown[]) {
        return (apply(original, this, args) as Promise<Record<string, boolean>>).then((capabilities) => ({
          ...capabilities,
          conditionalGet: false,
          conditionalCreate: false,
        }));
      },
    );
  };

  try {
    shapeChromeObject();
  } catch {
    /* never break the page */
  }
  try {
    disableConditionalMediation();
  } catch {
    /* never break the page */
  }
}
