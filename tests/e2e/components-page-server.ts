import http from 'node:http';
import net from 'node:net';
import type { AddressInfo } from 'node:net';
import type { Duplex } from 'node:stream';
import { DEV_PORT } from './servers.ts';

/*
 * The D-093 check's server (form-memory.spec.ts): a server of the test's own in front of `next dev`
 * that answers /dev/components as `next dev` does, but for three things, and passes everything else
 * through as it is: the page's scripts and requests, and the WebSocket `next dev`'s script keeps
 * open. The browser loads the page from it as from any server, once: its Back is a Back, its reload
 * a reload.
 *
 * 1. Always: the page's answer carries `Cache-Control: no-cache`, in place of `next dev`'s own.
 *    Next.js 16.4.2's `next dev` answers every page `no-store` (`next/dist/server/base-server.js`:
 *    "Documents and data responses must not be stored in development"); 16.3.8 answered `no-cache`.
 *    With `no-store` Firefox keeps no form state at all, and the check could not fail there: its
 *    control went red on Next.js 16.4.2 (E00-T13, measured). With `no-cache` it gives fields back
 *    again, the case the form's attribute guards.
 * 2. Always: the page's answer carries `Vary: *`, so no browser serves the page again from its own
 *    cache. After Back the page comes from the server, as a production staff page does (`no-store`),
 *    and every browser still gives a form's fields back as before (measured, below).
 *    Why (Next.js 16.3.8, E00-T06b fix round 4): a page answered `no-cache` was kept by Chromium and
 *    Firefox and shown again from their cache after Back, and such a page ran `next dev`'s script
 *    only once it had read the debug data `next dev` stored for it in the browser's IndexedDB, never
 *    when that read did not answer (measured with the read held: Chromium and Firefox, every time).
 *    The pages that did not run their script after Back in Firefox under load had come from the
 *    cache (E00-T06b testers, fix rounds 2 and 3). Next.js 16.4.2 keeps that data in the page's
 *    memory and gets it over `next dev`'s WebSocket (`next/dist/client/dev/debug-channel.js`), and
 *    nothing in it opens IndexedDB; a page from the server needs nothing stored in the browser.
 * 3. For the control only: without the form's own `autocomplete="off"`.
 *
 * Not Playwright's `route.fulfill()`: `next dev`'s script (Next.js 16.3.8) took a page answered that
 * way for one from the browser's cache, found no debug data kept for it and loaded the page again,
 * WebKit on every visit and Firefox after Back, so a Back became a reload (measured 2026-10-08; not
 * measured again on 16.4.2, as this server needs no route).
 *
 * Measured with `Vary: *` (Playwright 1.63.0, Windows; Next.js 16.3.8 and `next dev`'s `no-cache`,
 * 2026-10-09; Next.js 16.4.2 and this server's `no-cache`, 2026-10-26): after Back every browser
 * loads the page as a new document; with the form's attribute no browser gives a field back;
 * without it, Firefox does after a reload and after Back, Chromium and WebKit after Back only: as
 * with the page from the browser's cache.
 *
 * It listens on `localhost`, as both servers of the run are named: the session cookie, set for
 * `localhost`, reaches every port.
 */

const PAGE = '/dev/components';

export interface ComponentsPageServer {
  /** `http://localhost:<port>`, where the browser opens /dev/components. */
  origin: string;
  close(): Promise<void>;
}

/** The page's HTML with every form's own `autocomplete="off"` taken out; the fields keep theirs. */
function withoutFormAutocomplete(html: string): string {
  return html.replace(/<form\b[^>]*>/gi, (tag) => tag.replace(/\sautocomplete="off"/i, ''));
}

/**
 * Starts the server on a free port; `close()` ends it and every connection to it. With
 * `stripFormAutocomplete`, the page comes without the form's own `autocomplete="off"`: the control.
 */
export async function serveComponentsPage(options: {
  stripFormAutocomplete: boolean;
}): Promise<ComponentsPageServer> {
  const server = http.createServer((request, response) => {
    // Uncompressed, so that the page's HTML can be changed.
    const headers = { ...request.headers };
    delete headers['accept-encoding'];
    const toDev = http.request(
      { host: 'localhost', port: DEV_PORT, method: request.method, path: request.url, headers },
      (fromDev) => {
        const status = fromDev.statusCode ?? 502;
        const isPage =
          new URL(request.url ?? '/', 'http://localhost').pathname === PAGE &&
          (fromDev.headers['content-type'] ?? '').startsWith('text/html');
        if (!isPage) {
          response.writeHead(status, fromDev.headers);
          fromDev.pipe(response);
          return;
        }
        const chunks: Buffer[] = [];
        fromDev.on('data', (chunk: Buffer) => chunks.push(chunk));
        fromDev.on('end', () => {
          const html = Buffer.concat(chunks).toString('utf8');
          const body = options.stripFormAutocomplete ? withoutFormAutocomplete(html) : html;
          // The server's headers, but for those about the body it sent, which is no longer that body.
          const pageHeaders = { ...fromDev.headers };
          delete pageHeaders['content-encoding'];
          delete pageHeaders['content-length'];
          delete pageHeaders['transfer-encoding'];
          response.writeHead(status, {
            ...pageHeaders,
            // A page whose form state a browser keeps, as with Next.js 16.3.8 (1. above).
            'cache-control': 'no-cache',
            // Never served again from the browser's cache (2. above).
            vary: '*',
            'content-length': Buffer.byteLength(body),
          });
          response.end(body);
        });
      },
    );
    // A failed request fails in the browser, where the test sees it.
    toDev.on('error', () => response.destroy());
    request.pipe(toDev);
  });

  // The WebSocket of `next dev`'s script: the request as it came, then both ways unchanged.
  const upgraded = new Set<Duplex>();
  server.on('upgrade', (request, socket, head) => {
    const toDev = net.connect(DEV_PORT, 'localhost', () => {
      const lines = [
        `${request.method ?? 'GET'} ${request.url ?? '/'} HTTP/${request.httpVersion}`,
      ];
      for (let index = 0; index < request.rawHeaders.length; index += 2) {
        lines.push(request.rawHeaders.slice(index, index + 2).join(': '));
      }
      toDev.write(`${lines.join('\r\n')}\r\n\r\n`);
      toDev.write(head);
      toDev.pipe(socket);
      socket.pipe(toDev);
    });
    for (const end of [socket, toDev]) {
      upgraded.add(end);
      end.on('close', () => upgraded.delete(end));
    }
    toDev.on('error', () => socket.destroy());
    socket.on('error', () => toDev.destroy());
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, 'localhost', () => resolve());
  });
  const { port } = server.address() as AddressInfo;

  return {
    origin: `http://localhost:${port}`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
        server.closeAllConnections();
        for (const end of upgraded) end.destroy();
      }),
  };
}
