'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useId, useRef, useState, type Ref } from 'react';
import { StaffField, StaffForm } from '@/app/_lib/staff-form';
import type { ClinicProvider, ProviderKind } from '@/modules/scheduling';
import { Badge } from '@/ui/badge';
import { Button } from '@/ui/button';
import { Dialog, DialogContent, DialogTrigger } from '@/ui/dialog';
import { Input } from '@/ui/input';
import { NativeSelect, NativeSelectOption } from '@/ui/native-select';
import { useToast } from '@/ui/toast';
import {
  activateProvider,
  addProvider,
  changeProvider,
  deactivateProvider,
} from './provider-actions';
import { FIRST_HUE, HUE_MAX, hueStyle, KIND_CHOICES } from './provider-fields';

/**
 * How long the list takes no click from a pointer once its rows have changed: the closed days' and
 * the treatment types' moment (SETTLE_MS, ./closed-days.tsx, ./treatment-types.tsx), copied a third
 * time rather than shared (E01-T09d). A provider's row does not move when it is made inactive (the
 * order is its sort_order), but its Make inactive turns into Make active under the pointer: the first
 * click's answer can be back before a double click's second, which would then make it active again.
 */
const SETTLE_MS = 1_000;

/** The fields a provider's form starts with: a new provider's, or the provider's own. */
interface ProviderValues {
  name: string;
  shortName: string;
  kind: ProviderKind;
  chairLabel: string;
  colorHue: number;
}

const NEW_PROVIDER: ProviderValues = {
  name: '',
  shortName: '',
  kind: KIND_CHOICES[0],
  chairLabel: '',
  colorHue: FIRST_HUE,
};

/**
 * The Providers tab (E01-T09b, E01-T09d; the demo has no such screen, design-reference.md): the
 * clinic's providers in the calendar's order, each with its name, short name, kind, chair and a
 * swatch of its colour; an inactive one says so. Each row has an Edit, which opens the provider's
 * form in a dialog, and a Make inactive or Make active, a StaffForm of its own with the id hidden, as
 * the Treatment types tab's rows. Under the list, under a line, the form that adds one. Its page keys
 * it by the clinic (D-098), so a render for another clinic starts it from that clinic's providers.
 * `linked`: the providers a login is linked to, whose kind the Edit dialog locks (owner, D-118).
 *
 * Every form here is a StaffForm: it sends the frame's clinic (D-092) and keeps nothing in the
 * browser (D-093), no field asking for an `autocomplete` of its own. When one is done, the action
 * renders the page again (refresh()), and the list with it. After an add, the add form is mounted
 * anew, empty, its colour back at the first hue and the keyboard back at its name. After a Make
 * inactive or Make active, whose button changes, the keyboard goes to the section's heading.
 *
 * Whenever the rows change, the list takes no pointer click for a moment (SETTLE_MS), as the
 * treatment types' list: only the pointer's; the keyboard acts on the control it names.
 */
export function Providers({
  providers,
  linked,
}: {
  providers: readonly ClinicProvider[];
  linked: readonly string[];
}) {
  const t = useTranslations('settings.providers');
  const heading = useRef<HTMLHeadingElement>(null);
  const nameField = useRef<HTMLInputElement>(null);
  const [added, setAdded] = useState(0);
  useEffect(() => {
    if (added > 0) nameField.current?.focus();
  }, [added]);
  // The rows as last rendered, compared while rendering, as the treatment types' list compares them:
  // the commit that changes the rows is the one that stops their clicks.
  const listed = JSON.stringify(providers);
  const [rendered, setRendered] = useState(listed);
  const [settling, setSettling] = useState(false);
  if (rendered !== listed) {
    setRendered(listed);
    setSettling(true);
  }
  useEffect(() => {
    if (!settling) return;
    const timer = setTimeout(() => setSettling(false), SETTLE_MS);
    return () => clearTimeout(timer);
  }, [settling, listed]);
  return (
    <section className="grid gap-4">
      <div className="grid gap-1">
        {/* tabIndex -1: the keyboard's place after a Make inactive, never a stop of the Tab key. */}
        <h2 ref={heading} tabIndex={-1} className="text-section font-semibold">
          {t('heading')}
        </h2>
        <p className="text-muted">{t('intro')}</p>
      </div>
      {providers.length === 0 ? (
        <p>{t('none')}</p>
      ) : (
        <ul className={settling ? 'pointer-events-none' : undefined}>
          {providers.map((provider) => (
            <ProviderRow
              key={provider.id}
              provider={provider}
              kindLocked={linked.includes(provider.id)}
              onStateChanged={() => heading.current?.focus()}
            />
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
        <ProviderFields values={NEW_PROVIDER} nameRef={nameField} />
      </StaffForm>
    </section>
  );
}

/**
 * One provider: a swatch of its colour, its name, "Inactive" when it is, and a muted line of its
 * short name, kind and chair; its Edit; and its Make inactive or Make active, a StaffForm of its own
 * whose only field is the id, hidden. A group named by the provider (", inactive" for an inactive
 * one, as two may share a name), so each button is read with the provider it acts on.
 *
 * Make inactive's answer carries how many visits ahead stay booked: with any, its toast says so in
 * place of the form's own (StaffForm shows doneMessage, then calls onDone, whose toast replaces it;
 * StaffForm is not changed, D-119).
 */
function ProviderRow({
  provider,
  kindLocked,
  onStateChanged,
}: {
  provider: ClinicProvider;
  kindLocked: boolean;
  onStateChanged: () => void;
}) {
  const t = useTranslations('settings.providers');
  const showToast = useToast();
  const details = [provider.shortName, t(`kinds.${provider.kind}`), provider.chairLabel];
  return (
    <li className="border-t border-border py-3 first:border-t-0 first:pt-0">
      <div
        role="group"
        aria-label={provider.active ? provider.name : t('inactiveName', { name: provider.name })}
        className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2"
      >
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <Swatch hue={provider.colorHue} />
          <div className="grid min-w-0 flex-1 gap-0.5">
            <span className="flex flex-wrap items-center gap-2">
              <span className="font-medium wrap-anywhere">{provider.name}</span>
              {provider.active ? null : <Badge variant="archived">{t('inactive')}</Badge>}
            </span>
            <span className="text-muted wrap-anywhere">{details.join(' · ')}</span>
          </div>
        </div>
        <div className="flex flex-wrap items-start justify-end gap-2">
          <EditProvider provider={provider} kindLocked={kindLocked} />
          {/* Keyed by the state, so a provider made inactive gets a new form, its answer not carried. */}
          {provider.active ? (
            <StaffForm
              key="active"
              action={deactivateProvider}
              doneMessage={t('deactivated')}
              onDone={({ visitsAhead }) => {
                if (visitsAhead > 0) showToast(t('deactivatedWithVisits', { count: visitsAhead }));
                onStateChanged();
              }}
              refusals={{ not_found: t('notFound'), already_inactive: t('alreadyInactive') }}
              submitLabel={t('deactivate')}
              pendingLabel={t('deactivating')}
              className="justify-items-end"
            >
              <input type="hidden" name="providerId" value={provider.id} />
            </StaffForm>
          ) : (
            <StaffForm
              key="inactive"
              action={activateProvider}
              doneMessage={t('activated')}
              onDone={onStateChanged}
              refusals={{ not_found: t('notFound'), already_active: t('alreadyActive') }}
              submitLabel={t('activate')}
              pendingLabel={t('activating')}
              className="justify-items-end"
            >
              <input type="hidden" name="providerId" value={provider.id} />
            </StaffForm>
          )}
        </div>
      </div>
    </li>
  );
}

/**
 * A provider's Edit: a button that opens its form in a dialog, filled with the provider as it is, the
 * id hidden, inactive ones too. The dialog closes when the save is done; Radix gives the focus back to
 * Edit. Its content is mounted only while it is open, so each opening starts from the provider's
 * values of that render.
 */
function EditProvider({ provider, kindLocked }: { provider: ClinicProvider; kindLocked: boolean }) {
  const t = useTranslations('settings.providers');
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="secondary">{t('edit')}</Button>
      </DialogTrigger>
      <DialogContent title={t('editTitle', { name: provider.name })}>
        <StaffForm
          action={changeProvider}
          doneMessage={t('saved')}
          onDone={() => setOpen(false)}
          refusals={{ provider_linked: t('providerLinked'), not_found: t('notFound') }}
          submitLabel={t('save')}
          pendingLabel={t('saving')}
        >
          <input type="hidden" name="providerId" value={provider.id} />
          <ProviderFields values={provider} kindLocked={kindLocked} stacked />
        </StaffForm>
      </DialogContent>
    </Dialog>
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
 * A provider's fields, for the add form and the edit: the name, the short name, the kind (the
 * browser's own select), the chair, and the colour (ColourField), each starting at `values`.
 *
 * `kindLocked` (a provider a login is linked to, owner, D-118): the select is shown disabled, with a
 * line under it that says why. A disabled select sends nothing, so the kind as stored goes in a
 * hidden field of the same name, and the action takes it with the other fields; it refuses any other
 * kind (provider_linked) whatever the form sends. Exported for its component test: the dialog's
 * content is mounted only while it is open, so the server's HTML of the tab has none of it.
 */
export function ProviderFields({
  values,
  nameRef,
  kindLocked = false,
  stacked = false,
}: {
  values: ProviderValues;
  nameRef?: Ref<HTMLInputElement>;
  kindLocked?: boolean;
  /** Two fields a row on a wide screen (the add form), or one under another (the edit dialog). */
  stacked?: boolean;
}) {
  const t = useTranslations('settings.providers');
  const lockedLine = useId();
  return (
    <div className={stacked ? 'grid gap-4' : 'grid items-start gap-4 sm:grid-cols-2'}>
      <StaffField
        name="name"
        label={t('name')}
        render={(field) => <Input {...field} ref={nameRef} defaultValue={values.name} />}
      />
      <StaffField
        name="shortName"
        label={t('shortName')}
        render={(field) => <Input {...field} defaultValue={values.shortName} />}
      />
      <div className="grid gap-2">
        {kindLocked ? <input type="hidden" name="kind" value={values.kind} /> : null}
        <StaffField
          name="kind"
          label={t('kind')}
          render={(field) => (
            <NativeSelect
              {...field}
              defaultValue={values.kind}
              disabled={kindLocked}
              aria-describedby={
                kindLocked
                  ? [lockedLine, field['aria-describedby']].filter(Boolean).join(' ')
                  : field['aria-describedby']
              }
            >
              {KIND_CHOICES.map((kind) => (
                <NativeSelectOption key={kind} value={kind}>
                  {t(`kinds.${kind}`)}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          )}
        />
        {kindLocked ? (
          <p id={lockedLine} className="text-small text-muted">
            {t('kindLocked')}
          </p>
        ) : null}
      </div>
      <StaffField
        name="chairLabel"
        label={t('chair')}
        render={(field) => <Input {...field} defaultValue={values.chairLabel} />}
      />
      <ColourField initialHue={values.colorHue} className={stacked ? undefined : 'sm:col-span-2'} />
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
