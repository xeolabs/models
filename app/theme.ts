import { onMounted, onUnmounted, readonly, ref } from 'vue';

export type ThemeMode = 'light' | 'dark';
export const themeStorageKey = 'xeokit.models.theme';
const theme = ref<ThemeMode>('dark');
let sessionTheme: ThemeMode | undefined;

export function setSessionTheme(value: ThemeMode) {
  sessionTheme = value;
  applyTheme(value);
}

/**
 * Dark is the default, even when the operating system uses a light theme.
 * Storage can be unavailable in private or restricted browser sessions.
 */
function readPreference(): ThemeMode {
  try {
    return localStorage.getItem(themeStorageKey) === 'light' ? 'light' : 'dark';
  } catch {
    return 'dark';
  }
}

/**
 * Element Plus, native controls and the app all follow the same root theme.
 */
function applyTheme(value: ThemeMode) {
  theme.value = value;
  document.documentElement.classList.toggle('dark', value === 'dark');
  document.documentElement.dataset.theme = value;
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute('content', value === 'dark' ? '#171e27' : '#f5f7fa');
}

/**
 * Apply the saved preference before waiting for the server to open the catalog.
 */
export function initializeTheme() {
  applyTheme(sessionTheme ?? readPreference());
}

export function useTheme() {
  initializeTheme();

  function toggleTheme() {
    applyTheme(theme.value === 'dark' ? 'light' : 'dark');
    try {
      localStorage.setItem(themeStorageKey, theme.value);
    } catch {
      // The switch still works for this visit when preferences cannot be saved.
    }
  }

  function storageChanged(event: StorageEvent) {
    if (event.key === themeStorageKey || event.key === null) initializeTheme();
  }

  onMounted(() => window.addEventListener('storage', storageChanged));
  onUnmounted(() => window.removeEventListener('storage', storageChanged));
  return { theme: readonly(theme), toggleTheme };
}
