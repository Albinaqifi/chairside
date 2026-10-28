import type { CSSProperties } from 'react';

/*
 * The Providers tab's fields (E01-T09b), with no React component and no database: the kinds the
 * select offers, the colour range's ends and first value, and the style that gives an element a
 * provider's hue. The actions' schema and the tab use them; the unit test holds them to the
 * scheduling module's. No field here is a number field (D-118): the colour is a range, whose value
 * the form sends as text.
 *
 * The tab runs in the browser, so this file imports no value of the scheduling module, whose code is
 * the server's: only its types.
 */

/** The kinds the select offers, in its order: the scheduling module's PROVIDER_KINDS. */
export const KIND_CHOICES = ['dentist', 'hygienist', 'other'] as const;

/** The range's highest hue, in degrees: the scheduling module's PROVIDER_HUE_MAX. */
export const HUE_MAX = 359;

/**
 * The hue a new provider's range starts at: 200, the theme's own (the primary's and the dark
 * panel's hues are 195 and 200, design-reference.md).
 */
export const FIRST_HUE = 200;

/** The longest hue text the actions read, in characters: "359". */
export const HUE_TEXT_MAX = 3;

/**
 * The style that sets an element's --provider-hue, which the theme's provider tints read
 * (globals.css: --color-provider-tint, -edge, -strong, -ink), as the calendar sets it on a column.
 * React types no CSS variable, hence the cast.
 */
export function hueStyle(hue: number): CSSProperties {
  return { '--provider-hue': String(hue) } as CSSProperties;
}
