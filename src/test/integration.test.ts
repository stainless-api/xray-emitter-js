import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import { describe, test, beforeEach, afterEach } from 'node:test';

let hasBun = false;
try {
  execFileSync('bun', ['--version'], { stdio: 'ignore' });
  hasBun = true;
} catch {}

// ---------------------------------------------------------------------------
// Stub OTLP receiver — accepts POST /v1/traces, returns 200, counts requests
// ---------------------------------------------------------------------------

interface StubReceiver {
  server: http.Server;
  url: string;
  requestCount: number;
  close(): Promise<void>;
}

function createStubReceiver(): Promise<StubReceiver> {
  return new Promise((resolve) => {
    let requestCount = 0;
    const server = http.createServer((req, res) => {
      if (req.method === 'POST' && req.url === '/v1/traces') {
        requestCount++;
        // Drain body
        req.resume();
        req.on('end', () => {
          res.writeHead(200);
          res.end();
        });
      } else {
        res.writeHead(404);
        res.end();
      }
    });

    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as import('node:net').AddressInfo;
      const receiver: StubReceiver = {
        server,
        url: `http://127.0.0.1:${addr.port}`,
        get requestCount() {
          return requestCount;
        },
        close() {
          return new Promise((resolve) => server.close(() => resolve()));
        },
      };
      resolve(receiver);
    });
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ROOT = path.resolve(import.meta.dirname, '..', '..');
const TSX = path.join(ROOT, 'node_modules', '.bin', 'tsx');

/** Wait until a TCP connection to `port` succeeds. */
function waitForPort(port: number, timeoutMs = 10_000): Promise<void> {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    function attempt() {
      const sock = new net.Socket();
      sock.once('connect', () => {
        sock.destroy();
        resolve();
      });
      sock.once('error', () => {
        sock.destroy();
        if (Date.now() - start > timeoutMs) {
          reject(new Error(`Port ${port} not ready after ${timeoutMs}ms`));
        } else {
          setTimeout(attempt, 100);
        }
      });
      sock.connect(port, '127.0.0.1');
    }
    attempt();
  });
}

/** Make a simple HTTP GET request. */
function httpGet(url: string): Promise<number> {
  return new Promise((resolve, reject) => {
    http
      .get(url, (res) => {
        res.resume();
        res.on('end', () => resolve(res.statusCode ?? 0));
      })
      .on('error', reject);
  });
}

// ---------------------------------------------------------------------------
// Tests — run sequentially (server examples share port 3000)
// ---------------------------------------------------------------------------

describe('integration: examples emit OTLP traces', { concurrency: false }, () => {
  let receiver: StubReceiver;

  function childEnv(): Record<string, string> {
    return {
      ...process.env,
      STAINLESS_XRAY_ENDPOINT_URL: receiver.url,
    } as Record<string, string>;
  }

  /** Spawn a child process and wait for it to exit. */
  function spawnAndWait(
    file: string,
    timeoutMs = 15_000,
  ): Promise<{ code: number | null; stderr: string }> {
    return new Promise((resolve, reject) => {
      const child = spawn(TSX, [file], {
        cwd: path.dirname(file),
        env: childEnv(),
        stdio: ['ignore', 'ignore', 'pipe'],
      });
      let stderr = '';
      child.stderr.on('data', (chunk: Buffer) => {
        stderr += chunk.toString();
      });
      const timer = setTimeout(() => {
        child.kill('SIGKILL');
        reject(new Error(`Script ${file} timed out after ${timeoutMs}ms\nstderr: ${stderr}`));
      }, timeoutMs);
      child.on('close', (code) => {
        clearTimeout(timer);
        resolve({ code, stderr });
      });
    });
  }

  /**
   * Spawn a server, wait for it to be ready, make a request, send SIGTERM,
   * and wait for graceful shutdown.
   *
   * When `waitForFlush` is true the helper polls the stub receiver until at
   * least one trace has arrived before sending SIGTERM.  Without this,
   * Node 24+ can exit before the OTLP export completes because the
   * `fetch`/`undici` transport uses unref'd sockets that don't keep the
   * event loop alive during the shutdown flush.
   */
  function spawnServer(
    file: string,
    { cmd, port = 3000, timeoutMs = 15_000, waitForFlush = false } = {} as {
      cmd?: string;
      port?: number;
      timeoutMs?: number;
      waitForFlush?: boolean;
    },
  ): Promise<{ stderr: string }> {
    return new Promise((resolve, reject) => {
      const child = spawn(cmd ?? TSX, [file], {
        cwd: path.dirname(file),
        env: childEnv(),
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      let stderr = '';
      let stdout = '';
      child.stderr.on('data', (chunk: Buffer) => {
        stderr += chunk.toString();
      });
      child.stdout.on('data', (chunk: Buffer) => {
        stdout += chunk.toString();
      });

      const timer = setTimeout(() => {
        child.kill('SIGKILL');
        reject(
          new Error(
            `Server ${file} timed out after ${timeoutMs}ms\nstdout: ${stdout}\nstderr: ${stderr}`,
          ),
        );
      }, timeoutMs);

      child.on('close', () => {
        clearTimeout(timer);
        resolve({ stderr });
      });

      // Wait for port → make a request → (optionally wait for traces) → SIGTERM
      waitForPort(port)
        .then(() => httpGet(`http://127.0.0.1:${port}/`))
        .then(async () => {
          if (waitForFlush) {
            const deadline = Date.now() + 10_000;
            while (receiver.requestCount === 0 && Date.now() < deadline) {
              await new Promise((r) => setTimeout(r, 50));
            }
          } else {
            await new Promise((r) => setTimeout(r, 200));
          }
          child.kill('SIGTERM');
        })
        .catch((err) => {
          child.kill('SIGKILL');
          clearTimeout(timer);
          reject(err);
        });
    });
  }

  beforeEach(async () => {
    receiver = await createStubReceiver();
  });

  afterEach(async () => {
    await receiver.close();
  });

  // -- Server examples ------------------------------------------------------

  test('effect', async () => {
    await spawnServer(path.join(ROOT, 'examples', 'effect', 'server.ts'), {
      waitForFlush: true,
    });
    assert.ok(receiver.requestCount >= 1, `expected traces, got ${receiver.requestCount}`);
  });

  test('effect (bun)', { skip: !hasBun }, async () => {
    await spawnServer(path.join(ROOT, 'examples', 'effect', 'server-bun.ts'), {
      cmd: 'bun',
      waitForFlush: true,
    });
    assert.ok(receiver.requestCount >= 1, `expected traces, got ${receiver.requestCount}`);
  });

  test('express', async () => {
    await spawnServer(path.join(ROOT, 'examples', 'express', 'server.ts'), {
      waitForFlush: true,
    });
    assert.ok(receiver.requestCount >= 1, `expected traces, got ${receiver.requestCount}`);
  });

  test('fastify', async () => {
    await spawnServer(path.join(ROOT, 'examples', 'fastify', 'server.ts'), {
      waitForFlush: true,
    });
    assert.ok(receiver.requestCount >= 1, `expected traces, got ${receiver.requestCount}`);
  });

  test('hono', async () => {
    await spawnServer(path.join(ROOT, 'examples', 'hono', 'server.ts'), {
      waitForFlush: true,
    });
    assert.ok(receiver.requestCount >= 1, `expected traces, got ${receiver.requestCount}`);
  });

  test('node-http', async () => {
    await spawnServer(path.join(ROOT, 'examples', 'node-http', 'server.ts'), {
      waitForFlush: true,
    });
    assert.ok(receiver.requestCount >= 1, `expected traces, got ${receiver.requestCount}`);
  });

  // -- Script examples ------------------------------------------------------

  test('edge', async () => {
    await spawnAndWait(path.join(ROOT, 'examples', 'edge', 'worker.ts'));
    assert.ok(receiver.requestCount >= 1, `expected traces, got ${receiver.requestCount}`);
  });

  test('next-app', async () => {
    await spawnAndWait(path.join(ROOT, 'examples', 'next-app', 'route.ts'));
    assert.ok(receiver.requestCount >= 1, `expected traces, got ${receiver.requestCount}`);
  });

  test('remix-app', async () => {
    await spawnAndWait(path.join(ROOT, 'examples', 'remix-app', 'entry.ts'));
    assert.ok(receiver.requestCount >= 1, `expected traces, got ${receiver.requestCount}`);
  });
});
