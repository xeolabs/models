// @vitest-environment jsdom
import { expect, test, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { flushPromises, mount } from '@vue/test-utils';
import ProviderAccountsDialog from '../app/components/ProviderAccountsDialog.vue';
import { SketchfabAccountApi } from '../app/data/SketchfabAccountApi';
import { useProviderAccounts } from '../app/stores/providerAccounts';
import { useAcquisition } from '../app/stores/acquisition';

test('the account dialog restores public status, clears entered secrets and recovers after a rejected replacement', async () => {
  const pinia = createPinia();
  setActivePinia(pinia);
  const status = { configured: true, username: 'Saved user', method: 'api-token' as const };
  vi.spyOn(SketchfabAccountApi.prototype, 'status').mockResolvedValue(status);
  const connect = vi
    .spyOn(SketchfabAccountApi.prototype, 'connect')
    .mockRejectedValue(new Error('Token rejected'));
  const verify = vi.spyOn(SketchfabAccountApi.prototype, 'verify').mockResolvedValue(status);
  vi.spyOn(SketchfabAccountApi.prototype, 'disconnect').mockResolvedValue({ configured: false });
  const providers = vi.spyOn(useAcquisition(), 'refreshProviders').mockResolvedValue();
  const store = useProviderAccounts();
  const wrapper = mount(ProviderAccountsDialog, {
    attachTo: document.body,
    global: { plugins: [pinia] },
  });
  const buttons = () => [...document.querySelectorAll('button')];
  try {
    store.open = true;
    await flushPromises();
    expect(document.body.textContent).toContain('Configured as Saved user');
    const input = document.querySelector<HTMLInputElement>('[aria-label="Sketchfab token"]')!;
    expect(input.type).toBe('password');
    expect(input.value).toBe('');
    input.value = 'replacement-secret';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await flushPromises();
    document
      .querySelector('form')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await flushPromises();
    expect(connect).toHaveBeenCalledWith('api-token', 'replacement-secret');
    expect(input.value).toBe('');
    expect(store.status).toEqual(status);
    expect(document.body.textContent).toContain('Token rejected');
    expect(store.busy).toBe(false);
    buttons()
      .find((button) => button.textContent === 'Test saved connection')!
      .click();
    await flushPromises();
    expect(verify).toHaveBeenCalledOnce();
    expect(providers).toHaveBeenCalledOnce();
    expect(store.error).toBe('');
    buttons()
      .find((button) => button.textContent === 'Disconnect')!
      .click();
    await flushPromises();
    expect(store.status).toEqual({ configured: false });
    expect(providers).toHaveBeenCalledTimes(2);
  } finally {
    wrapper.unmount();
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  }
});

test('an older status request cannot overwrite a successful save', async () => {
  setActivePinia(createPinia());
  let complete!: (value: { configured: boolean }) => void;
  vi.spyOn(SketchfabAccountApi.prototype, 'status').mockImplementation(
    () =>
      new Promise((resolve) => {
        complete = resolve;
      }),
  );
  vi.spyOn(SketchfabAccountApi.prototype, 'connect').mockResolvedValue({
    configured: true,
    username: 'Current user',
  });
  vi.spyOn(useAcquisition(), 'refreshProviders').mockResolvedValue();
  try {
    const store = useProviderAccounts();
    const refresh = store.refresh();
    await store.connect('api-token', 'test-secret');
    complete({ configured: false });
    await refresh;
    expect(store.status).toMatchObject({ configured: true, username: 'Current user' });
  } finally {
    vi.restoreAllMocks();
  }
});
