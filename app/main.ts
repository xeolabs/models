import { createApp } from 'vue';
import { createPinia } from 'pinia';
import {
  ElButton,
  ElInput,
  ElSelect,
  ElOption,
  ElTag,
  ElSkeleton,
  ElPagination,
} from 'element-plus';
import 'element-plus/dist/index.css';
import 'element-plus/theme-chalk/dark/css-vars.css';
import 'dockview-vue/dist/styles/dockview.css';
import './theme.css';
import './styles.css';
import './acquisition.css';
import App from './App.vue';

import { browserPanels } from './components/panels';

import { initializeTheme } from './theme';

initializeTheme();

async function start() {
  // Register the Studio controls this app uses without shipping the whole component library.
  const app = createApp(App).use(createPinia());
  for (const component of [
    ElButton,
    ElInput,
    ElSelect,
    ElOption,
    ElTag,
    ElSkeleton,
    ElPagination,
  ]) {
    app.use(component);
  }
  for (const [name, component] of Object.entries(browserPanels)) app.component(name, component);
  app.mount('#app');
}
void start().catch((error) => {
  const root = document.getElementById('app')!;
  root.textContent = `Could not open this catalog: ${error.message}. Refresh the page to retry.`;
  root.setAttribute('role', 'alert');
  root.className = 'startup-error';
});
