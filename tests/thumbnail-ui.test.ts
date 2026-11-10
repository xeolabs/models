// @vitest-environment jsdom
import { expect, test } from 'vitest';
import { mount } from '@vue/test-utils';
import ThumbnailImage from '../app/components/ThumbnailImage.vue';

test('each preview keeps its own spinner until that image finishes', async () => {
  const first = mount(ThumbnailImage, { props: { src: '/first.png', alt: 'First' } });
  const second = mount(ThumbnailImage, { props: { src: '/second.png', alt: 'Second' } });
  try {
    expect(first.get('[role="status"]').attributes('aria-label')).toBe('Loading preview');
    expect(first.find('.el-icon.is-loading').exists()).toBe(true);
    await first.get('img').trigger('load');
    expect(first.find('[role="status"]').exists()).toBe(false);
    expect(first.attributes('aria-busy')).toBe('false');
    expect(second.attributes('aria-busy')).toBe('true');
    await first.setProps({ alt: 'Updated title' });
    expect(first.find('[role="status"]').exists()).toBe(false);
  } finally {
    first.unmount();
    second.unmount();
  }
});

test('missing and failed previews show the fallback instead of spinning indefinitely', async () => {
  const wrapper = mount(ThumbnailImage, {
    props: { alt: 'Preview' },
    slots: { default: '<span>No preview</span>' },
  });
  try {
    expect(wrapper.text()).toBe('No preview');
    expect(wrapper.find('[role="status"]').exists()).toBe(false);
    await wrapper.setProps({ src: '/broken.png' });
    expect(wrapper.text()).not.toContain('No preview');
    expect(wrapper.attributes('aria-busy')).toBe('true');
    await wrapper.get('img').trigger('error');
    expect(wrapper.find('[role="status"]').exists()).toBe(false);
    expect(wrapper.find('img').exists()).toBe(false);
    expect(wrapper.text()).toBe('No preview');
    await wrapper.setProps({ src: '/replacement.png' });
    expect(wrapper.attributes('aria-busy')).toBe('true');
    await wrapper.get('img').trigger('load');
    expect(wrapper.attributes('aria-busy')).toBe('false');
  } finally {
    wrapper.unmount();
  }
});

test('changing the source restarts loading and late events from the old image are ignored', async () => {
  const wrapper = mount(ThumbnailImage, { props: { src: '/old.png', alt: 'Preview' } });
  try {
    const oldImage = wrapper.get('img');
    await wrapper.setProps({ src: '/new.png' });
    await oldImage.trigger('load');
    await oldImage.trigger('error');
    expect(wrapper.get('img').attributes('src')).toBe('/new.png');
    expect(wrapper.attributes('aria-busy')).toBe('true');
    await wrapper.get('img').trigger('load');
    expect(wrapper.attributes('aria-busy')).toBe('false');
  } finally {
    wrapper.unmount();
  }
});
