import { defineConfig } from 'vite';

// Keep localhost development at /; Pages and production preview use the repository path.
export default defineConfig(({ command, isPreview }) => ({
  base: command === 'build' || isPreview ? '/gashaan/' : '/',
}));
