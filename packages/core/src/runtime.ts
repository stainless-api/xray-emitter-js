export function isNodeRuntime(): boolean {
  const maybeProcess = (
    globalThis as typeof globalThis & {
      process?: { versions?: { node?: string } };
    }
  ).process;
  return !!maybeProcess?.versions?.node;
}
