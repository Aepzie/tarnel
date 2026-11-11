import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';

/**
 * Private working set per process on Windows: the number Task Manager's "Memory" column shows
 * (sum over an app's processes = its group row). Electron's `getAppMetrics()` only has the working
 * set (shared pages counted per process) and private commit (`privateBytes`, includes memory that is
 * paged out or never touched), and Node cannot call Win32 directly. So a small PowerShell helper
 * reads `PROCESS_MEMORY_COUNTERS_EX2.PrivateWorkingSetSize` (K32GetProcessMemoryInfo; Windows 10
 * 20H1+) for the pids it is sent on stdin, one request per line.
 *
 * Cost: started lazily on the first request (~0.4 s CPU once), then ~1–2 ms CPU per sample; it trims
 * its own working set after every answer (~5 MB private WS while idle). It exits after
 * `IDLE_EXIT_MS` without requests (window hidden, panel closed) and when Vela quits (stdin closes),
 * so it costs nothing while nobody looks at memory. Any failure → callers fall back to private
 * commit; after `MAX_FAILURES` the helper is not tried again this session.
 */

const IDLE_EXIT_MS = 20_000;
const REPLY_TIMEOUT_MS = 3_000;
const MAX_FAILURES = 3;
/** A cached value is used for one-off reads (e.g. "freed by sleeping") while it is this fresh. */
const CACHE_FRESH_MS = 15_000;

/** Language-neutral (perf counter names are localized; the Win32 call is not). No files, no profile. */
export const PRIVATE_WS_SCRIPT = `
$ErrorActionPreference = 'SilentlyContinue'
$t = [AppDomain]::CurrentDomain.DefineDynamicAssembly((New-Object Reflection.AssemblyName 'VelaMem'), 'Run').DefineDynamicModule('VelaMem').DefineType('M', 'Public,Class')
foreach ($f in @(
  @('OpenProcess', [IntPtr], @([UInt32], [bool], [UInt32])),
  @('CloseHandle', [bool], @([IntPtr])),
  @('K32GetProcessMemoryInfo', [bool], @([IntPtr], [UInt64[]], [UInt32])),
  @('K32EmptyWorkingSet', [bool], @([IntPtr])))) {
  $t.DefinePInvokeMethod($f[0], 'kernel32.dll', 'Public,Static,PinvokeImpl', 'Standard', $f[1], [Type[]]$f[2], 'Winapi', 'Auto').SetImplementationFlags('PreserveSig')
}
$m = $t.CreateType()
$self = [Diagnostics.Process]::GetCurrentProcess().Handle
$buf = New-Object UInt64[] 12
while ($true) {
  $line = [Console]::In.ReadLine()
  if ($null -eq $line) { break }
  $out = foreach ($id in $line.Split(' ', [StringSplitOptions]::RemoveEmptyEntries)) {
    $h = $m::OpenProcess(0x1000, $false, [UInt32]$id)
    if ($h -eq [IntPtr]::Zero) { continue }
    $buf[0] = 96
    if ($m::K32GetProcessMemoryInfo($h, $buf, 96)) { "$id=$([UInt64]($buf[10] / 1024))" }
    [void]$m::CloseHandle($h)
  }
  [Console]::Out.WriteLine('ok ' + ($out -join ' '))
  [void]$m::K32EmptyWorkingSet($self)
}
`;

/** Parses one helper answer (`ok 1234=56789 …`, KB per pid); null if it is not an answer. */
export function parsePrivateWsReply(line: string): Map<number, number> | null {
  const trimmed = line.trim();
  if (trimmed !== 'ok' && !trimmed.startsWith('ok ')) return null;
  const result = new Map<number, number>();
  for (const pair of trimmed.slice(2).split(' ')) {
    const match = /^(\d+)=(\d+)$/.exec(pair);
    if (match) result.set(Number(match[1]), Number(match[2]));
  }
  return result;
}

interface Pending {
  resolve: (value: Map<number, number> | null) => void;
  timer: NodeJS.Timeout;
}

let child: ChildProcessWithoutNullStreams | null = null;
let buffered = '';
let pending: Pending[] = [];
let idleTimer: NodeJS.Timeout | null = null;
let failures = 0;
let cache = new Map<number, number>();
let cachedAt = 0;

function settleAll(value: Map<number, number> | null): void {
  const waiting = pending;
  pending = [];
  for (const entry of waiting) {
    clearTimeout(entry.timer);
    entry.resolve(value);
  }
}

function stop(failed: boolean): void {
  if (failed) failures += 1;
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = null;
  const running = child;
  child = null;
  buffered = '';
  settleAll(null);
  if (running && running.exitCode === null) {
    running.stdin.end();
    running.kill();
  }
}

function start(): ChildProcessWithoutNullStreams | null {
  if (child) return child;
  try {
    const encoded = Buffer.from(PRIVATE_WS_SCRIPT, 'utf16le').toString('base64');
    const spawned = spawn('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded], {
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'ignore'] as const,
    }) as unknown as ChildProcessWithoutNullStreams;
    spawned.stdout.setEncoding('utf8');
    spawned.stdout.on('data', (chunk: string) => {
      buffered += chunk;
      let newline = buffered.indexOf('\n');
      while (newline >= 0) {
        const reply = parsePrivateWsReply(buffered.slice(0, newline));
        buffered = buffered.slice(newline + 1);
        if (reply) pending.shift()?.resolve(reply);
        newline = buffered.indexOf('\n');
      }
    });
    spawned.on('error', () => {
      if (child === spawned) stop(true);
    });
    spawned.on('exit', () => {
      if (child === spawned) stop(pending.length > 0);
    });
    spawned.stdin.on('error', () => undefined);
    child = spawned;
    return spawned;
  } catch {
    failures += 1;
    return null;
  }
}

/**
 * Private working set (KB) of `pids`, or null when unavailable (not Windows, helper failed): callers
 * then use their fallback metric. Pids that exited are simply missing from the map.
 */
export function samplePrivateWorkingSetKB(pids: number[]): Promise<Map<number, number> | null> {
  if (process.platform !== 'win32' || failures >= MAX_FAILURES) return Promise.resolve(null);
  const wanted = [...new Set(pids.filter((pid) => Number.isSafeInteger(pid) && pid > 0))];
  if (wanted.length === 0) return Promise.resolve(new Map());
  const helper = start();
  if (!helper) return Promise.resolve(null);
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(() => stop(false), IDLE_EXIT_MS);
  idleTimer.unref();
  return new Promise((resolve) => {
    const timer = setTimeout(() => stop(true), REPLY_TIMEOUT_MS);
    pending.push({
      timer,
      resolve: (value) => {
        clearTimeout(timer);
        if (value) {
          if (value.size > 0) failures = 0;
          cache = value;
          cachedAt = Date.now();
        }
        resolve(value);
      },
    });
    helper.stdin.write(`${wanted.join(' ')}\n`);
  });
}

/** Last sampled value for `pid` if the helper answered recently (no new sample is taken). */
export function cachedPrivateWorkingSetKB(pid: number): number | undefined {
  if (Date.now() - cachedAt > CACHE_FRESH_MS) return undefined;
  return cache.get(pid);
}

/** Stops the helper (app quit). */
export function stopPrivateWorkingSetSampler(): void {
  stop(false);
}
