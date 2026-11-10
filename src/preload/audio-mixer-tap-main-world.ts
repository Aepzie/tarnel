import type { MixerEngineHandle, MixerTapHandle, RealmAudioReport } from '../shared/audio-mixer-engine';

type TapReport = RealmAudioReport & { found: boolean };

/**
 * Level-only tap for one realm (frame), run by main with WebFrameMain.executeJavaScript in the page's
 * MAIN world while the mixer panel is open. It meters playing media the engine does not process (tabs
 * the user never touched, media the engine had to leave native), so an untouched tab still shows live
 * meters. Nothing is rerouted: `captureStream()` copies the element's audio, the element keeps playing
 * natively, and the copy only feeds analysers in a context with no output. Self-contained (serialized
 * with Function.prototype.toString).
 *
 * `read` installs the tap on demand: a realm without playing media gets nothing and reports
 * `found: false`. The tap releases itself (tracks stopped, context closed) 2 s after the last read, so a
 * closed panel or a crashed chrome leaves nothing running. Media it cannot copy (cross-origin without
 * CORS, encrypted) and page AudioContexts are not metered.
 */
export function tapTabAudio(command: 'read' | 'release'): TapReport | null {
  type Media = HTMLMediaElement & { captureStream?: () => MediaStream };
  interface Tapped {
    stream: MediaStream;
    track: MediaStreamTrack;
    source: MediaStreamAudioSourceNode;
    gain: GainNode;
  }

  const KEY = Symbol.for('vela.mixer-tap');
  const host = globalThis as unknown as Record<symbol, MixerTapHandle | undefined>;
  const existing = host[KEY];
  if (command === 'release') {
    existing?.release();
    return null;
  }
  if (existing) return existing.read();

  const realm = globalThis;
  const silent: TapReport = { routing: 'idle', found: false };
  if (!realm.document || !realm.AudioContext || !realm.HTMLMediaElement) return silent;

  const RELEASE_MS = 2_000;
  const RETRY_MS = 1_000;
  const FFT_SIZE = 2048;
  const SPECTRUM_BINS = 16;
  const EDGES = Array.from({ length: SPECTRUM_BINS + 1 }, (_, i) => 20 * Math.pow(1000, i / SPECTRUM_BINS));
  const engine = (): MixerEngineHandle | undefined =>
    (realm as unknown as Record<symbol, MixerEngineHandle | undefined>)[Symbol.for('vela.mixer')];

  const audibleMedia = (): Media[] => {
    const list: Media[] = [];
    for (const element of realm.document.querySelectorAll('audio, video')) {
      const media = element as Media;
      if (media.paused || media.muted || media.volume === 0) continue;
      if (engine()?.owns(media)) continue;
      list.push(media);
    }
    return list;
  };

  if (audibleMedia().length === 0) return silent;

  let context: AudioContext;
  try {
    context = new realm.AudioContext({ latencyHint: 'playback' });
  } catch {
    return silent;
  }
  const sum = new GainNode(context);
  const splitter = new ChannelSplitterNode(context, { numberOfOutputs: 2 });
  const left = new AnalyserNode(context, { fftSize: FFT_SIZE, smoothingTimeConstant: 0.5 });
  const right = new AnalyserNode(context, { fftSize: FFT_SIZE, smoothingTimeConstant: 0.5 });
  sum.connect(splitter);
  splitter.connect(left, 0);
  splitter.connect(right, 1);
  const time = new Float32Array(FFT_SIZE);
  const freqL = new Float32Array(FFT_SIZE / 2);
  const freqR = new Float32Array(FFT_SIZE / 2);

  const tapped = new Map<Media, Tapped>();
  const failed = new WeakMap<Media, number>();
  let releaseTimer: ReturnType<typeof setTimeout> | null = null;
  let released = false;

  const untap = (element: Media): void => {
    const entry = tapped.get(element);
    if (!entry) return;
    tapped.delete(element);
    try {
      entry.source.disconnect();
      entry.gain.disconnect();
    } catch {
      /* context closed */
    }
    for (const track of entry.stream.getTracks()) track.stop();
  };

  const tap = (element: Media): void => {
    const lastFailure = failed.get(element);
    if (lastFailure !== undefined && Date.now() - lastFailure < RETRY_MS) return;
    try {
      const stream = element.captureStream?.();
      if (!stream) throw new Error('no capture');
      for (const track of stream.getVideoTracks()) track.stop();
      const track = stream.getAudioTracks()[0];
      if (!track) {
        for (const other of stream.getTracks()) other.stop();
        throw new Error('no audio yet');
      }
      const source = new MediaStreamAudioSourceNode(context, { mediaStream: stream });
      const gain = new GainNode(context, { gain: element.volume });
      source.connect(gain);
      gain.connect(sum);
      tapped.set(element, { stream, track, source, gain });
    } catch {
      failed.set(element, Date.now());
    }
  };

  const peakOf = (analyser: AnalyserNode): number => {
    analyser.getFloatTimeDomainData(time);
    let peak = 0;
    for (let i = 0; i < time.length; i++) {
      const sample = Math.abs(time[i]!);
      if (sample > peak) peak = sample;
    }
    return peak;
  };

  const spectrumOf = (): number[] => {
    left.getFloatFrequencyData(freqL);
    right.getFloatFrequencyData(freqR);
    const binHz = context.sampleRate / FFT_SIZE;
    const last = freqL.length - 1;
    const bins: number[] = [];
    for (let bin = 0; bin < SPECTRUM_BINS; bin++) {
      const low = Math.min(last, Math.max(1, Math.floor(EDGES[bin]! / binHz)));
      const high = Math.min(last, Math.max(low, Math.ceil(EDGES[bin + 1]! / binHz) - 1));
      let loudest = -Infinity;
      for (let i = low; i <= high; i++) loudest = Math.max(loudest, freqL[i]!, freqR[i]!);
      bins.push(Math.min(1, Math.max(0, (loudest + 90) / 80)));
    }
    return bins;
  };

  const release = (): void => {
    if (released) return;
    released = true;
    if (releaseTimer !== null) clearTimeout(releaseTimer);
    for (const element of [...tapped.keys()]) untap(element);
    void context.close().catch(() => undefined);
    delete host[KEY];
  };

  const read = (): TapReport => {
    if (released) return silent;
    if (releaseTimer !== null) clearTimeout(releaseTimer);
    releaseTimer = setTimeout(release, RELEASE_MS);
    const wanted = new Set(audibleMedia());
    for (const [element, entry] of tapped) {
      const keep = wanted.has(element) || (!element.isConnected && !element.paused && !element.muted);
      if (!keep || entry.track.readyState === 'ended') untap(element);
    }
    for (const element of wanted) {
      const entry = tapped.get(element);
      if (entry) entry.gain.gain.value = element.volume;
      else tap(element);
    }
    if (tapped.size === 0) return silent;
    if (context.state === 'suspended') void context.resume().catch(() => undefined);
    return { routing: 'idle', found: true, peakL: peakOf(left), peakR: peakOf(right), spectrum: spectrumOf() };
  };

  const handle: MixerTapHandle = { read, release };
  Object.defineProperty(host, KEY, { value: handle, configurable: true });
  return read();
}
