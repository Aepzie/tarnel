/**
 * Sign-up form heuristics for email aliases. Pure (the session preload builds the descriptors from
 * the DOM), so they are unit-tested. Login forms must not trigger an alias offer.
 */

export interface FieldHints {
  type: string;
  name: string;
  id: string;
  autocomplete: string;
  placeholder: string;
  label: string;
}

export interface FormHints {
  /** Visible <input type=password> fields in the form. */
  passwords: number;
  /** Some password field has autocomplete="new-password". */
  newPassword: boolean;
  /** Text of buttons, submit inputs, headings and legends in the form, plus its action / id / class. */
  text: string;
  /** Path of the page (e.g. "/signup"). */
  path: string;
}

const EMAIL_HINT = /e-?mail/i;
const SIGN_UP = /sign[\s_-]?up|register|registration|create[\s_-]+(?:an?[\s_-]+|your[\s_-]+|new[\s_-]+)?account|join[\s_-]+(?:now|free|us)|get[\s_-]+started|registrieren|konto[\s_-]+erstellen|créer[\s_-]+un[\s_-]+compte|regístrate|crear[\s_-]+cuenta/iu;
const SIGN_IN = /sign[\s_-]?in|log[\s_-]?in|anmelden|einloggen|connexion|iniciar[\s_-]+sesión/iu;
const NOT_EMAIL_AUTOCOMPLETE = /current-password|new-password|one-time-code|cc-|tel/;

export function isEmailField(field: FieldHints): boolean {
  const type = field.type.toLowerCase();
  if (type !== 'email' && type !== 'text' && type !== '') return false;
  const autocomplete = field.autocomplete.toLowerCase();
  if (NOT_EMAIL_AUTOCOMPLETE.test(autocomplete)) return false;
  if (type === 'email' || /\bemail\b/.test(autocomplete)) return true;
  return EMAIL_HINT.test(`${field.name} ${field.id} ${field.placeholder} ${field.label}`);
}

export function isSignUpForm(form: FormHints): boolean {
  if (form.newPassword || form.passwords >= 2) return true;
  const text = `${form.text} ${form.path}`;
  if (!SIGN_UP.test(text)) return false;
  return !(SIGN_IN.test(form.text) && !SIGN_UP.test(form.text));
}

/** Local part for "based on the site name" aliases: "accounts.example.co.uk" → "example". */
export function siteLabel(site: string): string {
  const first = site.toLowerCase().split('.')[0] ?? '';
  const cleaned = first.replace(/[^a-z0-9]+/g, '').slice(0, 32);
  return cleaned || 'site';
}
