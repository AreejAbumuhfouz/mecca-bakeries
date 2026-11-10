'use client';

import { useEffect, useState } from 'react';

/**
 * Renders the app only in the browser, once the saved language is known, so server
 * HTML (always Arabic) never mixes with English text. The screens behind login load
 * their data in the browser anyway.
 */
export function LocaleGate({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);
  return ready ? <>{children}</> : null;
}
