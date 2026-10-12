import { ChevronLeft, ChevronRight } from 'lucide-react';
import Link from 'next/link';
import { useFormatter, useTranslations } from 'next-intl';
import type { CSSProperties } from 'react';
import type { CalendarDay } from '@/lib/calendar-day';
import type { AppointmentStatus } from '@/modules/scheduling';
import { cn } from '@/ui/cn';
import type { AppointmentBlock, BreakBlock, CalendarDayView, Column, Placed, Span } from './day';

/** Pixels per minute, the demo's scale (logic line 1519): an hour is 87 px. */
export const PX_PER_MINUTE = 1.45;

/** The statuses of the legend, as the demo orders its own (logic line 1833); "No reply yet" is E02's. */
const LEGEND: readonly AppointmentStatus[] = [
  'confirmed',
  'booked',
  'arrived',
  'completed',
  'cancelled',
  'no_show',
];

/** Each status's dot (the status colours of the theme, demo logic lines 1377–1385). */
const STATUS_DOT: Record<AppointmentStatus, string> = {
  booked: 'bg-status-booked-dot',
  confirmed: 'bg-status-confirmed-dot',
  arrived: 'bg-status-arrived-dot',
  completed: 'bg-status-completed-dot',
  cancelled: 'bg-status-cancelled-dot',
  no_show: 'bg-status-no-show-dot',
};

/** Each status's tag line, in its text colour. */
const STATUS_TEXT: Record<AppointmentStatus, string> = {
  booked: 'text-status-booked-fg',
  confirmed: 'text-status-confirmed-fg',
  arrived: 'text-status-arrived-fg',
  completed: 'text-status-completed-fg',
  cancelled: 'text-status-cancelled-fg',
  no_show: 'text-status-no-show-fg',
};

/**
 * A block's look by status (demo logic lines 1820–1828): the provider's tint and edge; arrived
 * outlined in the provider's strong tint; completed faded; cancelled and a no-show on red.
 */
const STATUS_LOOK: Record<AppointmentStatus, string> = {
  booked: 'border-provider-edge bg-provider-tint',
  confirmed: 'border-provider-edge bg-provider-tint',
  arrived: 'border-provider-edge bg-provider-tint ring-2 ring-provider-strong',
  completed: 'border-provider-edge bg-provider-tint opacity-60',
  cancelled: 'border-cancelled-block-edge bg-cancelled-block',
  no_show: 'border-cancelled-block-edge bg-cancelled-block',
};

/** Struck through: the visit no longer holds the chair. */
const STRUCK: ReadonlySet<AppointmentStatus> = new Set(['cancelled', 'no_show']);

/** No tag line for these, unless a note: the demo's rule (logic line 1827). */
const UNTAGGED: ReadonlySet<AppointmentStatus> = new Set(['confirmed', 'completed']);

/** A visit's time: its hour and minute in the clinic's zone, which next-intl's provider holds. */
const TIME = { hour: 'numeric', minute: '2-digit' } as const;

const NAV_LINK =
  'flex items-center px-3 py-2 text-text outline-none hover:bg-bg hover:text-text focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus focus-visible:outline-solid';

/** The address of a day of the calendar: the day and nothing else. */
export function dayHref(day: CalendarDay): string {
  return `/calendar?day=${day}`;
}

/**
 * The calendar's day (E01-T04a, demo lines 215–283): Previous, Today and Next, the day as the title,
 * the count of its appointments and columns, then a column per provider on an hour grid, and the
 * statuses' legend. Rendered on the server; nothing on it is clicked yet (E01-T05, E01-T06). Every
 * moment is shown in the clinic's zone (next-intl's formatter, D-015); the day, the hours of the
 * grid and the weekday are no moments, so they are formatted in UTC (CLAUDE.md, Dates and times).
 *
 * A closed day says so above the grid, with its label (the demo has no closed day: a layout proposed
 * for the owner in the handoff note).
 */
export function DayCalendar({ view }: { view: CalendarDayView }) {
  const t = useTranslations();
  const format = useFormatter();
  const date = new Date(view.day);
  const sameYear = view.day.slice(0, 4) === view.today.slice(0, 4);
  const title = format.dateTime(date, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: sameYear ? undefined : 'numeric',
    timeZone: 'UTC',
  });
  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <nav
          aria-label={t('calendar.dayNavigation')}
          className="flex overflow-hidden rounded-control border border-border-strong bg-surface"
        >
          <Link
            href={dayHref(view.previous)}
            aria-label={t('calendar.previousDay')}
            className={NAV_LINK}
          >
            <ChevronLeft aria-hidden="true" className="size-4" />
          </Link>
          <Link href="/calendar" className={cn(NAV_LINK, 'border-x border-border font-medium')}>
            {t('calendar.today')}
          </Link>
          <Link href={dayHref(view.next)} aria-label={t('calendar.nextDay')} className={NAV_LINK}>
            <ChevronRight aria-hidden="true" className="size-4" />
          </Link>
        </nav>
        <h1 className="font-serif text-heading tracking-heading">{title}</h1>
      </div>
      <p className="-mt-1.5 mb-3 text-small text-muted">
        {t('calendar.summary', {
          appointments: view.appointmentCount,
          chairs: view.columns.length,
        })}
      </p>
      {view.closed && (
        <p className="mb-3 rounded-control border border-border bg-outside-hours px-3 py-2">
          {view.closed.why === 'closed_day'
            ? t('calendar.closedDay', { label: view.closed.label })
            : t('calendar.closedWeekday', {
                weekday: format.dateTime(date, { weekday: 'long', timeZone: 'UTC' }),
              })}
        </p>
      )}
      <DayGrid view={view} />
      <ul
        aria-label={t('calendar.legend')}
        className="mt-3 flex flex-wrap gap-4 text-small text-muted"
      >
        {LEGEND.map((status) => (
          <li key={status} className="flex items-center gap-1.5">
            <span aria-hidden="true" className={cn('size-2 rounded-pill', STATUS_DOT[status])} />
            {t(`appointmentStatus.${status}`)}
          </li>
        ))}
      </ul>
    </>
  );
}

/** The grid: the columns' headers, the hours, and each column's shading, lines and blocks. */
function DayGrid({ view }: { view: CalendarDayView }) {
  const t = useTranslations();
  const format = useFormatter();
  const { grid } = view;
  const hours: number[] = [];
  for (let hour = grid.from / 60; hour < grid.to / 60; hour++) hours.push(hour);
  return (
    <div className="overflow-hidden rounded-card border border-border bg-surface">
      <div className="flex border-b border-border">
        <div className="w-14.5 shrink-0" />
        {view.columns.map((column) => (
          <ColumnHeader key={column.providerId} column={column} />
        ))}
        {view.columns.length === 0 && (
          <p className="flex-1 border-l border-border px-3 py-2.5 text-muted">
            {t('calendar.noProviders')}
          </p>
        )}
      </div>
      <div className="relative flex" style={{ height: px(length(grid)) }}>
        <div aria-hidden="true" className="relative w-14.5 shrink-0">
          {hours.map((hour) => (
            <div
              key={hour}
              className="absolute right-2.5 -translate-y-1.75 text-caption text-muted tabular-nums"
              style={{ top: px(hour * 60 - grid.from) }}
            >
              {format.dateTime(new Date(Date.UTC(2000, 0, 1, hour)), {
                hour: 'numeric',
                timeZone: 'UTC',
              })}
            </div>
          ))}
        </div>
        {view.columns.map((column) => (
          <div
            key={column.providerId}
            className="relative min-w-0 flex-1 border-l border-border"
            style={cssVariables({
              '--provider-hue': String(column.hue),
              '--calendar-half-hour': px(30),
            })}
          >
            {view.shaded.map((span) => (
              <div
                key={span.from}
                data-shaded=""
                className="absolute inset-x-0 bg-outside-hours"
                style={{ top: px(span.from - grid.from), height: px(length(span)) }}
              />
            ))}
            <div aria-hidden="true" className="half-hour-lines absolute inset-0" />
            <ul aria-labelledby={columnNameId(column)} className="absolute inset-0">
              {column.blocks.map((block) =>
                block.kind === 'appointment' ? (
                  <AppointmentItem key={block.id} block={block} grid={grid} />
                ) : (
                  <BreakItem key={block.id} block={block} grid={grid} />
                ),
              )}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}

/** A column's header: the initials in a circle of the provider's tint, the name, the chair and % booked. */
function ColumnHeader({ column }: { column: Column }) {
  const t = useTranslations('calendar');
  return (
    <div
      className="flex min-w-0 flex-1 items-center gap-2.5 border-l border-border px-3 py-2.5"
      style={cssVariables({ '--provider-hue': String(column.hue) })}
    >
      <div
        aria-hidden="true"
        className="flex size-7.5 shrink-0 items-center justify-center rounded-pill bg-provider-tint text-caption font-bold text-provider-ink"
      >
        {column.initials}
      </div>
      <div className="min-w-0">
        <div id={columnNameId(column)} className="truncate font-semibold">
          {column.name}
        </div>
        <div className="truncate text-caption text-muted">
          {column.percentBooked === null
            ? column.chairLabel
            : t('chairAndLoad', { chair: column.chairLabel, percent: column.percentBooked })}
        </div>
      </div>
    </div>
  );
}

/**
 * A visit: its time and its patient's name, its title, and a tag line: its note when it has one,
 * else its status's name, none for confirmed and completed (the demo's rule). Its status's name is
 * read out where no tag says it.
 */
function AppointmentItem({ block, grid }: { block: AppointmentBlock; grid: Span }) {
  const t = useTranslations();
  const format = useFormatter();
  const status = t(`appointmentStatus.${block.status}`);
  const tag = block.note !== '' ? block.note : UNTAGGED.has(block.status) ? '' : status;
  return (
    <li
      data-status={block.status}
      className={cn(
        'absolute overflow-hidden rounded-control border px-2 py-1.25 text-provider-ink',
        STATUS_LOOK[block.status],
      )}
      style={placement(block, grid)}
    >
      <div className="flex items-start justify-between gap-1.5">
        <div className="min-w-0 truncate text-small leading-tight">
          <span className="font-bold tabular-nums">
            {format.dateTime(new Date(block.startsAt), TIME)}
          </span>
          <span className={cn('ml-1 font-semibold', STRUCK.has(block.status) && 'line-through')}>
            {t('patients.fullName', {
              first: block.patient.firstName,
              last: block.patient.lastName,
            })}
          </span>
        </div>
        <span
          aria-hidden="true"
          className={cn(
            'mt-0.75 size-2.25 shrink-0 rounded-pill ring-2 ring-surface/70',
            STATUS_DOT[block.status],
          )}
        />
      </div>
      <div className="truncate text-caption leading-tight opacity-85">{block.title}</div>
      {tag !== '' && (
        <div
          className={cn(
            'mt-0.5 truncate text-caption leading-tight font-semibold',
            STATUS_TEXT[block.status],
          )}
        >
          {tag}
        </div>
      )}
      {tag !== status && <span className="sr-only">{status}</span>}
    </li>
  );
}

/** A break of the provider that weekday, hatched, with its label (D-018). */
function BreakItem({ block, grid }: { block: BreakBlock; grid: Span }) {
  return (
    <li
      data-break=""
      className="hatched absolute overflow-hidden rounded-control border border-border px-2 py-1.25 text-muted"
      style={placement(block, grid)}
    >
      <div className="truncate text-small leading-tight font-semibold">{block.label}</div>
    </li>
  );
}

/**
 * Where a block sits: down the grid by its span, a pixel under its start and three above its end as
 * the demo draws it (logic line 1821); across the column by its lane, 5 px in at each side, with 3 px
 * between lanes.
 */
function placement(block: Placed, grid: Span): CSSProperties {
  const inner = '(100% - 10px)';
  return {
    top: `${(block.from - grid.from) * PX_PER_MINUTE + 1}px`,
    height: `${Math.max(length(block) * PX_PER_MINUTE - 3, 0)}px`,
    left: `calc(5px + ${inner} * ${block.lane / block.lanes})`,
    width: `calc(${inner} / ${block.lanes}${block.lanes > 1 ? ' - 3px' : ''})`,
  };
}

/** Minutes of the grid as pixels. */
function px(minutes: number): string {
  return `${minutes * PX_PER_MINUTE}px`;
}

function length(span: Span): number {
  return span.to - span.from;
}

function columnNameId(column: Column): string {
  return `calendar-column-${column.providerId}`;
}

/** CSS variables for an element's style: React types none of them. */
function cssVariables(variables: Record<`--${string}`, string>): CSSProperties {
  return variables as CSSProperties;
}
