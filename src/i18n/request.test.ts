import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Staff } from '@/app/_lib/auth';
import messages from './en.json';
import createConfig, { NO_CLINIC_TIME_ZONE } from './request';

// E01-T02a: every request's next-intl configuration carries a time zone: the clinic's, once the
// clinic is settled; a fixed one before (the login page, the clinic picker), with nothing read and
// nobody sent anywhere. Only next-intl's wrapper, who is signed in and the zone's read are stand-ins
// here; tests/integration/request-time-zone.test.ts runs the real ones. Every value is synthetic.

const request = vi.hoisted(() => ({
  staff: null as unknown,
  read: vi.fn<(input: object) => Promise<unknown>>(),
}));
vi.mock('next-intl/server', () => ({ getRequestConfig: (create: unknown) => create }));
vi.mock('@/app/_lib/auth', () => ({ settledStaff: () => Promise.resolve(request.staff) }));
vi.mock('@/app/_lib/clinic-time-zone', () => ({ clinicTimeZone: { forPage: request.read } }));

const staff: Staff = {
  user: { id: '01970000-0000-7000-8000-0000000000e1', name: 'Owner', email: 'owner@example.test' },
  clinic: {
    membershipId: '01970000-0000-7000-8000-0000000000e2',
    clinicId: '01970000-0000-7000-8000-0000000000e3',
    clinicName: 'Test clinic (synthetic)',
    role: 'owner',
    extraPermissions: [],
    providerKind: null,
  },
  clinicCount: 1,
};

async function configuration() {
  return createConfig({ requestLocale: Promise.resolve(undefined) });
}

beforeEach(() => {
  request.staff = null;
  request.read.mockReset();
});

describe("every request's configuration (src/i18n/request.ts)", () => {
  it("in a settled clinic: the clinic's time zone, read through the wrapper", async () => {
    request.staff = staff;
    request.read.mockResolvedValue({ ok: true, value: 'Pacific/Auckland' });
    expect(await configuration()).toEqual({
      locale: 'en-u-hc-h23',
      messages,
      timeZone: 'Pacific/Auckland',
    });
    expect(request.read).toHaveBeenCalledWith({});
  });

  it('signed out, or before a clinic is chosen: a fixed zone, and nothing read', async () => {
    expect(await configuration()).toEqual({ locale: 'en-u-hc-h23', messages, timeZone: 'UTC' });
    expect(NO_CLINIC_TIME_ZONE).toBe('UTC');
    expect(request.read).not.toHaveBeenCalled();
  });

  it("a read that fails fails the page, rather than show times in the computer's zone", async () => {
    request.staff = staff;
    request.read.mockResolvedValue({ ok: false, error: { code: 'internal' } });
    await expect(configuration()).rejects.toThrow("The clinic's time zone could not be read");
  });
});
