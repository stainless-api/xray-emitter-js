import { Layer } from 'effect';
import { HttpServer } from '@effect/platform';
import { BunHttpServer, BunRuntime } from '@effect/platform-bun';
import { app, xray } from './app';

const port = 3000;
const ServerLive = BunHttpServer.layer({ port });
const AppLive = app.pipe(HttpServer.serve(), Layer.provide(ServerLive));

console.log(`Example app listening on port ${port}`);

const shutdown = async () => {
  await xray.shutdown();
  process.exit(0);
};

process.once('SIGINT', () => void shutdown());
process.once('SIGTERM', () => void shutdown());

BunRuntime.runMain(Layer.launch(AppLive));
