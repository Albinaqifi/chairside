import localFont from 'next/font/local';

/*
 * The two fonts (D-089), from files in ./fonts with their licences (SIL Open Font License 1.1) next
 * to them: no font host is asked at build or at run time (D-009, D-086). The files are the type
 * designers' own, unchanged but renamed:
 * - onest-variable.woff2: Onest 2.001, the release's onest-2.001.zip (github.com/simpals/onest,
 *   tag 2.001 at 8739b19), fonts/webfonts/Onest[wght].woff2 (weights 100–900); licence
 *   onest-ofl.txt, the zip's OFL.txt.
 * - source-serif-4-variable-roman.woff2: github.com/adobe-fonts/source-serif at 80d3f88 (branch
 *   release), WOFF2/VAR/SourceSerif4Variable-Roman.ttf.woff2 (weights 200–900, and optical sizes,
 *   which the browser picks from the text size): the one file with weight 500, which the wordmark
 *   uses; licence source-serif-4-ofl.md, the repository's LICENSE.md.
 * Both cover English, the Latin letters of European names (Albanian's ë and ç among them) and
 * Cyrillic with Macedonian's letters (Ѓ Ѕ Ј Љ Њ Ќ Џ), so a name written in Macedonian shows in the
 * same font as the text around it.
 *
 * Each sets a variable on <html> (src/app/layout.tsx); the theme's --font-sans and --font-serif
 * read it and add the fallbacks (src/app/globals.css). adjustFontFallback sizes the fallback like
 * the font while the file loads, so the text does not jump.
 */
export const onest = localFont({
  src: './fonts/onest-variable.woff2',
  weight: '100 900',
  style: 'normal',
  variable: '--font-onest',
  display: 'swap',
  adjustFontFallback: 'Arial',
});

export const sourceSerif = localFont({
  src: './fonts/source-serif-4-variable-roman.woff2',
  weight: '200 900',
  style: 'normal',
  variable: '--font-source-serif',
  display: 'swap',
  adjustFontFallback: 'Times New Roman',
});
