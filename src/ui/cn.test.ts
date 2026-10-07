import { describe, expect, it } from 'vitest';
import { cn } from './cn';

describe('cn', () => {
  it('keeps a size and a colour together: text-heading is a size, text-muted a colour', () => {
    expect(cn('text-muted', 'text-heading')).toBe('text-muted text-heading');
    expect(cn('text-small', 'text-error')).toBe('text-small text-error');
  });

  it('keeps the later of two of the same kind, so a caller can override a component', () => {
    expect(cn('text-base', 'text-heading')).toBe('text-heading');
    expect(cn('text-muted', 'text-text')).toBe('text-text');
    expect(cn('rounded-control', 'rounded-pill')).toBe('rounded-pill');
    expect(cn('tracking-heading', 'tracking-normal')).toBe('tracking-normal');
    expect(cn('bg-primary', 'bg-surface')).toBe('bg-surface');
    expect(cn('font-sans', 'font-serif')).toBe('font-serif');
  });

  it("knows E00-T04b's sizes and tracking: captions and upper-case labels keep their colour", () => {
    expect(cn('text-muted', 'text-caption')).toBe('text-muted text-caption');
    expect(cn('text-overline', 'text-muted')).toBe('text-overline text-muted');
    expect(cn('text-caption', 'text-overline')).toBe('text-overline');
    expect(cn('text-overline', 'text-small')).toBe('text-small');
    expect(cn('tracking-overline', 'tracking-heading')).toBe('tracking-heading');
    expect(cn('text-nav-text', 'text-nav-current-text')).toBe('text-nav-current-text');
    expect(cn('bg-primary-soft', 'hover:bg-nav-hover')).toBe('bg-primary-soft hover:bg-nav-hover');
  });

  it("knows E00-T04c's toast tokens: its radius, shadow and animation replace their own kind only", () => {
    expect(cn('rounded-control', 'rounded-toast')).toBe('rounded-toast');
    expect(cn('shadow-toast', 'shadow-none')).toBe('shadow-none');
    expect(cn('shadow-toast', 'text-on-toast')).toBe('shadow-toast text-on-toast');
    expect(cn('animate-enter', 'animate-toast')).toBe('animate-toast');
    expect(cn('bg-toast', 'text-on-toast', 'text-base')).toBe('bg-toast text-on-toast text-base');
  });

  it("knows E00-T04e's drawer tokens: its title size keeps a colour, its shadow and entry replace their own kind", () => {
    expect(cn('text-muted', 'text-title')).toBe('text-muted text-title');
    expect(cn('text-heading', 'text-title')).toBe('text-title');
    expect(cn('shadow-toast', 'shadow-drawer')).toBe('shadow-drawer');
    expect(cn('shadow-drawer', 'bg-surface')).toBe('shadow-drawer bg-surface');
    expect(cn('animate-toast', 'animate-drawer')).toBe('animate-drawer');
    expect(cn('bg-overlay', 'bg-surface')).toBe('bg-surface');
  });

  it('joins conditional classes as clsx does', () => {
    expect(cn('px-3', false, undefined, ['py-2', { 'w-full': true, hidden: false }])).toBe(
      'px-3 py-2 w-full',
    );
  });
});
