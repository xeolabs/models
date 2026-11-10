// @vitest-environment jsdom
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { defineComponent, nextTick } from 'vue';
import { mount } from '@vue/test-utils';
import { initializeTheme, themeStorageKey, useTheme } from '../app/theme';

const Switch = defineComponent({
  setup: useTheme,
  template: '<button @click="toggleTheme">{{ theme }}</button>',
});

beforeEach(() => {
  localStorage.clear();
  document.head.innerHTML = '<meta name="theme-color" content="">';
  document.documentElement.className = 'unrelated';
  initializeTheme();
});
afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
  initializeTheme();
});

test('starts dark without a preference, including invalid saved values', () => {
  expect(document.documentElement.classList.contains('dark')).toBe(true);
  expect(document.documentElement.classList.contains('unrelated')).toBe(true);
  expect(document.documentElement.dataset.theme).toBe('dark');
  localStorage.setItem(themeStorageKey, 'system');
  initializeTheme();
  expect(document.documentElement.dataset.theme).toBe('dark');
});

test('switching persists the choice and restores it on the next visit', async () => {
  const control = mount(Switch);
  await control.trigger('click');
  expect(control.text()).toBe('light');
  expect(localStorage.getItem(themeStorageKey)).toBe('light');
  expect(document.documentElement.classList.contains('dark')).toBe(false);
  expect(document.querySelector('meta[name="theme-color"]')?.getAttribute('content')).toBe(
    '#f5f7fa',
  );
  control.unmount();
  const reopened = mount(Switch);
  expect(reopened.text()).toBe('light');
  await reopened.trigger('click');
  expect(localStorage.getItem(themeStorageKey)).toBe('dark');
  expect(document.documentElement.dataset.theme).toBe('dark');
  reopened.unmount();
});

test('the switch still works when the browser blocks storage', async () => {
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
    throw new Error('Blocked');
  });
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new Error('Blocked');
  });
  const control = mount(Switch);
  expect(control.text()).toBe('dark');
  await control.trigger('click');
  expect(control.text()).toBe('light');
  expect(document.documentElement.dataset.theme).toBe('light');
  control.unmount();
});

test('other tabs update the preference and listeners are removed on unmount', async () => {
  const control = mount(Switch);
  localStorage.setItem(themeStorageKey, 'light');
  window.dispatchEvent(new StorageEvent('storage', { key: 'unrelated' }));
  await nextTick();
  expect(control.text()).toBe('dark');
  window.dispatchEvent(new StorageEvent('storage', { key: themeStorageKey }));
  await nextTick();
  expect(control.text()).toBe('light');
  localStorage.clear();
  window.dispatchEvent(new StorageEvent('storage', { key: null }));
  await nextTick();
  expect(control.text()).toBe('dark');
  control.unmount();
  localStorage.setItem(themeStorageKey, 'light');
  window.dispatchEvent(new StorageEvent('storage', { key: themeStorageKey }));
  expect(document.documentElement.dataset.theme).toBe('dark');
});
