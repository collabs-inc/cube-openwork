import original from '../apps/app/vite.config';

export default (env: Parameters<typeof original>[0]) => {
  const config = original(env);
  config.plugins.push({
    name: 'cube-mit-only',
    generateBundle() {
      for (const id of this.getModuleIds()) {
        if (id.includes('/ee/') || id.includes('@openwork-ee/')) throw new Error(`EE module reached the Cube web build: ${id}`);
      }
      console.log('Cube MIT-only module graph check passed.');
    },
  });
  return config;
};
