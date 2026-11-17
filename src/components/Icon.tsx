import type { CSSProperties } from 'react';

/** Jeu d'icônes maison : grille 24 px, trait 1,75, extrémités arrondies. */
const P: Record<string, string> = {
  // Outils
  merge: 'M6 3v5a4 4 0 0 0 4 4h4a4 4 0 0 1 4 4v5M18 3v5a4 4 0 0 1-4 4M9 18l-3 3-3-3',
  split: 'M12 3v8M12 11 5 18M12 11l7 7M3 18h4M17 18h4M5 15v6M19 15v6',
  trash: 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6',
  extract: 'M5 3h9l5 5v13H5zM14 3v5h5M12 17v-6M9 14l3-3 3 3',
  organize: 'M3 4h7v7H3zM14 4h7v7h-7zM3 15h7v5H3zM14 15h7v5h-7z',
  scan: 'M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3M4 12h16',
  nup: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z',
  compress: 'M5 4h14M5 20h14M12 8v3M9 9l3 3 3-3M12 16v-3M9 15l3-3 3 3',
  repair: 'M14.5 6.5a4 4 0 0 0-5.2 5.2L3.5 17.5a1.8 1.8 0 0 0 2.5 2.5l5.8-5.8a4 4 0 0 0 5.2-5.2l-2.7 2.7-2.3-.5-.5-2.3z',
  ocr: 'M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3M8 9h8M12 9v7',
  image: 'M4 5h16v14H4zM4 16l5-5 4 4 3-3 4 4M15.5 9.5h.01',
  file: 'M6 3h8l5 5v13H6zM14 3v5h5M9 13h6M9 17h6',
  text: 'M5 6h14M12 6v13M9 19h6',
  markdown: 'M3 6h18v12H3zM6.5 15V9l2.5 3 2.5-3v6M16 9v6m-2-2 2 2 2-2',
  editor: 'M4 20l1-4L16.5 4.5a2 2 0 0 1 3 3L8 19zM14 7l3 3',
  rotate: 'M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7',
  numbers: 'M9 4 7 20M17 4l-2 16M4 9h17M3 15h17',
  watermark: 'M12 3s6 6.3 6 10.5a6 6 0 0 1-12 0C6 9.3 12 3 12 3z',
  crop: 'M7 3v14h14M3 7h14v14',
  flatten: 'M12 3 3 8l9 5 9-5zM3 13l9 5 9-5M3 17.5l9 5 9-5',
  redact: 'M4 6h16v3H4zM4 11h10v3H4zM4 16h16v3H4z',
  metadata: 'M3 12V4h8l10 10-8 8zM7.5 8h.01',
  compare: 'M4 4h7v16H4zM13 4h7v16h-7zM7 9h1M7 13h1M16 9h1M16 13h1',
  workflow: 'M5 6a2 2 0 1 0 0 .01M19 6a2 2 0 1 0 0 .01M12 19a2 2 0 1 0 0 .01M5 8v2a3 3 0 0 0 3 3h8a3 3 0 0 0 3-3V8M12 13v4',
  // Interface
  upload: 'M12 16V4M7 9l5-5 5 5M4 16v4h16v-4',
  download: 'M12 4v12M7 11l5 5 5-5M4 20h16',
  close: 'M6 6l12 12M18 6 6 18',
  up: 'M12 19V5M6 11l6-6 6 6',
  down: 'M12 5v14M6 13l6 6 6-6',
  check: 'M5 12.5l4.5 4.5L19 7.5',
  undo: 'M9 14 4 9l5-5M4 9h10a6 6 0 0 1 0 12h-3',
  plus: 'M12 5v14M5 12h14',
  minus: 'M5 12h14',
  cursor: 'M6 3l12 8-5.5 1.5L10 18z',
  type: 'M5 6V4h14v2M12 4v16M9 20h6',
  square: 'M4 6h16v12H4z',
  circle: 'M12 4a8 8 0 1 0 .01 0',
  highlight: 'M14 4l6 6-8 8H7l-3-3 10-11zM4 21h8',
  pen: 'M3 17c3-8 5-10 7-6s3 4 5-1 4-2 6 2',
  eraser: 'M7 20H20M5 14l8-8 6 6-6 6H8zM9 18l-4-4',
  signature: 'M3 16c2-5 3-9 5-9s0 9 2 9 2-5 4-5 1 5 3 5 2-2 4-3M3 21h18',
  rotl: 'M4 11a8 8 0 1 1 2.3 5.7M4 4v7h7',
  rotr: 'M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7',
  copy: 'M8 8h12v12H8zM4 16V4h12',
  blank: 'M6 3h12v18H6zM9 8h6M9 12h6',
  reverse: 'M7 4v16M3 16l4 4 4-4M17 20V4M13 8l4-4 4 4',
  save: 'M5 4h12l3 3v13H5zM8 4v5h7V4M8 20v-6h8v6',
  play: 'M7 4l13 8-13 8z',
  search: 'M11 4a7 7 0 1 0 .01 0M16 16l5 5',
  lock: 'M6 11h12v9H6zM8 11V8a4 4 0 0 1 8 0v3',
  infinity: 'M7 8a4 4 0 1 0 0 8c4 0 6-8 10-8a4 4 0 1 1 0 8c-4 0-6-8-10-8',
  shield: 'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z',
  gift: 'M4 11h16v9H4zM3 7h18v4H3zM12 7v13M12 7c-2 0-4-1-4-3s3-1 4 3zm0 0c2 0 4-1 4-3s-3-1-4 3z',
  alert: 'M12 4 3 20h18zM12 10v4M12 17h.01',
  info: 'M12 4a8 8 0 1 0 .01 0M12 11v5M12 8h.01',
  link: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1',
  arrow: 'M5 12h14M13 6l6 6-6 6',
  sun: 'M12 8a4 4 0 1 0 .01 0M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4',
  moon: 'M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z',
  unlock: 'M6 11h12v9H6zM8 11V8a4 4 0 0 1 7.5-2',
  broom: 'M14 3l7 7-5 2-4-4zM12 8 4 16l1 4 4 1 8-8M7 14l3 3',
  header: 'M4 4h16v16H4zM4 9h16M8 6.5h4',
  resize: 'M4 9V4h5M20 15v5h-5M4 4l6 6M20 20l-6-6',
  book: 'M12 6c-2-1.5-5-2-8-2v14c3 0 6 .5 8 2 2-1.5 5-2 8-2V4c-3 0-6 .5-8 2zM12 6v14',
  contrast: 'M12 3a9 9 0 1 0 .01 0M12 3v18',
  word: 'M5 3h9l5 5v13H5zM14 3v5h5M8.5 11.5l1.5 6 2-5 2 5 1.5-6',
  slides: 'M3 5h18v11H3zM12 16v4M8 20h8M9.5 8.5v4l4-2z',
  table: 'M3 5h18v14H3zM3 10h18M3 15h18M9 5v14M15 5v14',
  form: 'M5 3h14v18H5zM8 8h8M8 12h4M8 16h8',
  drag: 'M9 6h.01M9 12h.01M9 18h.01M15 6h.01M15 12h.01M15 18h.01',
};

export type IconName = keyof typeof P;

export function Icon({ name, size = 18, style, className }: { name: string; size?: number; style?: CSSProperties; className?: string }) {
  const d = P[name] ?? P.file;
  return (
    <svg className={className} style={style} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={d} />
    </svg>
  );
}
