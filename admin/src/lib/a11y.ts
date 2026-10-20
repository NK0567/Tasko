import type { KeyboardEvent } from 'react';

/**
 * Rend une ligne de tableau cliquable accessible au clavier (Tab + Entrée/Espace).
 * Usage : <tr className="clickable" {...rowActivate(() => open(x))}>
 */
export function rowActivate(onActivate: () => void) {
  return {
    tabIndex: 0,
    onClick: onActivate,
    onKeyDown: (e: KeyboardEvent<HTMLElement>) => {
      if (e.target !== e.currentTarget) return;
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        onActivate();
      }
    },
  };
}
