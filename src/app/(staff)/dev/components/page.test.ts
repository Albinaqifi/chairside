import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Staff } from '@/app/_lib/auth';
import ComponentsPage from './page';

// E00-T04c, acceptance 6 (the page's part, as far as a unit test reaches): /dev/components answers
// 404 in a production build before anything else, and outside production it starts from
// currentStaff() like every staff page. The tester requests it from `pnpm build` + `pnpm start`.
// Every value is synthetic.

const request = vi.hoisted(() => ({ currentStaff: vi.fn<() => Promise<Staff>>() }));
vi.mock('@/app/_lib/auth', () => ({ currentStaff: request.currentStaff }));
vi.mock('next-intl/server', () => ({
  getTranslations: () => Promise.resolve((key: string) => key),
}));

const staff: Staff = {
  user: {
    id: '01970000-0000-7000-8000-0000000000e1',
    name: 'Owner',
    email: 'owner-dev@example.test',
  },
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

/** The digest of what the page threw (Next.js's 404 and redirects carry one), or undefined. */
async function thrown(): Promise<string | undefined> {
  try {
    await ComponentsPage();
    return undefined;
  } catch (error) {
    const digest = (error as { digest?: unknown } | null)?.digest;
    if (typeof digest !== 'string') throw error;
    return digest;
  }
}

beforeEach(() => {
  request.currentStaff.mockReset();
  request.currentStaff.mockResolvedValue(staff);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('/dev/components', () => {
  it('in a production build: 404, before it even asks who is signed in', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    expect(await thrown()).toBe('NEXT_HTTP_ERROR_FALLBACK;404');
    expect(request.currentStaff).not.toHaveBeenCalled();
  });

  it('outside production: it renders, starting from currentStaff()', async () => {
    expect(await thrown()).toBeUndefined();
    expect(request.currentStaff).toHaveBeenCalledTimes(1);
  });

  it("outside production, signed out: currentStaff()'s redirect to the login page goes through", async () => {
    const toLogin = Object.assign(new Error('NEXT_REDIRECT'), {
      digest: 'NEXT_REDIRECT;replace;/login;307;',
    });
    request.currentStaff.mockRejectedValue(toLogin);
    expect(await thrown()).toBe('NEXT_REDIRECT;replace;/login;307;');
  });
});
