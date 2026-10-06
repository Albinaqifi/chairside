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

  it('joins conditional classes as clsx does', () => {
    expect(cn('px-3', false, undefined, ['py-2', { 'w-full': true, hidden: false }])).toBe(
      'px-3 py-2 w-full',
    );
  });
});
