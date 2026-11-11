/**
 * Translation engine: an Electron utilityProcess (own OS process, no window, no DOM) that runs
 * Mozilla's bergamot-translator WASM (MPL-2.0, vendor/bergamot). Main sends file paths of downloaded
 * models and text batches; nothing here touches the network. Bundled separately (dist/main/translate-engine.js)
 * and only spawned when a page is translated.
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import type { EngineReply, EngineRequest } from './engine-protocol';

interface Disposable {
  delete(): void;
}
interface AlignedMemory extends Disposable {
  getByteArrayView(): Uint8Array;
}
interface VectorOf<T> extends Disposable {
  push_back(value: T): void;
  size(): number;
  get(index: number): T;
}
interface Response {
  getTranslatedText(): string;
}
interface BergamotModule {
  AlignedMemory: new (size: number, alignment: number) => AlignedMemory;
  AlignedMemoryList: new () => VectorOf<AlignedMemory>;
  VectorString: new () => VectorOf<string>;
  VectorResponseOptions: new () => VectorOf<{ qualityScores: boolean; alignment: boolean; html: boolean }>;
  TranslationModel: new (config: string, model: AlignedMemory, shortlist: AlignedMemory, vocabs: VectorOf<AlignedMemory>, quality: null) => Disposable;
  BlockingService: new (options: { cacheSize: number }) => {
    translate(model: Disposable, input: VectorOf<string>, options: VectorOf<unknown>): VectorOf<Response>;
    translateViaPivoting(first: Disposable, second: Disposable, input: VectorOf<string>, options: VectorOf<unknown>): VectorOf<Response>;
  };
  asm: Record<string, (...args: unknown[]) => unknown>;
}

const GEMM_FALLBACKS: Record<string, string> = {
  int8_prepare_a: 'int8PrepareAFallback',
  int8_prepare_b: 'int8PrepareBFallback',
  int8_prepare_b_from_transposed: 'int8PrepareBFromTransposedFallback',
  int8_prepare_b_from_quantized_transposed: 'int8PrepareBFromQuantizedTransposedFallback',
  int8_prepare_bias: 'int8PrepareBiasFallback',
  int8_multiply_and_add_bias: 'int8MultiplyAndAddBiasFallback',
  int8_select_columns_of_b: 'int8SelectColumnsOfBFallback',
};

const MODEL_CONFIG = [
  'beam-size: 1',
  'normalize: 1.0',
  'word-penalty: 0',
  'cpu-threads: 0',
  'gemm-precision: int8shiftAlphaAll',
  'skip-cost: true',
  'alignment: soft',
  'quiet: true',
  'quiet-translation: true',
  'max-length-break: 128',
  'mini-batch-words: 1024',
  'workspace: 128',
  'max-length-factor: 2.0',
].join('\n');

const vendorDir = process.argv[2] ?? '';
const models = new Map<string, Disposable>();
let runtime: Promise<BergamotModule> | null = null;
let service: InstanceType<BergamotModule['BlockingService']> | null = null;

function loadRuntime(): Promise<BergamotModule> {
  runtime ??= new Promise<BergamotModule>((resolve, reject) => {
    const scope = globalThis as unknown as { Module: Partial<BergamotModule> & Record<string, unknown> };
    scope.Module = {
      print: () => undefined,
      printErr: () => undefined,
      instantiateWasm(info: Record<string, unknown>, accept: (instance: WebAssembly.Instance) => void) {
        const gemm = Object.fromEntries(Object.entries(GEMM_FALLBACKS).map(([name, fallback]) => [name, (...args: unknown[]) => (scope.Module.asm as BergamotModule['asm'])[fallback](...args)]));
        const bytes = fs.readFileSync(path.join(vendorDir, 'bergamot-translator-worker.wasm'));
        WebAssembly.instantiate(bytes, { ...info, wasm_gemm: gemm } as WebAssembly.Imports).then(({ instance }) => accept(instance), reject);
        return {};
      },
      onRuntimeInitialized: () => resolve(scope.Module as BergamotModule),
    };
    const glue = fs.readFileSync(path.join(vendorDir, 'bergamot-translator-worker.js'), 'utf8');
    vm.runInThisContext(glue, { filename: 'bergamot-translator-worker.js' });
  });
  return runtime;
}

function aligned(module: BergamotModule, file: string, alignment: number): AlignedMemory {
  const bytes = fs.readFileSync(file);
  const memory = new module.AlignedMemory(bytes.byteLength, alignment);
  memory.getByteArrayView().set(bytes);
  return memory;
}

async function load(key: string, files: { model: string; lex: string; vocabs: string[] }): Promise<void> {
  if (models.has(key)) return;
  const module = await loadRuntime();
  const vocabs = new module.AlignedMemoryList();
  for (const vocab of files.vocabs) vocabs.push_back(aligned(module, vocab, 64));
  models.set(key, new module.TranslationModel(MODEL_CONFIG, aligned(module, files.model, 256), aligned(module, files.lex, 64), vocabs, null));
}

async function translate(chain: string[], texts: string[]): Promise<string[]> {
  const module = await loadRuntime();
  service ??= new module.BlockingService({ cacheSize: 0 });
  const chainModels = chain.map((key) => {
    const model = models.get(key);
    if (!model) throw new Error(`Model not loaded: ${key}`);
    return model;
  });
  const input = new module.VectorString();
  const options = new module.VectorResponseOptions();
  for (const text of texts) {
    input.push_back(text);
    options.push_back({ qualityScores: false, alignment: false, html: false });
  }
  try {
    const responses =
      chainModels.length === 2
        ? service.translateViaPivoting(chainModels[0], chainModels[1], input, options)
        : service.translate(chainModels[0], input, options);
    const out: string[] = [];
    for (let i = 0; i < responses.size(); i++) out.push(responses.get(i).getTranslatedText());
    responses.delete();
    return out;
  } finally {
    input.delete();
    options.delete();
  }
}

async function handle(request: EngineRequest): Promise<EngineReply> {
  try {
    if (request.type === 'load') {
      await load(request.key, request.files);
      return { id: request.id, ok: true };
    }
    if (request.type === 'unload') {
      models.get(request.key)?.delete();
      models.delete(request.key);
      return { id: request.id, ok: true };
    }
    if (request.type === 'memory') return { id: request.id, ok: true, rss: process.memoryUsage().rss };
    return { id: request.id, ok: true, texts: await translate(request.chain, request.texts) };
  } catch (error) {
    return { id: request.id, ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

const port = (process as unknown as { parentPort: { on(event: 'message', cb: (event: { data: EngineRequest }) => void): void; postMessage(message: EngineReply): void } }).parentPort;
let queue: Promise<void> = Promise.resolve();
port.on('message', ({ data }) => {
  queue = queue.then(async () => port.postMessage(await handle(data)));
});
