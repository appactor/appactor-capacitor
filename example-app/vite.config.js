import { defineConfig } from 'vite';

export default defineConfig({
  // Capacitor 8 still runs on Android WebView 60+, as the plugin itself does.
  build: { target: 'es2017' },
  // `appactor-capacitor` is linked from `..`, which has its own node_modules; keep one Capacitor core.
  resolve: { dedupe: ['@capacitor/core'] },
});
