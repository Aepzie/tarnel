import type { FingerprintConfig } from '../shared/fingerprint';

/**
 * Runs in the page's MAIN world via contextBridge.executeInMainWorld, so it is serialized with
 * Function.prototype.toString: it must be fully self-contained (no imports, no outer references).
 * The same source also runs in every worker global scope (dedicated, shared, service: see
 * main/fingerprint/workers.ts and preload/fingerprint-worker.ts), so it must not assume a DOM:
 * workers get the same canvas/WebGL noise, GPU string, hardware buckets and UA-hint reduction.
 *
 * Every patch is deterministic in (space seed, top-level site): two reads of the same content give
 * the same result, reloads give the same result, other Spaces and other sites differ.
 */
export function protectMainWorld(config: FingerprintConfig): void {
  type Method = (this: unknown, ...args: unknown[]) => unknown;
  type Getter = (this: unknown) => unknown;
  type Pixels = Uint8ClampedArray | Uint8Array;
  type Realm = typeof globalThis;

  const [k0 = 0, k1 = 0, k2 = 0, k3 = 0] = config.key;
  const apply = Reflect.apply;
  const defineProperty = Object.defineProperty;
  const getDescriptor = Object.getOwnPropertyDescriptor;
  const nativeToString = Function.prototype.toString;
  /** Patched function → the native source text of the function it replaces. */
  const disguised = new WeakMap<object, string>();

  const mix = (a: number, b: number): number => {
    let h = Math.imul(a ^ b, 0x9e3779b1);
    h ^= h >>> 16;
    h = Math.imul(h, 0x85ebca6b);
    h ^= h >>> 13;
    h = Math.imul(h, 0xc2b2ae35);
    return (h ^ (h >>> 16)) >>> 0;
  };

  const hashString = (text: string): number => {
    let h = 0x811c9dc5;
    for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193);
    return h >>> 0;
  };

  const disguise = <T extends object>(fake: T, real: Method | Getter): T => {
    Object.setPrototypeOf(fake, Object.getPrototypeOf(real));
    defineProperty(fake, 'name', { value: real.name, configurable: true });
    defineProperty(fake, 'length', { value: real.length, configurable: true });
    disguised.set(fake, apply(nativeToString, real, []) as string);
    return fake;
  };

  /** All fakes share these three bodies, so any protected realm can recognise another realm's fakes by source text. */
  const methodFake = (name: string, impl: Method): Method =>
    ({
      [name](this: unknown, ...args: unknown[]): unknown {
        return apply(impl, this, args);
      },
    })[name]!;
  const getterFake = (name: string, impl: Getter): Getter =>
    getDescriptor(
      {
        get [name](): unknown {
          return apply(impl, this, []);
        },
      },
      name,
    )!.get as Getter;
  const setterFake = (name: string, impl: Method): Method =>
    getDescriptor(
      {
        set [name](value: unknown) {
          apply(impl, this, [value]);
        },
      },
      name,
    )!.set as Method;
  const fakeSources = new Set(
    [methodFake('fake', () => undefined), getterFake('fake', () => undefined), setterFake('fake', () => undefined)].map(
      (fake) => apply(nativeToString, fake, []) as string,
    ),
  );

  const wrapMethod = (proto: object | undefined, name: string, make: (original: Method) => Method): void => {
    if (!proto) return;
    const descriptor = getDescriptor(proto, name);
    if (!descriptor || typeof descriptor.value !== 'function') return;
    const original = descriptor.value as Method;
    defineProperty(proto, name, { ...descriptor, value: disguise(methodFake(name, make(original)), original) });
  };

  const wrapGetter = (proto: object | undefined, name: string, make: (original: Getter) => Getter): void => {
    if (!proto) return;
    const descriptor = getDescriptor(proto, name);
    if (!descriptor || typeof descriptor.get !== 'function') return;
    const original = descriptor.get as Getter;
    defineProperty(proto, name, { ...descriptor, get: disguise(getterFake(name, make(original)), original) });
  };

  const wrapSetter = (proto: object | undefined, name: string, make: (original: Method) => Method): void => {
    if (!proto) return;
    const descriptor = getDescriptor(proto, name);
    if (!descriptor || typeof descriptor.set !== 'function') return;
    const original = descriptor.set as Method;
    defineProperty(proto, name, { ...descriptor, set: disguise(setterFake(name, make(original)), original) });
  };

  /** Calls the native getter first so illegal invocations still throw natively, then lies. */
  const constant = (value: unknown) => (original: Getter): Getter =>
    function (this: unknown) {
      apply(original, this, []);
      return value;
    };

  /**
   * Sets the low bit of one color channel on ~1/16 of the non-transparent pixels, keyed by the
   * pixel's absolute canvas position. Idempotent (re-reading noised data gives the same bytes) and
   * transparent pixels stay untouched, so blank canvases stay blank.
   */
  const noisePixels = (pixels: Pixels, left: number, top: number, width: number): void => {
    if (width <= 0) return;
    const rows = Math.floor(pixels.length / 4 / width);
    let offset = 0;
    for (let row = 0; row < rows; row++) {
      const rowKey = mix(top + row, k0);
      for (let column = 0; column < width; column++, offset += 4) {
        if (pixels[offset + 3] === 0) continue;
        const h = mix(rowKey ^ (left + column), k1);
        if ((h & 15) !== 0) continue;
        const channel = offset + ((h >>> 4) % 3);
        pixels[channel] = (pixels[channel]! & 0xfe) | ((h >>> 8) & 1);
      }
    }
  };

  const noisedAudio = new WeakSet<Float32Array>();
  /** Relative ±1e-6 (≈ -120 dB) on a sparse, deterministic subset of samples. Silence stays silent. */
  const noiseSamples = (samples: Float32Array, channel: number): void => {
    if (noisedAudio.has(samples)) return;
    noisedAudio.add(samples);
    const channelKey = mix(k2, channel);
    for (let i = channelKey & 7; i < samples.length; i += 8 + (mix(i, channelKey) & 15)) {
      const value = samples[i]!;
      if (value === 0) continue;
      samples[i] = value * (mix(i, k3) & 1 ? 1.000001 : 0.999999);
    }
  };

  const NVIDIA = ['NVIDIA GeForce GTX 1650', 'NVIDIA GeForce RTX 3060', 'NVIDIA GeForce RTX 2060'];
  const AMD = ['AMD Radeon(TM) Graphics', 'AMD Radeon RX 6600', 'AMD Radeon RX 580 Series'];
  const INTEL = ['Intel(R) UHD Graphics 620', 'Intel(R) UHD Graphics 630', 'Intel(R) Iris(R) Xe Graphics'];
  const stripIds = (text: string): string => text.replace(/\s*\(0x[0-9a-f]+\)/gi, '');

  /** "ANGLE (NVIDIA, NVIDIA GeForce RTX 3070 (0x00002484) Direct3D11 vs_5_0 ps_5_0, D3D11)" → a common model of the same vendor. */
  const generalizeRenderer = (real: string): string => {
    const angle = /^ANGLE \(([^,]+), (.+), ([^,()]+)\)$/.exec(real);
    if (!angle) return stripIds(real);
    const [, vendor = '', device = '', backend = ''] = angle;
    const family = /nvidia/i.test(vendor) ? NVIDIA : /\b(amd|ati)\b/i.test(vendor) ? AMD : /intel/i.test(vendor) ? INTEL : null;
    if (!family) return `ANGLE (${vendor}, ${stripIds(device)}, ${backend})`;
    const api = / (Direct3D\S*(?: [vp]s_\S+)*)$/.exec(device)?.[1];
    return `ANGLE (${vendor}, ${family[config.gpu % family.length]}${api ? ` ${api}` : ''}, ${backend})`;
  };

  const SCREEN_BUCKETS: readonly (readonly [number, number])[] = [
    [1366, 768], [1440, 900], [1536, 864], [1600, 900], [1920, 1080], [2560, 1440], [3440, 1440], [3840, 2160],
  ];

  const isProtected = (realm: Realm): boolean => {
    try {
      const probe = realm.HTMLCanvasElement?.prototype.toDataURL ?? realm.OffscreenCanvas?.prototype.convertToBlob;
      return !!probe && !(apply(nativeToString, probe, []) as string).includes('[native code]');
    } catch {
      return true;
    }
  };

  const protectRealm = (realm: Realm): void => {
    if (isProtected(realm)) return;
    const doc = realm.document;
    const createElement = realm.Document?.prototype.createElement;
    const contextApi = (canvas: { prototype: { getContext: unknown } } | undefined, context: { prototype: CanvasImageData & CanvasDrawImage } | undefined) =>
      canvas && context
        ? {
            getContext: canvas.prototype.getContext as Method,
            drawImage: context.prototype.drawImage as Method,
            getImageData: context.prototype.getImageData as Method,
            putImageData: context.prototype.putImageData as Method,
          }
        : null;
    const onscreenApi = contextApi(realm.HTMLCanvasElement, realm.CanvasRenderingContext2D);
    const offscreenApi = contextApi(realm.OffscreenCanvas, realm.OffscreenCanvasRenderingContext2D);

    wrapMethod(realm.Function.prototype, 'toString', (original) =>
      function (this: unknown, ...args: unknown[]) {
        if (typeof this !== 'function') return apply(original, this, args);
        const known = disguised.get(this);
        if (known !== undefined) return known;
        const source = apply(original, this, args) as string;
        return fakeSources.has(source) ? `function ${String(this.name)}() { [native code] }` : source;
      },
    );

    /** A 2d copy of `source` with noised pixels; throws (like the native call would) if tainted. */
    const noisyCopy = (source: object, width: number, height: number, offscreen: boolean): object | null => {
      const api = offscreen ? offscreenApi : onscreenApi;
      if (!width || !height || !api) return null;
      let copy: HTMLCanvasElement | OffscreenCanvas;
      if (offscreen) {
        copy = new realm.OffscreenCanvas(width, height);
      } else {
        copy = apply(createElement, doc, ['canvas']) as HTMLCanvasElement;
        copy.width = width;
        copy.height = height;
      }
      const context = apply(api.getContext, copy, ['2d']) as object;
      apply(api.drawImage, context, [source, 0, 0]);
      const image = apply(api.getImageData, context, [0, 0, width, height]) as ImageData;
      noisePixels(image.data, 0, 0, width);
      apply(api.putImageData, context, [image, 0, 0]);
      return copy;
    };

    const exportFrom = (offscreen: boolean) => (original: Method): Method =>
      function (this: unknown, ...args: unknown[]) {
        let copy: object | null = null;
        try {
          const canvas = this as HTMLCanvasElement;
          copy = noisyCopy(canvas, canvas.width, canvas.height, offscreen);
        } catch {
          copy = null;
        }
        return apply(original, copy ?? this, args);
      };

    wrapMethod(realm.HTMLCanvasElement?.prototype, 'toDataURL', exportFrom(false));
    wrapMethod(realm.HTMLCanvasElement?.prototype, 'toBlob', exportFrom(false));
    wrapMethod(realm.OffscreenCanvas?.prototype, 'convertToBlob', exportFrom(true));

    const readback = (original: Method): Method =>
      function (this: unknown, ...args: unknown[]) {
        const image = apply(original, this, args) as ImageData;
        let left = Math.trunc(Number(args[0])) || 0;
        let top = Math.trunc(Number(args[1])) || 0;
        const width = Math.trunc(Number(args[2])) || 0;
        const height = Math.trunc(Number(args[3])) || 0;
        if (width < 0) left += width;
        if (height < 0) top += height;
        noisePixels(image.data, left, top, image.width);
        return image;
      };
    wrapMethod(realm.CanvasRenderingContext2D?.prototype, 'getImageData', readback);
    wrapMethod(realm.OffscreenCanvasRenderingContext2D?.prototype, 'getImageData', readback);

    const fontMask = config.strict ? fontMasker(realm) : null;
    const textNoise = new WeakMap<object, number>();
    const measure = (original: Method): Method =>
      function (this: unknown, ...args: unknown[]) {
        const context = this as CanvasRenderingContext2D;
        const font = context.font;
        const masked = fontMask && typeof font === 'string' ? fontMask(font, realm.document?.fonts ?? (realm as unknown as { fonts?: unknown }).fonts) : null;
        let metrics: TextMetrics;
        if (masked === null) metrics = apply(original, this, args) as TextMetrics;
        else {
          context.font = masked;
          try {
            metrics = apply(original, this, args) as TextMetrics;
          } finally {
            context.font = font;
          }
        }
        const h = mix(hashString(`${String(args[0])}\u0000${font}`), k2);
        textNoise.set(metrics, 1 + ((h & 0xff) - 127.5) * 1e-7);
        return metrics;
      };
    wrapMethod(realm.CanvasRenderingContext2D?.prototype, 'measureText', measure);
    wrapMethod(realm.OffscreenCanvasRenderingContext2D?.prototype, 'measureText', measure);
    wrapGetter(realm.TextMetrics?.prototype, 'width', (original) =>
      function (this: unknown) {
        const width = apply(original, this, []) as number;
        const factor = textNoise.get(this as object);
        return factor === undefined ? width : width * factor;
      },
    );

    for (const GL of [realm.WebGLRenderingContext, realm.WebGL2RenderingContext]) {
      if (!GL) continue;
      wrapMethod(GL.prototype, 'getParameter', (original) =>
        function (this: unknown, ...args: unknown[]) {
          const value = apply(original, this, args);
          if (args[0] === 0x9246 && typeof value === 'string') return generalizeRenderer(value);
          return value;
        },
      );
      wrapMethod(GL.prototype, 'readPixels', (original) =>
        function (this: unknown, ...args: unknown[]) {
          const result = apply(original, this, args);
          const target = args[6];
          if (args[4] !== 0x1908 || args[5] !== 0x1401 || !ArrayBuffer.isView(target)) return result;
          const bytes = target as Uint8Array;
          if (bytes.BYTES_PER_ELEMENT !== 1) return result;
          const width = Math.trunc(Number(args[2])) || 0;
          const height = Math.trunc(Number(args[3])) || 0;
          const start = typeof args[7] === 'number' ? args[7] : 0;
          noisePixels(bytes.subarray(start, start + width * height * 4), Math.trunc(Number(args[0])) || 0, Math.trunc(Number(args[1])) || 0, width);
          return result;
        },
      );
    }

    const getChannelData = realm.AudioBuffer?.prototype.getChannelData as Method | undefined;
    wrapMethod(realm.AudioBuffer?.prototype, 'getChannelData', (original) =>
      function (this: unknown, ...args: unknown[]) {
        const samples = apply(original, this, args) as Float32Array;
        noiseSamples(samples, Number(args[0]) | 0);
        return samples;
      },
    );
    wrapMethod(realm.AudioBuffer?.prototype, 'copyFromChannel', (original) =>
      function (this: unknown, ...args: unknown[]) {
        try {
          const channel = Number(args[1]) | 0;
          if (getChannelData) noiseSamples(apply(getChannelData, this, [channel]) as Float32Array, channel);
        } catch {
          /* let the native call report the error */
        }
        return apply(original, this, args);
      },
    );
    wrapMethod(realm.AnalyserNode?.prototype, 'getFloatFrequencyData', (original) =>
      function (this: unknown, ...args: unknown[]) {
        const result = apply(original, this, args);
        const target = args[0];
        if (target instanceof realm.Float32Array) {
          for (let i = 0; i < target.length; i++) {
            const value = target[i]!;
            if (Number.isFinite(value)) target[i] = value + ((mix(i, k3) & 0xff) - 127.5) * 1e-6;
          }
        }
        return result;
      },
    );

    /**
     * Layout reads (getClientRects / getBoundingClientRect on elements and ranges) are scaled by one
     * tiny per-site factor (|1 - f| between 1.6e-6 and 1.4e-5): geometry stays self-consistent and
     * layout code is unaffected, but ClientRects hashes follow the Space's seed. Rects a page builds
     * itself are never scaled; writing to a measured rect stores the scaled values natively.
     */
    const rectScale = 1 + ((k1 & 0x7f) + 16) * (k1 & 0x80 ? 1e-7 : -1e-7);
    const scaledRects = new WeakSet<object>();
    const markRect = (original: Method): Method =>
      function (this: unknown, ...args: unknown[]) {
        const rect = apply(original, this, args) as object;
        scaledRects.add(rect);
        return rect;
      };
    const markRectList = (original: Method): Method =>
      function (this: unknown, ...args: unknown[]) {
        const list = apply(original, this, args) as DOMRectList;
        for (let i = 0; i < list.length; i++) scaledRects.add(list[i]!);
        return list;
      };
    for (const proto of [realm.Element?.prototype, realm.Range?.prototype]) {
      wrapMethod(proto, 'getBoundingClientRect', markRect);
      wrapMethod(proto, 'getClientRects', markRectList);
    }
    const readOnlyProto = realm.DOMRectReadOnly?.prototype;
    const rectProto = realm.DOMRect?.prototype;
    const baseKeys = ['x', 'y', 'width', 'height'];
    const rectKeys = [...baseKeys, 'top', 'right', 'bottom', 'left'];
    /** Captured before wrapping, so reading and materializing never re-enter the wrappers. */
    const nativeBaseGetters = baseKeys.map((name) => (readOnlyProto ? getDescriptor(readOnlyProto, name)?.get : undefined));
    const nativeBaseSetters = baseKeys.map((name) => (rectProto ? getDescriptor(rectProto, name)?.set : undefined));
    /** The edges are derived from the scaled x/y/width/height exactly like DOMRectReadOnly derives them natively. */
    const scaledBase = (rect: object, i: number): number => {
      const get = nativeBaseGetters[i];
      return get ? (apply(get, rect, []) as number) * rectScale : NaN;
    };
    const min = (a: number, b: number): number => (a !== a || b !== b ? NaN : a < b ? a : b);
    const max = (a: number, b: number): number => (a !== a || b !== b ? NaN : a > b ? a : b);
    const scaledBox = (rect: object): Record<string, number> => {
      const x = scaledBase(rect, 0);
      const y = scaledBase(rect, 1);
      const width = scaledBase(rect, 2);
      const height = scaledBase(rect, 3);
      return {
        x,
        y,
        width,
        height,
        top: min(y, y + height),
        right: max(x, x + width),
        bottom: max(y, y + height),
        left: min(x, x + width),
      };
    };
    const scaled = (name: string) => (original: Getter): Getter =>
      function (this: unknown) {
        const value = apply(original, this, []) as number;
        return scaledRects.has(this as object) ? scaledBox(this as object)[name]! : value;
      };
    /** toJSON reads the internal slots, so JSON.stringify(rect) must be scaled exactly like the getters. */
    wrapMethod(readOnlyProto, 'toJSON', (original) =>
      function (this: unknown, ...args: unknown[]) {
        const json = apply(original, this, args) as Record<string, unknown>;
        if (!scaledRects.has(this as object) || !json) return json;
        const box = scaledBox(this as object);
        for (const key of rectKeys) {
          if (typeof json[key] === 'number') json[key] = box[key];
        }
        return json;
      },
    );
    /**
     * Writing to a measured rect first stores the scaled values natively, then drops the mark: every
     * field keeps the value the page already saw, so `r.x = r.x` can't reveal the unscaled geometry.
     */
    const materializeRect = (rect: object): void => {
      const box = scaledBox(rect);
      scaledRects.delete(rect);
      for (let i = 0; i < baseKeys.length; i++) {
        const set = nativeBaseSetters[i];
        if (set) apply(set, rect, [box[baseKeys[i]!]]);
      }
    };
    for (const name of rectKeys) {
      wrapGetter(readOnlyProto, name, scaled(name));
      wrapGetter(rectProto, name, scaled(name));
      wrapSetter(rectProto, name, (original) =>
        function (this: unknown, value: unknown) {
          if (scaledRects.has(this as object)) materializeRect(this as object);
          apply(original, this, [value]);
        },
      );
    }

    /** Workers have WorkerNavigator (and no DOM): the same getters live there. */
    const workerNavigator = (realm as unknown as { WorkerNavigator?: { prototype: object } }).WorkerNavigator;
    const navigatorProto: object | undefined = (realm.Navigator ?? workerNavigator)?.prototype;
    wrapGetter(navigatorProto, 'hardwareConcurrency', constant(config.cores));
    wrapGetter(navigatorProto, 'deviceMemory', constant(config.memory));
    if (config.languages && config.languages.length > 0) {
      const languages = Object.freeze(realm.Array.from(config.languages));
      wrapGetter(navigatorProto, 'language', constant(languages[0]));
      wrapGetter(navigatorProto, 'languages', constant(languages));
    }

    const battery = (realm as unknown as { BatteryManager?: { prototype: object } }).BatteryManager?.prototype;
    wrapGetter(battery, 'charging', constant(true));
    wrapGetter(battery, 'chargingTime', constant(0));
    wrapGetter(battery, 'dischargingTime', constant(Infinity));
    wrapGetter(battery, 'level', constant(1));

    const frameProto = realm.HTMLIFrameElement?.prototype;
    if (frameProto) guardFrames(realm, frameProto);
    if (config.strict) protectStrict(realm, navigatorProto);
  };

  /**
   * Preloads do not run in a new iframe's initial about:blank document, which a page can reach
   * synchronously (window[0], contentWindow) right after inserting it. Every DOM insertion that
   * adds a frame therefore patches the new same-origin realms on the spot.
   */
  const guardFrames = (realm: Realm, frameProto: HTMLIFrameElement): void => {
    const guardChild = (child: unknown): void => {
      if (!child) return;
      try {
        protectRealm(child as Realm);
      } catch {
        /* cross-origin: protected by its own preload */
      }
    };
    const frameCount = getDescriptor(realm, 'length')?.get as Getter | undefined;
    const countFrames = (): number => (frameCount ? (apply(frameCount, realm, []) as number) : 0);
    const watchInsertion = (original: Method): Method =>
      function (this: unknown, ...args: unknown[]) {
        const before = countFrames();
        const result = apply(original, this, args);
        const after = countFrames();
        for (let index = after > before ? 0 : after; index < after; index++) guardChild((realm as unknown as Window)[index]);
        return result;
      };
    for (const name of ['appendChild', 'insertBefore', 'replaceChild']) wrapMethod(realm.Node.prototype, name, watchInsertion);
    for (const name of ['append', 'prepend', 'after', 'before', 'replaceWith', 'insertAdjacentElement', 'insertAdjacentHTML']) {
      wrapMethod(realm.Element.prototype, name, watchInsertion);
    }
    for (const name of ['write', 'writeln']) wrapMethod(realm.Document.prototype, name, watchInsertion);
    for (const name of ['innerHTML', 'outerHTML']) wrapSetter(realm.Element.prototype, name, watchInsertion);
    wrapSetter(realm.ShadowRoot?.prototype, 'innerHTML', watchInsertion);
    wrapGetter(frameProto, 'contentWindow', (original) =>
      function (this: unknown) {
        const child = apply(original, this, []);
        guardChild(child);
        return child;
      },
    );
    wrapGetter(frameProto, 'contentDocument', (original) =>
      function (this: unknown) {
        const child = apply(original, this, []) as Document | null;
        guardChild(child?.defaultView);
        return child;
      },
    );
  };

  /**
   * Strict: installed fonts are a strong identifier, probed by measuring text in a candidate font
   * (canvas measureText) or asking FontFaceSet.check. Families that are neither generic, nor common
   * on this platform, nor loaded by the page itself (@font-face / FontFace) are answered as if they
   * were not installed: they are swapped for a family that never exists, so the browser falls back
   * exactly like it does for a missing font. Returns null when the font needs no change.
   */
  const fontMasker = (realm: Realm): ((font: string, faces: unknown) => string | null) => {
    const generic = 'serif,sans-serif,monospace,cursive,fantasy,system-ui,ui-serif,ui-sans-serif,ui-monospace,ui-rounded,emoji,math,fangsong,-apple-system,blinkmacsystemfont';
    const windows =
      'arial,arial black,bahnschrift,calibri,cambria,cambria math,candara,comic sans ms,consolas,constantia,corbel,courier new,ebrima,franklin gothic medium,gabriola,gadugi,georgia,impact,ink free,javanese text,leelawadee ui,lucida console,lucida sans unicode,malgun gothic,marlett,microsoft himalaya,microsoft jhenghei,microsoft new tai lue,microsoft phagspa,microsoft sans serif,microsoft tai le,microsoft yahei,microsoft yi baiti,mingliu-extb,mongolian baiti,ms gothic,mv boli,myanmar text,nirmala ui,palatino linotype,segoe mdl2 assets,segoe print,segoe script,segoe ui,segoe ui emoji,segoe ui historic,segoe ui symbol,simsun,sitka,sylfaen,symbol,tahoma,times new roman,trebuchet ms,verdana,webdings,wingdings,yu gothic';
    const mac =
      'american typewriter,andale mono,arial,arial black,arial narrow,arial rounded mt bold,arial unicode ms,avenir,avenir next,baskerville,big caslon,bradley hand,brush script mt,chalkboard,chalkboard se,chalkduster,charter,cochin,comic sans ms,copperplate,courier,courier new,didot,futura,geneva,georgia,gill sans,helvetica,helvetica neue,herculanum,hoefler text,impact,lucida grande,luminari,marker felt,menlo,microsoft sans serif,monaco,noteworthy,optima,palatino,papyrus,phosphate,rockwell,savoye let,sf pro,sf mono,skia,snell roundhand,tahoma,times,times new roman,trattatello,trebuchet ms,verdana,zapfino';
    const linux =
      'dejavu sans,dejavu sans mono,dejavu serif,liberation mono,liberation sans,liberation serif,noto sans,noto serif,noto mono,noto color emoji,ubuntu,ubuntu mono,cantarell,droid sans,freesans,freeserif,freemono,arial,courier new,times new roman';
    const platform = String((realm.navigator as Navigator | undefined)?.platform ?? '').toLowerCase();
    const list = platform.startsWith('win') ? windows : platform.startsWith('mac') ? mac : linux;
    const allowed = new Set(`${generic},${list}`.split(','));
    const size = /(?:^|\s)(?:[\d.]+[a-z%]+|xx?x?-(?:small|large)|small|medium|large|smaller|larger)(?:\s*\/\s*\S+)?\s+(\S.*)$/i;
    const faceSet = realm.FontFaceSet?.prototype;
    const forEachFace = faceSet ? (getDescriptor(faceSet, 'forEach')?.value as Method | undefined) : undefined;
    const faceProto = realm.FontFace?.prototype;
    const faceFamily = faceProto ? (getDescriptor(faceProto, 'family')?.get as Getter | undefined) : undefined;
    const clean = (name: string): string => name.trim().replace(/^["']|["']$/g, '').toLowerCase();
    const pageFamilies = (faces: unknown): Set<string> => {
      const names = new Set<string>();
      if (!faces || !forEachFace || !faceFamily) return names;
      try {
        apply(forEachFace, faces, [(face: unknown) => names.add(clean(String(apply(faceFamily, face, []))))]);
      } catch {
        /* not a FontFaceSet */
      }
      return names;
    };
    return (font, faces) => {
      const match = size.exec(font);
      const familyList = match?.[1];
      if (!match || !familyList) return null;
      let own: Set<string> | null = null;
      let changed = false;
      const families = familyList.split(',').map((family) => {
        const name = clean(family);
        if (allowed.has(name)) return family;
        own ??= pageFamilies(faces);
        if (own.has(name)) return family;
        changed = true;
        return '"_"';
      });
      if (!changed) return null;
      return font.slice(0, match.index + match[0].length - familyList.length) + families.join(',');
    };
  };

  const protectFonts = (realm: Realm): void => {
    const mask = fontMasker(realm);
    wrapMethod(realm.FontFaceSet?.prototype, 'check', (original) =>
      function (this: unknown, ...args: unknown[]) {
        const masked = typeof args[0] === 'string' ? mask(args[0], this) : null;
        if (masked !== null) args[0] = masked;
        return apply(original, this, args);
      },
    );
    const deny = (): Method =>
      function () {
        return realm.Promise.reject(new realm.DOMException('Permission not granted.', 'NotAllowedError'));
      };
    wrapMethod(realm, 'queryLocalFonts', deny);
    wrapMethod(realm.Window?.prototype, 'queryLocalFonts', deny);
  };

  /** Strict-only reductions. Workers have no screen, media devices or gamepads; their userAgentData matches the window's. */
  const protectStrict = (realm: Realm, navigatorProto: object | undefined): void => {
    const screenProto: object | undefined = realm.Screen?.prototype;
    const screenGetter = (name: string): Getter | undefined =>
      screenProto ? (getDescriptor(screenProto, name)?.get as Getter | undefined) : undefined;
    const realWidth = screenGetter('width');
    const realHeight = screenGetter('height');
    const realAvailHeight = screenGetter('availHeight');
    const bucketed = (screenObject: unknown): readonly [number, number] => {
      const width = realWidth ? (apply(realWidth, screenObject, []) as number) : 1920;
      const height = realHeight ? (apply(realHeight, screenObject, []) as number) : 1080;
      return SCREEN_BUCKETS.find(([w, h]) => w >= width && h >= height) ?? [width, height];
    };
    wrapGetter(screenProto, 'width', () => function (this: unknown) { return bucketed(this)[0]; });
    wrapGetter(screenProto, 'height', () => function (this: unknown) { return bucketed(this)[1]; });
    wrapGetter(screenProto, 'availWidth', () => function (this: unknown) { return bucketed(this)[0]; });
    wrapGetter(screenProto, 'availHeight', () =>
      function (this: unknown) {
        const reserved = realHeight && realAvailHeight ? (apply(realHeight, this, []) as number) - (apply(realAvailHeight, this, []) as number) : 0;
        return bucketed(this)[1] - reserved;
      },
    );
    wrapGetter(screenProto, 'availLeft', constant(0));
    wrapGetter(screenProto, 'availTop', constant(0));
    wrapGetter(screenProto, 'colorDepth', constant(24));
    wrapGetter(screenProto, 'pixelDepth', constant(24));

    const uaData = (realm as unknown as { NavigatorUAData?: { prototype: object } }).NavigatorUAData?.prototype;
    wrapMethod(uaData, 'getHighEntropyValues', (original) =>
      function (this: unknown, ...args: unknown[]) {
        const pending = apply(original, this, args) as Promise<Record<string, unknown>>;
        return pending.then((values) => {
          const major = (version: unknown): string => String(version ?? '').split('.')[0] ?? '0';
          if ('uaFullVersion' in values) values.uaFullVersion = `${major(values.uaFullVersion)}.0.0.0`;
          if ('platformVersion' in values) values.platformVersion = `${major(values.platformVersion)}.0.0`;
          if ('model' in values) values.model = '';
          if ('wow64' in values) values.wow64 = false;
          if (Array.isArray(values.fullVersionList)) {
            values.fullVersionList = values.fullVersionList.map((entry: { brand: string; version: string }) => ({
              brand: entry.brand,
              version: `${major(entry.version)}.0.0.0`,
            }));
          }
          return values;
        });
      },
    );

    const deviceInfo = realm.MediaDeviceInfo?.prototype;
    const kindGetter = deviceInfo ? (getDescriptor(deviceInfo, 'kind')?.get as Getter | undefined) : undefined;
    const genericLabel = (device: unknown, label: string): string => {
      if (!label || !kindGetter) return label;
      const kind = apply(kindGetter, device, []);
      if (kind === 'audioinput') return 'Microphone';
      if (kind === 'videoinput') return 'Camera';
      return 'Speakers';
    };
    wrapGetter(deviceInfo, 'label', (original) =>
      function (this: unknown) {
        return genericLabel(this, apply(original, this, []) as string);
      },
    );
    wrapMethod(deviceInfo, 'toJSON', (original) =>
      function (this: unknown, ...args: unknown[]) {
        const json = apply(original, this, args) as { label?: string };
        if (typeof json?.label === 'string') json.label = genericLabel(this, json.label);
        return json;
      },
    );

    wrapMethod(navigatorProto, 'getGamepads', () =>
      function () {
        return [null, null, null, null];
      },
    );
    protectFonts(realm);
  };

  try {
    protectRealm(globalThis);
  } catch {
    /* never break the page */
  }
}
