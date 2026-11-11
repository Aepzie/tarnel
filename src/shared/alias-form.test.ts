import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isEmailField, isSignUpForm, siteLabel, type FieldHints, type FormHints } from './alias-form';

const field = (hints: Partial<FieldHints>): FieldHints => ({ type: 'text', name: '', id: '', autocomplete: '', placeholder: '', label: '', ...hints });
const form = (hints: Partial<FormHints>): FormHints => ({ passwords: 1, newPassword: false, text: '', path: '/', ...hints });

test('email fields: type, autocomplete and name hints', () => {
  assert.equal(isEmailField(field({ type: 'email' })), true);
  assert.equal(isEmailField(field({ autocomplete: 'email' })), true);
  assert.equal(isEmailField(field({ name: 'user_email' })), true);
  assert.equal(isEmailField(field({ placeholder: 'E-Mail address' })), true);
  assert.equal(isEmailField(field({ label: 'Your email' })), true);
  assert.equal(isEmailField(field({ name: 'username' })), false);
  assert.equal(isEmailField(field({ type: 'password', name: 'email' })), false);
  assert.equal(isEmailField(field({ type: 'email', autocomplete: 'one-time-code' })), false);
  assert.equal(isEmailField(field({ type: 'search', name: 'email' })), false);
});

test('sign-up forms: new-password, two password fields or sign-up wording', () => {
  assert.equal(isSignUpForm(form({ newPassword: true })), true);
  assert.equal(isSignUpForm(form({ passwords: 2 })), true);
  assert.equal(isSignUpForm(form({ text: 'Create your account' })), true);
  assert.equal(isSignUpForm(form({ text: 'Sign up' })), true);
  assert.equal(isSignUpForm(form({ text: 'Konto erstellen' })), true);
  assert.equal(isSignUpForm(form({ text: 'Continue', path: '/register' })), true);
});

test('login forms are not sign-up forms', () => {
  assert.equal(isSignUpForm(form({ text: 'Sign in' })), false);
  assert.equal(isSignUpForm(form({ text: 'Log in', path: '/login' })), false);
  assert.equal(isSignUpForm(form({ text: 'Continue' })), false);
  assert.equal(isSignUpForm(form({ text: 'Log in', path: '/signup' })), false);
  assert.equal(isSignUpForm(form({ passwords: 0, text: '' })), false);
});

test('site label for site-based aliases', () => {
  assert.equal(siteLabel('example.com'), 'example');
  assert.equal(siteLabel('My-Shop.co.uk'), 'myshop');
  assert.equal(siteLabel('127.0.0.1'), '127');
  assert.equal(siteLabel(''), 'site');
});
