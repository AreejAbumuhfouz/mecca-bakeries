import { createElement, useEffect, useState, type ComponentType } from 'react';
import { registerRootComponent } from 'expo';
import { loadLocale } from './src/i18n';

/**
 * The saved language is read first; App (and every screen) is loaded after that, so all
 * texts, including constants at the top of files, come out in that language.
 */
function Root() {
  const [App, setApp] = useState<ComponentType | null>(null);
  useEffect(() => {
    void loadLocale().then(() => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const mod = require('./App') as { default: ComponentType };
      setApp(() => mod.default);
    });
  }, []);
  return App ? createElement(App) : null;
}

registerRootComponent(Root);
