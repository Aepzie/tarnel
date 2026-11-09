import type { TabAudioSettings } from '../shared/audio-mixer';
import type { MixerEngineHandle, RealmAudioReport } from '../shared/audio-mixer-engine';

/**
 * Per-tab audio mixer engine for one realm (frame). Runs in the page's MAIN world — via
 * contextBridge.executeInMainWorld from the session preload (new documents, before page scripts) or
 * via WebFrameMain.executeJavaScript from main (documents already loaded when the tab is first
 * processed) — so it is serialized with Function.prototype.toString and must be fully self-contained.
 * Calling it again in the same realm only swaps the settings; `null` (neutral) on a realm that was
 * never processed installs nothing. Returns whether an engine is installed.
 *
 * Graph, per AudioContext (the engine's own processing context for media elements, plus every page
 * AudioContext that connects to its destination):
 *
 *   input ─► [mono] ─► [balance] ─► [bass shelf] ─► [EQ bands ≠ 0] ─► [compressor] ─► [volume] ─► [soft clip] ─► output ─► destination
 *                                                                                                        └─► meter (only while levels are read)
 *
 * Only the stages the settings need are wired; neutral settings leave input ─► output.
 *
 * Sources: media elements (playing and unmuted) go into the processing context via
 * createMediaElementSource, MediaStream elements (WebRTC) via createMediaStreamSource with the
 * element muted underneath. Capturing an element is irreversible and Web Audio outputs silence for
 * media it may not read, so an element is only captured when its media is provably readable
 * (blob/data/MSE/MediaStream, CORS-enabled, or same-origin without a cross-origin redirect, checked
 * with a same-origin HEAD); everything else stays native and only gets the tab volume (≤ 1) through
 * `element.volume` ("partial" routing).
 */
export function mixTabAudio(initial: TabAudioSettings | null): boolean {
  type Method = (this: unknown, ...args: unknown[]) => unknown;
  type Getter = (this: unknown) => unknown;
  type Setter = (this: unknown, value: unknown) => void;
  type Media = HTMLMediaElement;
  interface Stage {
    first: AudioNode;
    last: AudioNode;
  }
  interface Stages {
    mono: Stage;
    balance: Stage;
    left: GainNode;
    right: GainNode;
    bass: BiquadFilterNode;
    bassStage: Stage;
    bands: BiquadFilterNode[];
    bandStages: Stage[];
    compressor: DynamicsCompressorNode;
    compressorStage: Stage;
    volume: GainNode;
    volumeStage: Stage;
    limiter: Stage;
  }
  interface Meter {
    splitter: ChannelSplitterNode;
    left: AnalyserNode;
    right: AnalyserNode;
    time: Float32Array<ArrayBuffer>;
    freqL: Float32Array<ArrayBuffer>;
    freqR: Float32Array<ArrayBuffer>;
  }
  interface Chain {
    context: BaseAudioContext;
    input: GainNode;
    output: GainNode;
    stages: Stages | null;
    wired: Stage[];
    meter: Meter | null;
    metering: boolean;
  }
  interface Routed {
    source: AudioNode;
    /** MediaStream elements only: page volume / mute / pause, since the element itself is muted. */
    gain: GainNode | null;
    stream: MediaStream | null;
    engaged: boolean;
    /** Set when the page asks for its own MediaElementAudioSourceNode of a captured element. */
    bridge: MediaStreamAudioDestinationNode | null;
  }

  const KEY = Symbol.for('vela.mixer');
  const host = globalThis as unknown as Record<symbol, MixerEngineHandle | undefined>;
  const installed = host[KEY];
  if (installed) {
    installed.update(initial);
    return true;
  }
  if (!initial) return false;

  const realm = globalThis;
  const ContextClass = realm.AudioContext;
  const MediaClass = realm.HTMLMediaElement;
  const NodeClass = realm.AudioNode;
  const DestinationClass = realm.AudioDestinationNode;
  const StreamClass = realm.MediaStream;
  if (!ContextClass || !MediaClass || !NodeClass || !DestinationClass || !realm.document) return false;

  const apply = Reflect.apply;
  const defineProperty = Object.defineProperty;
  const getDescriptor = Object.getOwnPropertyDescriptor;
  const getPrototype = Object.getPrototypeOf;
  const URLClass = realm.URL;
  const WeakRefClass = realm.WeakRef;
  const nativeFetch = realm.fetch;
  const setTimer = realm.setTimeout;
  const clearTimer = realm.clearTimeout;
  const { GainNode, BiquadFilterNode, ChannelSplitterNode, ChannelMergerNode, DynamicsCompressorNode, WaveShaperNode, AnalyserNode } = realm;

  const EQ = [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];
  /** Soft clip: identity up to KNEE, then tanh towards 1; inputs up to ±HEADROOM (+18 dB) stay smooth. */
  const KNEE = 0.85;
  const HEADROOM = 8;
  const SMOOTHING = 0.015;
  const IDLE_SUSPEND_MS = 10_000;
  const METER_IDLE_MS = 1_500;
  const FFT_SIZE = 4096;
  const SPECTRUM_BINS = 16;

  const lookup = (proto: object | null | undefined, name: string): PropertyDescriptor | undefined => {
    for (let current = proto; current; current = getPrototype(current) as object | null) {
      const descriptor = getDescriptor(current, name);
      if (descriptor) return descriptor;
    }
    return undefined;
  };
  const getterOf = (proto: object | undefined, name: string): Getter | undefined => lookup(proto, name)?.get as Getter | undefined;
  const setterOf = (proto: object | undefined, name: string): Setter | undefined => lookup(proto, name)?.set as Setter | undefined;
  const methodOf = (proto: object | undefined, name: string): Method | undefined => {
    const value = lookup(proto, name)?.value;
    return typeof value === 'function' ? (value as Method) : undefined;
  };

  // ---- native look (same scheme as the other main-world patches) ------------

  const nativeToString = realm.Function.prototype.toString;
  const sources = new WeakMap<object, string>();
  const disguise = <T extends Method | Getter | Setter>(fake: T, real: Method | Getter | Setter): T => {
    defineProperty(fake, 'name', { value: real.name, configurable: true });
    defineProperty(fake, 'length', { value: real.length, configurable: true });
    sources.set(fake, apply(nativeToString, real, []) as string);
    return fake;
  };
  const wrapMethod = (proto: object | undefined, name: string, make: (original: Method) => Method): void => {
    const descriptor = proto ? getDescriptor(proto, name) : undefined;
    if (!proto || !descriptor || typeof descriptor.value !== 'function') return;
    const original = descriptor.value as Method;
    const impl = make(original);
    const fake = ({
      [name](this: unknown, ...args: unknown[]): unknown {
        return apply(impl, this, args);
      },
    })[name]!;
    defineProperty(proto, name, { ...descriptor, value: disguise(fake, original) });
  };
  const wrapAccessor = (proto: object | undefined, name: string, makeGet: (original: Getter) => Getter, makeSet: (original: Setter) => Setter): void => {
    const descriptor = proto ? getDescriptor(proto, name) : undefined;
    if (!proto || !descriptor || typeof descriptor.get !== 'function' || typeof descriptor.set !== 'function') return;
    const get = makeGet(descriptor.get as Getter);
    const set = makeSet(descriptor.set as Setter);
    const fake = getDescriptor(
      {
        get [name](): unknown {
          return apply(get, this, []);
        },
        set [name](value: unknown) {
          apply(set, this, [value]);
        },
      },
      name,
    )!;
    defineProperty(proto, name, {
      ...descriptor,
      get: disguise(fake.get as Getter, descriptor.get as Getter),
      set: disguise(fake.set as Setter, descriptor.set as Setter),
    });
  };

  wrapMethod(realm.Function.prototype, 'toString', (original) =>
    function (this: unknown, ...args: unknown[]) {
      const known = typeof this === 'function' || typeof this === 'object' ? sources.get(this as object) : undefined;
      return known ?? apply(original, this, args);
    },
  );

  // ---- natives ----------------------------------------------------------------

  const nodeProto = NodeClass.prototype;
  const contextProto = ContextClass.prototype;
  const mediaProto = MediaClass.prototype;
  const nativeConnect = methodOf(nodeProto, 'connect')!;
  const nativeDisconnect = methodOf(nodeProto, 'disconnect')!;
  const contextOfNode = getterOf(nodeProto, 'context')!;
  const createElementSource = methodOf(contextProto, 'createMediaElementSource')!;
  const createStreamSource = methodOf(contextProto, 'createMediaStreamSource')!;
  const createStreamDestination = methodOf(contextProto, 'createMediaStreamDestination')!;
  const resumeContext = methodOf(contextProto, 'resume')!;
  const suspendContext = methodOf(contextProto, 'suspend')!;
  const stateOf = getterOf(contextProto, 'state')!;
  const timeOf = getterOf(contextProto, 'currentTime')!;
  const rateOf = getterOf(contextProto, 'sampleRate')!;
  const pausedOf = getterOf(mediaProto, 'paused')!;
  const mutedOf = getterOf(mediaProto, 'muted')!;
  const setMuted = setterOf(mediaProto, 'muted')!;
  const volumeOf = getterOf(mediaProto, 'volume')!;
  const setVolume = setterOf(mediaProto, 'volume')!;
  const srcObjectOf = getterOf(mediaProto, 'srcObject');
  const currentSrcOf = getterOf(mediaProto, 'currentSrc');
  const srcOf = getterOf(mediaProto, 'src');
  const crossOriginOf = getterOf(mediaProto, 'crossOrigin');
  const mediaKeysOf = getterOf(mediaProto, 'mediaKeys');
  const sinkIdOf = getterOf(mediaProto, 'sinkId');
  const audioTracksOf = StreamClass ? methodOf(StreamClass.prototype, 'getAudioTracks') : undefined;
  const addListener = realm.EventTarget.prototype.addEventListener;
  const dispatch = realm.EventTarget.prototype.dispatchEvent;
  const EventClass = realm.Event;
  if (!nativeConnect || !nativeDisconnect || !contextOfNode || !createElementSource || !stateOf || !pausedOf || !mutedOf || !setMuted || !volumeOf || !setVolume) {
    return false;
  }

  const read = <T>(getter: Getter | undefined, target: unknown, fallback: T): T => {
    if (!getter) return fallback;
    try {
      return apply(getter, target, []) as T;
    } catch {
      return fallback;
    }
  };
  const connect = (from: AudioNode, to: AudioNode, output = 0, input = 0): void => {
    apply(nativeConnect, from, [to, output, input]);
  };
  const disconnect = (node: AudioNode, ...args: unknown[]): void => {
    try {
      apply(nativeDisconnect, node, args);
    } catch {
      /* was not connected */
    }
  };
  const listen = (target: EventTarget, type: string, handler: (event: Event) => void, capture = false): void => {
    apply(addListener, target, [type, handler, capture]);
  };
  const isRunning = (context: BaseAudioContext): boolean => read<string>(stateOf, context, 'closed') === 'running';

  // ---- processing chain ---------------------------------------------------------

  let current: TabAudioSettings | null = initial;

  let clipCurve: Float32Array<ArrayBuffer> | null = null;
  const softClipCurve = (): Float32Array<ArrayBuffer> => {
    if (clipCurve) return clipCurve;
    const size = 16385;
    const curve = new Float32Array(size);
    for (let i = 0; i < size; i++) {
      const sample = ((i / (size - 1)) * 2 - 1) * HEADROOM;
      const magnitude = Math.abs(sample);
      const shaped = magnitude <= KNEE ? magnitude : KNEE + (1 - KNEE) * Math.tanh((magnitude - KNEE) / (1 - KNEE));
      curve[i] = Math.sign(sample) * shaped;
    }
    clipCurve = curve;
    return curve;
  };

  const stage = (first: AudioNode, last: AudioNode = first): Stage => ({ first, last });

  const buildStages = (context: BaseAudioContext): Stages => {
    const monoDown = new GainNode(context, { channelCount: 1, channelCountMode: 'explicit', channelInterpretation: 'speakers' });
    const monoUp = new GainNode(context, { channelCount: 2, channelCountMode: 'explicit', channelInterpretation: 'speakers' });
    connect(monoDown, monoUp);
    const splitter = new ChannelSplitterNode(context, { numberOfOutputs: 2 });
    const left = new GainNode(context);
    const right = new GainNode(context);
    const merger = new ChannelMergerNode(context, { numberOfInputs: 2 });
    connect(splitter, left, 0);
    connect(splitter, right, 1);
    connect(left, merger, 0, 0);
    connect(right, merger, 0, 1);
    const bass = new BiquadFilterNode(context, { type: 'lowshelf', frequency: 90, gain: 0 });
    const bands = EQ.map(
      (frequency, i) =>
        new BiquadFilterNode(context, {
          type: i === 0 ? 'lowshelf' : i === EQ.length - 1 ? 'highshelf' : 'peaking',
          frequency,
          Q: 1.41,
          gain: 0,
        }),
    );
    // Gentle: evens out loud ads / quiet dialogue without pumping.
    const compressor = new DynamicsCompressorNode(context, { threshold: -24, knee: 24, ratio: 3, attack: 0.006, release: 0.25 });
    const volume = new GainNode(context);
    const headroom = new GainNode(context, { gain: 1 / HEADROOM });
    const shaper = new WaveShaperNode(context, { curve: softClipCurve(), oversample: 'none' });
    connect(headroom, shaper);
    return {
      mono: stage(monoDown, monoUp),
      balance: stage(splitter, merger),
      left,
      right,
      bass,
      bassStage: stage(bass),
      bands,
      bandStages: bands.map((band) => stage(band)),
      compressor,
      compressorStage: stage(compressor),
      volume,
      volumeStage: stage(volume),
      limiter: stage(headroom, shaper),
    };
  };

  const setParam = (chain: Chain, param: AudioParam, value: number, fresh: boolean): void => {
    if (fresh || !isRunning(chain.context)) {
      param.cancelScheduledValues(0);
      param.value = value;
      return;
    }
    const now = read(timeOf, chain.context, 0);
    param.cancelAndHoldAtTime(now);
    param.setTargetAtTime(value, now, SMOOTHING);
  };

  const wire = (chain: Chain, list: Stage[]): void => {
    if (list.length === chain.wired.length && list.every((entry, i) => entry === chain.wired[i])) return;
    disconnect(chain.input);
    for (const entry of chain.wired) disconnect(entry.last);
    let tail: AudioNode = chain.input;
    for (const entry of list) {
      connect(tail, entry.first);
      tail = entry.last;
    }
    connect(tail, chain.output);
    chain.wired = list;
  };

  const boosts = (settings: TabAudioSettings): boolean =>
    settings.volume > 1 || settings.bassBoost.gain > 0 || settings.compressor || (settings.eqEnabled && settings.bands.some((gain) => gain > 0));

  const applyChain = (chain: Chain): void => {
    const settings = current;
    // Explicit stereo up/down-mix only while processing (balance and mono need two channels).
    chain.input.channelCountMode = settings ? 'explicit' : 'max';
    if (!settings) {
      wire(chain, []);
      return;
    }
    const fresh = !chain.stages;
    const stages = (chain.stages ??= buildStages(chain.context));
    setParam(chain, stages.left.gain, Math.min(1, 1 - settings.balance), fresh);
    setParam(chain, stages.right.gain, Math.min(1, 1 + settings.balance), fresh);
    setParam(chain, stages.bass.gain, settings.bassBoost.gain, fresh);
    setParam(chain, stages.bass.frequency, settings.bassBoost.frequency, fresh);
    stages.bands.forEach((band, i) => setParam(chain, band.gain, settings.bands[i] ?? 0, fresh));
    setParam(chain, stages.volume.gain, settings.volume, fresh);

    const list: Stage[] = [];
    if (settings.mono) list.push(stages.mono);
    if (settings.balance !== 0) list.push(stages.balance);
    if (settings.bassBoost.gain > 0) list.push(stages.bassStage);
    if (settings.eqEnabled) settings.bands.forEach((gain, i) => gain !== 0 && list.push(stages.bandStages[i]!));
    if (settings.compressor) list.push(stages.compressorStage);
    if (settings.volume !== 1) list.push(stages.volumeStage);
    if (boosts(settings)) list.push(stages.limiter);
    wire(chain, list);
  };

  const makeChain = (context: BaseAudioContext, destination: AudioNode): Chain => {
    const input = new GainNode(context, { channelCount: 2, channelCountMode: 'max', channelInterpretation: 'speakers' });
    const output = new GainNode(context);
    connect(input, output);
    connect(output, destination);
    const chain: Chain = { context, input, output, stages: null, wired: [], meter: null, metering: false };
    applyChain(chain);
    return chain;
  };

  // ---- levels ---------------------------------------------------------------

  const EDGES = Array.from({ length: SPECTRUM_BINS + 1 }, (_, i) => 20 * Math.pow(1000, i / SPECTRUM_BINS));

  const meterOn = (chain: Chain): void => {
    if (chain.metering) return;
    if (!chain.meter) {
      const options = { fftSize: FFT_SIZE, smoothingTimeConstant: 0.5 };
      const splitter = new ChannelSplitterNode(chain.context, { numberOfOutputs: 2 });
      const left = new AnalyserNode(chain.context, options);
      const right = new AnalyserNode(chain.context, options);
      connect(splitter, left, 0);
      connect(splitter, right, 1);
      chain.meter = {
        splitter,
        left,
        right,
        time: new Float32Array(FFT_SIZE),
        freqL: new Float32Array(FFT_SIZE / 2),
        freqR: new Float32Array(FFT_SIZE / 2),
      };
    }
    connect(chain.output, chain.meter.splitter);
    chain.metering = true;
  };

  const meterOff = (chain: Chain): void => {
    if (!chain.metering || !chain.meter) return;
    disconnect(chain.output, chain.meter.splitter);
    chain.metering = false;
  };

  const peakOf = (meter: Meter, analyser: AnalyserNode): number => {
    analyser.getFloatTimeDomainData(meter.time);
    let peak = 0;
    for (let i = 0; i < meter.time.length; i++) {
      const sample = Math.abs(meter.time[i]!);
      if (sample > peak) peak = sample;
    }
    return peak;
  };

  const addSpectrum = (chain: Chain, meter: Meter, into: number[]): void => {
    meter.left.getFloatFrequencyData(meter.freqL);
    meter.right.getFloatFrequencyData(meter.freqR);
    const binHz = read(rateOf, chain.context, 48000) / FFT_SIZE;
    const last = meter.freqL.length - 1;
    for (let bin = 0; bin < SPECTRUM_BINS; bin++) {
      const low = Math.min(last, Math.max(1, Math.floor(EDGES[bin]! / binHz)));
      const high = Math.min(last, Math.max(low, Math.ceil(EDGES[bin + 1]! / binHz) - 1));
      let loudest = -Infinity;
      for (let i = low; i <= high; i++) loudest = Math.max(loudest, meter.freqL[i]!, meter.freqR[i]!);
      const level = Math.min(1, Math.max(0, (loudest + 90) / 80));
      if (level > into[bin]!) into[bin] = level;
    }
  };

  // ---- contexts ---------------------------------------------------------------

  let processing: { context: AudioContext; chain: Chain } | null = null;
  const pageChains = new WeakMap<BaseAudioContext, Chain>();
  const pageChainList = new Set<Chain>();

  const allChains = (): Chain[] => {
    for (const chain of pageChainList) if (read(stateOf, chain.context, 'closed') === 'closed') pageChainList.delete(chain);
    const list = [...pageChainList];
    if (processing) list.push(processing.chain);
    return list;
  };

  const pendingEngage = new Set<Media>();

  const ensureProcessing = (): { context: AudioContext; chain: Chain } | null => {
    if (processing && read(stateOf, processing.context, 'closed') !== 'closed') return processing;
    try {
      const context = new ContextClass({ latencyHint: 'interactive' });
      // A normal `destination` read: an audio-devices route installed in this realm steers the context.
      const chain = makeChain(context, context.destination);
      processing = { context, chain };
      listen(context, 'statechange', () => {
        if (!isRunning(context)) return;
        for (const element of pendingEngage) engage(element);
      });
      return processing;
    } catch {
      return null;
    }
  };

  /** Page AudioContext destination → its chain (created on first use). Never for offline contexts. */
  const chainForDestination = (destination: AudioDestinationNode): Chain | null => {
    const context = read<BaseAudioContext | null>(contextOfNode, destination, null);
    if (!context || !(context instanceof ContextClass) || context === processing?.context) return null;
    const existing = pageChains.get(context);
    if (existing) return existing;
    try {
      const chain = makeChain(context, destination);
      pageChains.set(context, chain);
      pageChainList.add(chain);
      return chain;
    } catch {
      return null;
    }
  };

  // ---- media elements -------------------------------------------------------

  const routed = new WeakMap<Media, Routed>();
  /** Elements the page captured into its own graph: their audio reaches us through the page context. */
  const pageCaptured = new WeakSet<Media>();
  const probing = new WeakSet<Media>();
  const partial = new WeakSet<Media>();
  const partialRefs = new Set<WeakRef<Media>>();
  /** Page-facing volume of partial elements (the native one is scaled by the tab volume). */
  const pageVolumes = new WeakMap<Media, number>();
  /** Page-facing `muted` of engaged MediaStream elements (the native one is forced on). */
  const pageMuted = new WeakMap<Media, boolean>();
  const watched = new WeakSet<Media>();
  const playing = new Set<Media>();
  const probes = new Map<string, Promise<boolean>>();
  let idleTimer: ReturnType<typeof setTimeout> | null = null;

  const volumeFactor = (): number => (current ? Math.min(1, current.volume) : 1);

  const scaleVolume = (element: Media): void => {
    const wanted = (pageVolumes.get(element) ?? 1) * volumeFactor();
    if (read(volumeOf, element, wanted) !== wanted) apply(setVolume, element, [wanted]);
  };

  const markPartial = (element: Media): void => {
    if (!partial.has(element)) {
      pageVolumes.set(element, read(volumeOf, element, 1));
      partial.add(element);
      partialRefs.add(new WeakRefClass(element));
    }
    scaleVolume(element);
  };

  const unmarkPartial = (element: Media): void => {
    if (!partial.has(element)) return;
    partial.delete(element);
    const volume = pageVolumes.get(element) ?? 1;
    pageVolumes.delete(element);
    if (read(volumeOf, element, volume) !== volume) apply(setVolume, element, [volume]);
  };

  const wake = (): void => {
    if (idleTimer !== null) {
      clearTimer(idleTimer);
      idleTimer = null;
    }
    if (processing && read<string>(stateOf, processing.context, '') === 'suspended') {
      (apply(resumeContext, processing.context, []) as Promise<void>).catch(() => undefined);
    }
  };

  /** Nothing captured is playing: suspend the processing context so it costs no CPU. */
  const sleepSoon = (): void => {
    if (playing.size > 0 || idleTimer !== null || !processing) return;
    idleTimer = setTimer(() => {
      idleTimer = null;
      if (playing.size === 0 && processing && isRunning(processing.context)) {
        (apply(suspendContext, processing.context, []) as Promise<void>).catch(() => undefined);
      }
    }, IDLE_SUSPEND_MS);
  };

  const syncStreamGain = (element: Media): void => {
    const entry = routed.get(element);
    if (!entry?.gain || !entry.engaged) return;
    const silent = pageMuted.get(element) === true || read(pausedOf, element, true);
    entry.gain.gain.value = silent ? 0 : read(volumeOf, element, 1);
  };

  const started = (element: Media): void => {
    playing.add(element);
    wake();
  };

  const stopped = (element: Media): void => {
    playing.delete(element);
    sleepSoon();
  };

  const watch = (element: Media): void => {
    if (watched.has(element)) return;
    watched.add(element);
    const onStart = (): void => {
      if (!routed.has(element)) return;
      started(element);
      syncStreamGain(element);
    };
    const onStop = (): void => {
      stopped(element);
      syncStreamGain(element);
    };
    listen(element, 'play', onStart);
    listen(element, 'playing', onStart);
    for (const type of ['pause', 'ended', 'emptied']) listen(element, type, onStop);
  };

  /** Take over a MediaStream element's output once the processing context really runs. */
  const engage = (element: Media): void => {
    const entry = routed.get(element);
    if (!entry || entry.engaged || !processing || !isRunning(processing.context)) return;
    pendingEngage.delete(element);
    pageMuted.set(element, read(mutedOf, element, false));
    entry.engaged = true;
    apply(setMuted, element, [true]);
    syncStreamGain(element);
  };

  const releaseStream = (element: Media): void => {
    const entry = routed.get(element);
    if (!entry?.stream) return;
    routed.delete(element);
    pendingEngage.delete(element);
    disconnect(entry.source);
    if (entry.gain) disconnect(entry.gain);
    if (entry.engaged) apply(setMuted, element, [pageMuted.get(element) === true]);
    pageMuted.delete(element);
    stopped(element);
  };

  const captureElement = (element: Media): void => {
    const target = ensureProcessing();
    if (!target) return markPartial(element);
    let source: AudioNode;
    try {
      source = apply(createElementSource, target.context, [element]) as AudioNode;
    } catch {
      // Already captured elsewhere (another realm's context): leave it alone.
      return markPartial(element);
    }
    connect(source, target.chain.input);
    unmarkPartial(element);
    routed.set(element, { source, gain: null, stream: null, engaged: true, bridge: null });
    watch(element);
    if (!read(pausedOf, element, true)) started(element);
  };

  const captureStream = (element: Media, stream: MediaStream): void => {
    const tracks = audioTracksOf ? (apply(audioTracksOf, stream, []) as MediaStreamTrack[]) : [];
    if (tracks.length === 0) {
      listen(stream, 'addtrack', () => consider(element));
      return;
    }
    const target = ensureProcessing();
    if (!target) return markPartial(element);
    let source: AudioNode;
    try {
      source = apply(createStreamSource, target.context, [stream]) as AudioNode;
    } catch {
      return markPartial(element);
    }
    const gain = new GainNode(target.context, { gain: 0 });
    connect(source, gain);
    connect(gain, target.chain.input);
    unmarkPartial(element);
    routed.set(element, { source, gain, stream, engaged: false, bridge: null });
    watch(element);
    if (!read(pausedOf, element, true)) started(element);
    pendingEngage.add(element);
    engage(element);
  };

  /** True when a same-origin URL does not redirect to another origin (Web Audio would get silence). */
  const probe = (url: string): Promise<boolean> => {
    const cached = probes.get(url);
    if (cached) return cached;
    if (probes.size > 256) probes.clear();
    const pending = nativeFetch
      ? (apply(nativeFetch, realm, [url, { method: 'HEAD', mode: 'same-origin', credentials: 'same-origin' }]) as Promise<Response>).then(
          () => true,
          () => false,
        )
      : Promise.resolve(false);
    probes.set(url, pending);
    return pending;
  };

  const devicesRouted = (): boolean => !!(realm as unknown as Record<symbol, unknown>)[Symbol.for('vela.media-route')];

  /** Decide (once per source) how a playing element is processed. */
  const consider = (element: Media): void => {
    const entry = routed.get(element);
    if (entry) {
      if (!entry.stream || read(srcObjectOf, element, null) === entry.stream) return;
      releaseStream(element);
    }
    if (!current || pageCaptured.has(element) || probing.has(element)) return;
    // Muted elements (background videos) cost nothing until the page unmutes them.
    if (read(mutedOf, element, false)) return;
    // Encrypted media and page-chosen output devices cannot go through the shared context.
    if (read(mediaKeysOf, element, null) || (!devicesRouted() && read(sinkIdOf, element, '') !== '')) return markPartial(element);
    const object = read<unknown>(srcObjectOf, element, null);
    if (object) {
      if (StreamClass && object instanceof StreamClass) return captureStream(element, object);
      return captureElement(element);
    }
    const url = read(currentSrcOf, element, '') || read(srcOf, element, '');
    if (!url) return;
    let parsed: URL;
    try {
      parsed = new URLClass(url, realm.location.href);
    } catch {
      return markPartial(element);
    }
    if (parsed.protocol === 'blob:' || parsed.protocol === 'data:') return captureElement(element);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return markPartial(element);
    if (read(crossOriginOf, element, null) !== null) return captureElement(element);
    if (parsed.origin !== realm.location.origin) return markPartial(element);
    markPartial(element);
    probing.add(element);
    void probe(parsed.href).then((readable) => {
      probing.delete(element);
      if (!readable || !current || routed.has(element) || pageCaptured.has(element)) return;
      const now = read(currentSrcOf, element, '') || read(srcOf, element, '');
      if (now && now !== parsed.href) return consider(element);
      captureElement(element);
    });
  };

  const safely = (run: () => void): void => {
    try {
      run();
    } catch {
      /* never break the page */
    }
  };

  const onMediaEvent = (event: Event): void => {
    const target = event.target;
    if (target instanceof MediaClass) safely(() => consider(target));
  };

  const sweep = (): void => {
    for (const element of realm.document.querySelectorAll('audio, video')) {
      if (element instanceof MediaClass && !read(pausedOf, element, true)) consider(element);
    }
  };

  // ---- patches ----------------------------------------------------------------

  wrapMethod(mediaProto, 'play', (original) =>
    function (this: unknown, ...args: unknown[]) {
      if (this instanceof MediaClass) {
        const element = this;
        safely(() => {
          if (routed.has(element)) wake();
          consider(element);
        });
      }
      return apply(original, this, args);
    },
  );

  wrapAccessor(
    mediaProto,
    'volume',
    (original) =>
      function (this: unknown) {
        if (this instanceof MediaClass && partial.has(this)) return pageVolumes.get(this) ?? 1;
        return apply(original, this, []);
      },
    (original) =>
      function (this: unknown, value: unknown) {
        if (this instanceof MediaClass && partial.has(this)) {
          const volume = Number(value);
          // Out of range / non-finite: let the native setter throw its own error.
          if (!(volume >= 0 && volume <= 1)) return void apply(original, this, [value]);
          pageVolumes.set(this, volume);
          return void apply(original, this, [volume * volumeFactor()]);
        }
        apply(original, this, [value]);
        if (this instanceof MediaClass) {
          const element = this;
          safely(() => syncStreamGain(element));
        }
      },
  );

  wrapAccessor(
    mediaProto,
    'muted',
    (original) =>
      function (this: unknown) {
        if (this instanceof MediaClass && pageMuted.has(this)) return pageMuted.get(this);
        return apply(original, this, []);
      },
    (original) =>
      function (this: unknown, value: unknown) {
        if (this instanceof MediaClass && pageMuted.has(this)) {
          const muted = !!value;
          if (pageMuted.get(this) === muted) return;
          pageMuted.set(this, muted);
          syncStreamGain(this);
          apply(dispatch, this, [new EventClass('volumechange')]);
          return;
        }
        apply(original, this, [value]);
        if (this instanceof MediaClass && !value) {
          const element = this;
          safely(() => {
            if (!read(pausedOf, element, true)) consider(element);
          });
        }
      },
  );

  /** A page choosing its own output device for a WebRTC element gets the element back. */
  wrapMethod(mediaProto, 'setSinkId', (original) =>
    function (this: unknown, ...args: unknown[]) {
      const id = args[0];
      if (this instanceof MediaClass && typeof id === 'string' && id !== '' && id !== 'default' && !devicesRouted()) {
        const element = this;
        safely(() => {
          if (!routed.get(element)?.stream) return;
          releaseStream(element);
          markPartial(element);
        });
      }
      return apply(original, this, args);
    },
  );

  /**
   * The page wants its own source node for an element: when the engine already captured it (capture
   * is permanent), hand out a MediaStream bridge from the processing context instead of throwing.
   */
  const pageElementSource = (context: unknown, element: unknown, create: () => unknown): unknown => {
    if (element instanceof MediaClass) {
      const entry = routed.get(element);
      if (entry && processing && context !== processing.context && context instanceof ContextClass) {
        if (!entry.bridge) {
          entry.bridge = apply(createStreamDestination, processing.context, []) as MediaStreamAudioDestinationNode;
          const out = entry.gain ?? entry.source;
          disconnect(out);
          connect(out, entry.bridge);
        }
        return apply(createStreamSource, context, [entry.bridge.stream]);
      }
    }
    const node = create();
    if (element instanceof MediaClass) pageCaptured.add(element);
    return node;
  };

  wrapMethod(contextProto, 'createMediaElementSource', (original) =>
    function (this: unknown, ...args: unknown[]) {
      return pageElementSource(this, args[0], () => apply(original, this, args));
    },
  );

  const SourceClass = realm.MediaElementAudioSourceNode;
  const sourceDescriptor = getDescriptor(realm, 'MediaElementAudioSourceNode');
  if (SourceClass && sourceDescriptor && 'value' in sourceDescriptor) {
    const proxy: typeof SourceClass = new Proxy(SourceClass, {
      construct(target, args, newTarget) {
        const options = args[1] as { mediaElement?: unknown } | undefined;
        return pageElementSource(args[0], options?.mediaElement, () =>
          Reflect.construct(target, args, newTarget === proxy ? target : newTarget),
        ) as object;
      },
    });
    sources.set(proxy, apply(nativeToString, SourceClass, []) as string);
    defineProperty(realm, 'MediaElementAudioSourceNode', { ...sourceDescriptor, value: proxy });
  }

  /** Page graphs: whatever connects to a realtime context's destination enters that context's chain. */
  wrapMethod(nodeProto, 'connect', (original) =>
    function (this: unknown, ...args: unknown[]) {
      const target = args[0];
      if (target instanceof DestinationClass) {
        const chain = chainForDestination(target);
        if (chain) {
          apply(original, this, [chain.input, ...args.slice(1)]);
          return target;
        }
      }
      return apply(original, this, args);
    },
  );

  wrapMethod(nodeProto, 'disconnect', (original) =>
    function (this: unknown, ...args: unknown[]) {
      const target = args[0];
      const context = target instanceof DestinationClass ? read<BaseAudioContext | null>(contextOfNode, target, null) : null;
      const chain = context ? pageChains.get(context) : undefined;
      if (!chain) return apply(original, this, args);
      try {
        return apply(original, this, [chain.input, ...args.slice(1)]);
      } catch {
        // Connected before the engine was installed: disconnect the real destination.
        return apply(original, this, args);
      }
    },
  );

  listen(realm.document, 'play', onMediaEvent, true);
  listen(realm.document, 'playing', onMediaEvent, true);

  // ---- handle -------------------------------------------------------------------

  let meterTimer: ReturnType<typeof setTimeout> | null = null;

  const routing = (chains: Chain[]): RealmAudioReport['routing'] => {
    for (const ref of partialRefs) {
      const element = ref.deref();
      if (!element || !partial.has(element)) partialRefs.delete(ref);
      else if (!read(pausedOf, element, true)) return 'partial';
    }
    return chains.length > 0 ? 'full' : 'idle';
  };

  const handle: MixerEngineHandle = {
    update(next) {
      safely(() => {
        const wasNeutral = !current;
        current = next;
        for (const chain of allChains()) applyChain(chain);
        for (const ref of partialRefs) {
          const element = ref.deref();
          if (element && partial.has(element)) scaleVolume(element);
          else partialRefs.delete(ref);
        }
        if (wasNeutral && next) sweep();
      });
    },
    report(levels) {
      const chains = allChains();
      const report: RealmAudioReport = { routing: routing(chains) };
      if (!levels) return report;
      if (meterTimer !== null) clearTimer(meterTimer);
      meterTimer = setTimer(() => {
        meterTimer = null;
        for (const chain of allChains()) meterOff(chain);
      }, METER_IDLE_MS);
      let peakL = 0;
      let peakR = 0;
      const spectrum = new Array<number>(SPECTRUM_BINS).fill(0);
      for (const chain of chains) {
        try {
          const wasMetering = chain.metering;
          meterOn(chain);
          if (!wasMetering || !chain.meter || !isRunning(chain.context)) continue;
          peakL = Math.max(peakL, peakOf(chain.meter, chain.meter.left));
          peakR = Math.max(peakR, peakOf(chain.meter, chain.meter.right));
          addSpectrum(chain, chain.meter, spectrum);
        } catch {
          /* context closed meanwhile */
        }
      }
      return { ...report, peakL, peakR, spectrum };
    },
    touch() {
      safely(() => {
        if (processing) void processing.context.destination;
      });
    },
  };
  defineProperty(realm, KEY, { value: Object.freeze(handle) });

  safely(sweep);
  return true;
}

/** Main → frame: swap the settings of an installed engine. False when the realm has none. */
export function updateTabAudio(settings: TabAudioSettings | null): boolean {
  const handle = (globalThis as unknown as Record<symbol, MixerEngineHandle | undefined>)[Symbol.for('vela.mixer')];
  if (!handle) return false;
  handle.update(settings);
  return true;
}

/** Main → frame: routing (and levels) of this realm; null when it has no engine. */
export function reportTabAudio(levels: boolean): RealmAudioReport | null {
  const handle = (globalThis as unknown as Record<symbol, MixerEngineHandle | undefined>)[Symbol.for('vela.mixer')];
  return handle ? handle.report(levels) : null;
}

/** Main → frame: let a live audio-devices route steer the processing context. */
export function touchTabAudio(): void {
  (globalThis as unknown as Record<symbol, MixerEngineHandle | undefined>)[Symbol.for('vela.mixer')]?.touch();
}
