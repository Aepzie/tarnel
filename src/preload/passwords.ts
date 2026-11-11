import { ipcRenderer } from 'electron';
import { PASSWORD_IPC, type CapturedLogin, type PasswordFrameFlags } from '../shared/passwords';
import { ALIAS_IPC } from '../shared/aliases';
import { isEmailField, isSignUpForm } from '../shared/alias-form';

/**
 * Session preload for the password manager. Runs in every web frame, in the preload's isolated
 * world (page scripts cannot see or patch anything here). Nothing happens until the frame has an
 * <input type=password>: then it asks main once whether saving / filling is on, reports the form
 * (main decides whether saved accounts exist; the page never learns) and captures the credentials
 * of a submitted login form. Filling only happens when main sends an account the user picked in
 * the chrome UI, to this exact frame. Main re-derives the origin from the frame itself.
 */

const isWebFrame = location.protocol === 'https:' || location.protocol === 'http:';
const WATCH_MS = 30_000;
const SCAN_DELAY_MS = 400;

const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;

function visible(input: HTMLInputElement): boolean {
  if (input.disabled || input.type === 'hidden') return false;
  const rect = input.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

function passwordFields(scope: ParentNode): HTMLInputElement[] {
  return [...scope.querySelectorAll<HTMLInputElement>('input[type="password"]')].filter(visible);
}

const USERNAME_HINT = /user|email|login|account|identifier|mail|phone/i;

/** The field a username most likely sits in: autocomplete=username, else the nearest text/email field before the password. */
function usernameField(scope: ParentNode, password: HTMLInputElement): HTMLInputElement | null {
  const inputs = [...scope.querySelectorAll<HTMLInputElement>('input')].filter((input) => visible(input) && /^(text|email|tel|)$/.test(input.type));
  const tagged = inputs.find((input) => /\busername\b/.test(input.autocomplete) || input.autocomplete === 'email');
  if (tagged) return tagged;
  const before = inputs.filter((input) => input.compareDocumentPosition(password) & Node.DOCUMENT_POSITION_FOLLOWING);
  return before.reverse().find((input) => USERNAME_HINT.test(`${input.name} ${input.id} ${input.type}`)) ?? before[0] ?? null;
}

function scopeOf(element: Element): ParentNode {
  return element.closest('form') ?? document;
}

/** Change-password forms: the repeated new password wins; otherwise the first filled field. */
function pickPassword(fields: HTMLInputElement[]): HTMLInputElement | null {
  const filled = fields.filter((field) => field.value.length > 0);
  if (filled.length >= 2 && filled[filled.length - 1].value === filled[filled.length - 2].value) return filled[filled.length - 1];
  return filled[0] ?? null;
}

function setValue(input: HTMLInputElement, value: string): void {
  input.focus({ preventScroll: true });
  if (valueSetter) valueSetter.call(input, value);
  else input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

function startCapture(): void {
  let lastSent = '';
  const capture = (scope: ParentNode): void => {
    const password = pickPassword(passwordFields(scope));
    if (!password) return;
    const login: CapturedLogin = { username: usernameField(scopeOf(password), password)?.value.trim() ?? '', password: password.value };
    const key = `${login.username}\n${login.password}`;
    if (key === lastSent) return;
    lastSent = key;
    ipcRenderer.send(PASSWORD_IPC.frameCaptured, login);
  };
  window.addEventListener('submit', (event) => {
    if (event.target instanceof HTMLFormElement) capture(event.target);
  }, true);
  window.addEventListener('click', (event) => {
    const target = event.target instanceof Element ? event.target.closest('button, input[type="submit"], input[type="button"], [role="button"]') : null;
    if (target) capture(scopeOf(target));
  }, true);
  window.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && event.target instanceof HTMLInputElement) capture(scopeOf(event.target));
  }, true);
}

function startFill(): void {
  ipcRenderer.on(PASSWORD_IPC.frameFill, (_event, login: CapturedLogin) => {
    if (!login || typeof login.password !== 'string') return;
    const focused = document.activeElement instanceof HTMLInputElement ? document.activeElement : null;
    const fields = passwordFields(focused ? scopeOf(focused) : document);
    const password = fields[0] ?? passwordFields(document)[0];
    if (!password) return;
    const username = usernameField(scopeOf(password), password);
    if (username && typeof login.username === 'string' && login.username) setValue(username, login.username);
    setValue(password, login.password);
  });
}

function labelOf(input: HTMLInputElement): string {
  const own = input.labels?.[0]?.textContent ?? '';
  return `${own} ${input.getAttribute('aria-label') ?? ''}`.slice(0, 200);
}

function formText(scope: ParentNode): string {
  const parts = [...scope.querySelectorAll<HTMLElement>('button, input[type="submit"], h1, h2, h3, legend, [role="button"]')]
    .slice(0, 40)
    .map((element) => (element instanceof HTMLInputElement ? element.value : (element.textContent ?? '')));
  if (scope instanceof HTMLFormElement) parts.push(scope.getAttribute('action') ?? '', scope.id, scope.className);
  return parts.join(' ').replace(/\s+/g, ' ').slice(0, 2000);
}

/** Email aliases: offer once per email field of a sign-up form; fill only the field the user focused. */
function startAliases(): void {
  const offered = new WeakSet<HTMLInputElement>();
  let target: HTMLInputElement | null = null;
  const consider = (input: EventTarget | null): void => {
    if (!(input instanceof HTMLInputElement) || !visible(input) || input.readOnly || input.value) return;
    if (!isEmailField({ type: input.type, name: input.name, id: input.id, autocomplete: input.autocomplete, placeholder: input.placeholder, label: labelOf(input) })) return;
    const scope = scopeOf(input);
    const passwords = passwordFields(scope);
    if (!isSignUpForm({ passwords: passwords.length, newPassword: passwords.some((field) => /new-password/.test(field.autocomplete)), text: formText(scope), path: location.pathname })) return;
    target = input;
    if (offered.has(input)) return;
    offered.add(input);
    ipcRenderer.send(ALIAS_IPC.frameFieldSeen);
  };
  window.addEventListener('focusin', (event) => consider(event.target), true);
  ipcRenderer.on(ALIAS_IPC.frameFill, (_event, email: unknown) => {
    if (typeof email !== 'string' || !target || !target.isConnected || target.value) return;
    setValue(target, email);
  });
  consider(document.activeElement);
}

function onLoginForm(): void {
  let flags: PasswordFrameFlags;
  try {
    flags = ipcRenderer.sendSync(PASSWORD_IPC.frameFlags) as PasswordFrameFlags;
  } catch {
    return;
  }
  if (!flags) return;
  if (flags.save) startCapture();
  if (flags.alias) startAliases();
  if (flags.fill) {
    startFill();
    ipcRenderer.send(PASSWORD_IPC.frameFormSeen);
  }
}

function watchForLoginForm(): void {
  let timer: number | null = null;
  let done = false;
  const observer = new MutationObserver(() => schedule());
  const finish = (): void => {
    done = true;
    observer.disconnect();
    if (timer !== null) window.clearTimeout(timer);
  };
  const scan = (): void => {
    timer = null;
    if (done || !document.querySelector('input[type="password"]')) return;
    finish();
    onLoginForm();
  };
  const schedule = (): void => {
    if (done || timer !== null) return;
    timer = window.setTimeout(scan, SCAN_DELAY_MS);
  };
  const begin = (): void => {
    scan();
    if (done || !document.documentElement) return;
    observer.observe(document.documentElement, { childList: true, subtree: true });
    window.setTimeout(finish, WATCH_MS);
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', begin, { once: true });
  else begin();
}

if (isWebFrame) {
  try {
    watchForLoginForm();
  } catch {
    /* never break the page */
  }
}
