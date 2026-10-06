import localFont from 'next/font/local';

/*
 * The two fonts, from files in ./fonts with their licences (SIL Open Font License 1.1) next to them:
 * no font host is asked at build or at run time (D-009, D-086). The files are the type designers'
 * own, unchanged but renamed:
 * - figtree-variable.woff2: github.com/erikdkennedy/figtree at 032dfa7,
 *   fonts/webfonts/Figtree[wght].woff2 (weights 300–900); licence figtree-ofl.txt.
 * - newsreader-16pt-regular.woff2 and newsreader-16pt-medium.woff2:
 *   github.com/productiontype/Newsreader at cfcb4f7, fonts/static/woff2/Newsreader16pt-Regular.woff2
 *   and -Medium.woff2: the two weights the design uses (400–500); licence newsreader-ofl.txt.
 * Both cover English and the Latin letters of European names, Albanian's ë and ç among them, but not
 * Cyrillic: a Macedonian name shows in the fallback font (handoffs/E00-T04a.md, the owner's question).
 *
 * Each sets a variable on <html> (src/app/layout.tsx); the theme's --font-sans and --font-serif
 * read it and add the fallbacks (src/app/globals.css). adjustFontFallback sizes the fallback like
 * the font while the file loads, so the text does not jump.
 */
export const figtree = localFont({
  src: './fonts/figtree-variable.woff2',
  weight: '300 900',
  style: 'normal',
  variable: '--font-figtree',
  display: 'swap',
  adjustFontFallback: 'Arial',
});

export const newsreader = localFont({
  src: [
    { path: './fonts/newsreader-16pt-regular.woff2', weight: '400', style: 'normal' },
    { path: './fonts/newsreader-16pt-medium.woff2', weight: '500', style: 'normal' },
  ],
  variable: '--font-newsreader',
  display: 'swap',
  adjustFontFallback: 'Times New Roman',
});
