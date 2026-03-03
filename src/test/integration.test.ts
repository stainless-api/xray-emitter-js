import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import { describe, test, beforeEach, afterEach } from 'node:test';
import { createStub, type XrayStub } from '../stub/stub';

let hasBun = false;
try {
  execFileSync('bun', ['--version'], { stdio: 'ignore' });
  hasBun = true;
} catch {}

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
          setTimeout(attempt, 25);
        }
      });
      sock.connect(port, '127.0.0.1');
    }
    attempt();
  });
}

/** Make an HTTP POST request with an empty body. */
function httpPost(url: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = http.request(url, { method: 'POST' }, (res) => {
      res.resume();
      res.on('end', () => resolve(res.statusCode ?? 0));
    });
    req.on('error', reject);
    req.end();
  });
}

// ---------------------------------------------------------------------------
// Tests — run sequentially (server examples share port 3000)
// ---------------------------------------------------------------------------

describe('integration: examples emit OTLP traces', { concurrency: false }, () => {
  let stub: XrayStub;

  function childEnv(): Record<string, string> {
    return {
      ...process.env,
      STAINLESS_XRAY_ENDPOINT_URL: stub.url,
      STAINLESS_XRAY_SPAN_PROCESSOR: 'simple',
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

  /** Spawn a server, wait for readiness, POST /hello/test, then SIGTERM. */
  function spawnServer(
    file: string,
    { cmd, port = 3000, timeoutMs = 15_000 } = {} as {
      cmd?: string;
      port?: number;
      timeoutMs?: number;
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

      // Wait for port -> POST /hello/test -> allow time for OTLP export -> SIGTERM.
      waitForPort(port)
        .then(() => httpPost(`http://127.0.0.1:${port}/hello/test`))
        .then(() => new Promise((r) => setTimeout(r, 200)))
        .then(() => {
          child.kill('SIGTERM');
        })
        .catch((err) => {
          child.kill('SIGKILL');
          clearTimeout(timer);
          reject(err);
        });
    });
  }

  function assertRequestLog() {
    assert.ok(
      stub.requestLogs.length >= 1,
      `expected request logs, got ${stub.requestLogs.length}`,
    );
    const log = stub.requestLogs[0]!;
    assert.equal(log.method, 'POST');
    assert.ok(
      log.url.includes('/hello/test'),
      `expected url to contain /hello/test, got ${log.url}`,
    );
    assert.equal(log.route, '/hello/{subject}');
    assert.ok(log.requestId, 'expected non-empty requestId');
    assert.equal(log.serviceName, 'xray-example');
    assert.equal(log.attributes?.subject, 'test');
    assert.ok(log.responseBody?.value, 'expected responseBody to be captured');
    assert.deepEqual(JSON.parse(log.responseBody!.value), {
      message: 'Hello test',
    });
  }

  beforeEach(async () => {
    stub = await createStub();
  });

  afterEach(async () => {
    await stub.close();
  });

  // -- Server examples ------------------------------------------------------

  test('effect', async () => {
    await spawnServer(path.join(ROOT, 'examples', 'effect', 'server.ts'));
    assertRequestLog();
  });

  test('effect (bun)', { skip: !hasBun }, async () => {
    await spawnServer(path.join(ROOT, 'examples', 'effect', 'server-bun.ts'), {
      cmd: 'bun',
    });
    assertRequestLog();
  });

  test('express', async () => {
    await spawnServer(path.join(ROOT, 'examples', 'express', 'server.ts'));
    assertRequestLog();
  });

  test('fastify', async () => {
    await spawnServer(path.join(ROOT, 'examples', 'fastify', 'server.ts'));
    assertRequestLog();
  });

  test('hono', async () => {
    await spawnServer(path.join(ROOT, 'examples', 'hono', 'server.ts'));
    assertRequestLog();
  });

  test('node-http', async () => {
    await spawnServer(path.join(ROOT, 'examples', 'node-http', 'server.ts'));
    assertRequestLog();
  });

  // -- Script examples ------------------------------------------------------

  test('edge', async () => {
    await spawnAndWait(path.join(ROOT, 'examples', 'edge', 'worker.ts'));
    assertRequestLog();
  });

  test('next-app', async () => {
    await spawnAndWait(path.join(ROOT, 'examples', 'next-app', 'route.ts'));
    assertRequestLog();
  });

  test('remix-app', async () => {
    await spawnAndWait(path.join(ROOT, 'examples', 'remix-app', 'entry.ts'));
    assertRequestLog();
  });
});
