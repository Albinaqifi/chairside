import type { Page } from '@playwright/test';
import messages from '@/i18n/en.json' with { type: 'json' };

const text = messages.devComponents.form;

/** The answers the demo form can ask its action for, by their keys in the message file. */
type Answer = keyof typeof text.answers;

/**
 * The demo form of /dev/components (E00-T04c, E00-T04d), found by its labels: a StaffForm with a
 * field of every kind. The checkbox and the switch are Radix's buttons, each with a hidden checkbox
 * input beside it under the field's name: that input is what the form sends (D-093).
 */
export function demoForm(page: Page) {
  const send = page.getByRole('button', { name: text.submit, exact: true });
  const form = page.locator('form').filter({ has: send });
  return {
    form,
    send,
    note: form.getByLabel(text.note, { exact: true }),
    code: form.getByLabel(text.code, { exact: true }),
    details: form.getByLabel(text.details, { exact: true }),
    choice: form.getByLabel(text.choice, { exact: true }),
    checkbox: form.getByRole('checkbox', { name: text.checkbox, exact: true }),
    switch: form.getByRole('switch', { name: text.switch, exact: true }),
    answer: (answer: Answer) =>
      form.getByRole('radio', { name: text.answers[answer], exact: true }),
    hiddenCheckbox: form.locator('input[type="checkbox"][name="checkbox"]'),
    hiddenSwitch: form.locator('input[type="checkbox"][name="switch"]'),
  };
}
