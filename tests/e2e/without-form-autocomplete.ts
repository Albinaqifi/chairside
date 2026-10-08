import http from 'node:http';
import net from 'node:net';
import type { AddressInfo } from 'node:net';
import type { Duplex } from 'node:stream';
import { DEV_PORT } from './servers.ts';

/*
 * The D-093 check's control (form-memory.spec.ts): a server of the test's own in front of `next dev`
 * that answers /dev/components without the form's own `autocomplete="off"` and passes everything
 * else through as it is: the page's scripts and requests, and the WebSocket `next dev`'s script
 * keeps open. The browser loads the page from it as from any server, once: its Back is a Back, its
 * reload a reload.
 *
 * Not Playwright's `route.fulfill()`: `next dev`'s script (Next.js 16.3.8) takes a page answered that
 * way for one from the browser's cache, finds no debug data kept for it and loads the page again,
 * WebKit on every visit and Firefox after Back, so a Back became a reload (measured 2026-10-08).
 *
 * It listens on `localhost`, as both servers of the run are named: the session cookie, set for
 * `localhost`, reaches every port.
 */

const PAGE = '/dev/components';

export interface ServerWithoutFormAutocomplete {
  /** `http://localhost:<port>`, where the browser opens /dev/components without the attribute. */
  origin: string;
  close(): Promise<void>;
}

/** The page's HTML with every form's own `autocomplete="off"` taken out; the fields keep theirs. */
function withoutFormAutocomplete(html: string): string {
  return html.replace(/<form\b[^>]*>/gi, (tag) => tag.replace(/\sautocomplete="off"/i, ''));
}

/** Starts the control's server on a free port; `close()` ends it and every connection to it. */
export async function serveWithoutFormAutocomplete(): Promise<ServerWithoutFormAutocomplete> {
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
          const body = withoutFormAutocomplete(Buffer.concat(chunks).toString('utf8'));
          // The server's headers, but for those about the body it sent, which is no longer that body.
          const pageHeaders = { ...fromDev.headers };
          delete pageHeaders['content-encoding'];
          delete pageHeaders['content-length'];
          delete pageHeaders['transfer-encoding'];
          response.writeHead(status, { ...pageHeaders, 'content-length': Buffer.byteLength(body) });
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
