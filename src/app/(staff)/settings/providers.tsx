'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState, type Ref } from 'react';
import { StaffField, StaffForm } from '@/app/_lib/staff-form';
import type { ClinicProvider } from '@/modules/scheduling';
import { Badge } from '@/ui/badge';
import { Input } from '@/ui/input';
import { NativeSelect, NativeSelectOption } from '@/ui/native-select';
import { addProvider } from './provider-actions';
import { FIRST_HUE, HUE_MAX, hueStyle, KIND_CHOICES } from './provider-fields';

/**
 * The Providers tab (E01-T09b; the demo has no such screen, design-reference.md): the clinic's
 * providers in the calendar's order, each with its name, short name, kind, chair and a swatch of its
 * colour; an inactive one says so (none can be made so before E01-T09d). No button in a row yet:
 * Edit and Make inactive are E01-T09d's. Under the list, under a line, the form that adds one, as
 * the Treatment types tab's. Its page keys it by the clinic (D-098), so a render for another clinic
 * starts it from that clinic's providers.
 *
 * The add form is a StaffForm: it sends the frame's clinic (D-092) and keeps nothing in the browser
 * (D-093), no field asking for an `autocomplete` of its own. When it is done, the action renders the
 * page again (refresh()), and the list with it; the form is mounted anew, empty, its colour back at
 * the first hue and the keyboard back at its name.
 */
export function Providers({ providers }: { providers: readonly ClinicProvider[] }) {
  const t = useTranslations('settings.providers');
  const nameField = useRef<HTMLInputElement>(null);
  const [added, setAdded] = useState(0);
  useEffect(() => {
    if (added > 0) nameField.current?.focus();
  }, [added]);
  return (
    <section className="grid gap-4">
      <div className="grid gap-1">
        <h2 className="text-section font-semibold">{t('heading')}</h2>
        <p className="text-muted">{t('intro')}</p>
      </div>
      {providers.length === 0 ? (
        <p>{t('none')}</p>
      ) : (
        <ul>
          {providers.map((provider) => (
            <ProviderRow key={provider.id} provider={provider} />
          ))}
        </ul>
      )}
      <StaffForm
        key={added}
        action={addProvider}
        doneMessage={t('added')}
        onDone={() => setAdded((count) => count + 1)}
        submitLabel={t('add')}
        pendingLabel={t('adding')}
        className="border-t border-border pt-4"
      >
        <ProviderFields nameRef={nameField} />
      </StaffForm>
    </section>
  );
}

/**
 * One provider: a swatch of its colour, its name, "Inactive" when it is, and a muted line of its
 * short name, kind and chair.
 */
function ProviderRow({ provider }: { provider: ClinicProvider }) {
  const t = useTranslations('settings.providers');
  const details = [provider.shortName, t(`kinds.${provider.kind}`), provider.chairLabel];
  return (
    <li className="flex items-center gap-3 border-t border-border py-3 first:border-t-0 first:pt-0">
      <Swatch hue={provider.colorHue} />
      <div className="grid min-w-0 flex-1 gap-0.5">
        <span className="flex flex-wrap items-center gap-2">
          <span className="font-medium wrap-anywhere">{provider.name}</span>
          {provider.active ? null : <Badge variant="archived">{t('inactive')}</Badge>}
        </span>
        <span className="text-muted wrap-anywhere">{details.join(' · ')}</span>
      </div>
    </li>
  );
}

/**
 * A provider's colour as the calendar's column header shows it: a circle of its tint with its edge,
 * a dot of its strong shade inside. Seen, not read: the row says who it is.
 */
function Swatch({ hue }: { hue: number }) {
  return (
    <span
      aria-hidden="true"
      data-slot="provider-swatch"
      style={hueStyle(hue)}
      className="flex size-7.5 shrink-0 items-center justify-center rounded-pill border border-provider-edge bg-provider-tint"
    >
      <span className="size-2.5 rounded-pill bg-provider-strong" />
    </span>
  );
}

/**
 * A new provider's fields: the name, the short name, the kind (the browser's own select), the chair,
 * and the colour (ColourField).
 */
function ProviderFields({ nameRef }: { nameRef?: Ref<HTMLInputElement> }) {
  const t = useTranslations('settings.providers');
  return (
    <div className="grid items-start gap-4 sm:grid-cols-2">
      <StaffField
        name="name"
        label={t('name')}
        render={(field) => <Input {...field} ref={nameRef} defaultValue="" />}
      />
      <StaffField
        name="shortName"
        label={t('shortName')}
        render={(field) => <Input {...field} defaultValue="" />}
      />
      <StaffField
        name="kind"
        label={t('kind')}
        render={(field) => (
          <NativeSelect {...field} defaultValue={KIND_CHOICES[0]}>
            {KIND_CHOICES.map((kind) => (
              <NativeSelectOption key={kind} value={kind}>
                {t(`kinds.${kind}`)}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        )}
      />
      <StaffField
        name="chairLabel"
        label={t('chair')}
        render={(field) => <Input {...field} defaultValue="" />}
      />
      <ColourField className="sm:col-span-2" />
    </div>
  );
}

/**
 * The colour: a range of hues from 0 to 359, the value the form sends, starting at `initialHue`; and
 * beside it the provider's tints, which follow the range as it is dragged: the swatch, and a visit's
 * block as the calendar draws it in them (tint, edge, strong and ink, from the theme). Exported for
 * its component test.
 */
export function ColourField({
  initialHue = FIRST_HUE,
  className,
}: {
  initialHue?: number;
  className?: string;
}) {
  const t = useTranslations('settings.providers');
  const [hue, setHue] = useState(initialHue);
  return (
    <div className={className}>
      <StaffField
        name="colorHue"
        label={t('colour')}
        render={(field) => (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <input
              {...field}
              type="range"
              min={0}
              max={HUE_MAX}
              step={1}
              value={hue}
              onChange={(event) => setHue(Number(event.currentTarget.value))}
              className="h-10 min-w-48 flex-1 accent-primary"
            />
            <div
              aria-hidden="true"
              data-slot="colour-preview"
              style={hueStyle(hue)}
              className="flex items-center gap-2.5"
            >
              <Swatch hue={hue} />
              <span className="rounded-control border border-l-4 border-provider-edge border-l-provider-strong bg-provider-tint px-2.5 py-1.5 text-small text-provider-ink">
                {t('colourSample')}
              </span>
            </div>
          </div>
        )}
      />
    </div>
  );
}
