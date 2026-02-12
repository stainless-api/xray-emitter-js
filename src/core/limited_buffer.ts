export class LimitedBuffer {
  private buffer: Uint8Array;
  private length: number;
  private readonly limit: number;
  private truncatedFlag: boolean;
  private total: number;

  constructor(limit: number) {
    const normalized = Number.isFinite(limit) ? Math.max(0, limit) : 0;
    const initialCap = Math.min(normalized, 32 * 1024);
    this.buffer = new Uint8Array(initialCap);
    this.length = 0;
    this.limit = normalized;
    this.truncatedFlag = false;
    this.total = 0;
  }

  bytes(): Uint8Array {
    return this.buffer.slice(0, this.length);
  }

  capturedBytes(): number {
    return this.length;
  }

  totalBytes(): number {
    return this.total;
  }

  truncated(): boolean {
    return this.truncatedFlag;
  }

  write(chunk: Uint8Array): void {
    if (!chunk || chunk.length === 0) {
      return;
    }

    this.total += chunk.length;
    if (this.limit <= 0) {
      this.truncatedFlag = true;
      return;
    }

    const remaining = this.limit - this.length;
    if (remaining <= 0) {
      this.truncatedFlag = true;
      return;
    }

    const toCopy = Math.min(remaining, chunk.length);
    this.ensureCapacity(this.length + toCopy);
    this.buffer.set(chunk.subarray(0, toCopy), this.length);
    this.length += toCopy;
    if (toCopy < chunk.length) {
      this.truncatedFlag = true;
    }
  }

  private ensureCapacity(size: number): void {
    if (this.buffer.length >= size) {
      return;
    }

    let nextSize = this.buffer.length;
    if (nextSize === 0) {
      nextSize = 1;
    }
    while (nextSize < size) {
      nextSize *= 2;
    }
    if (nextSize > this.limit) {
      nextSize = this.limit;
    }
    const next = new Uint8Array(nextSize);
    next.set(this.buffer.subarray(0, this.length));
    this.buffer = next;
  }
}
