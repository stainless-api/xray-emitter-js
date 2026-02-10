import {
  diag,
  ROOT_CONTEXT,
  SpanKind,
  SpanStatusCode,
  type Context,
  type Span,
  type Tracer,
} from '@opentelemetry/api';
import {
  AlwaysOnSampler,
  BasicTracerProvider,
  BatchSpanProcessor,
  type ReadableSpan,
  SimpleSpanProcessor,
  type Span as SDKSpan,
  type SpanExporter,
  type SpanProcessor,
} from '@opentelemetry/sdk-trace-base';
import { resourceFromAttributes } from '@opentelemetry/resources';
import {
  ATTR_SERVICE_NAME,
  ATTR_TELEMETRY_SDK_LANGUAGE,
  ATTR_TELEMETRY_SDK_NAME,
  ATTR_TELEMETRY_SDK_VERSION,
} from '@opentelemetry/semantic-conventions';
import { AttributeKeySpanDrop } from './attrkey';
import type { ResolvedXrayConfig } from './config';

const defaultAttributeCountLimit = 128;

export interface TracerProviderLike {
  forceFlush: () => Promise<void>;
  getTracer: (name: string, version?: string) => Tracer;
  shutdown: () => Promise<void>;
}

export function createTracerProvider(
  config: ResolvedXrayConfig,
  exporter: SpanExporter,
): TracerProviderLike {
  if (config.exporter.endpointUrl.startsWith('http://')) {
    diag.warn('xray: OTLP endpoint uses plaintext HTTP');
  }

  const attributeValueLengthLimit = Math.max(1, Math.ceil((config.capture.maxBodyBytes * 4) / 3));

  const resource = resourceFromAttributes({
    [ATTR_SERVICE_NAME]: config.serviceName,
    [ATTR_TELEMETRY_SDK_LANGUAGE]: isNodeRuntime() ? 'nodejs' : 'webjs',
    [ATTR_TELEMETRY_SDK_NAME]: 'stainless-xray',
    [ATTR_TELEMETRY_SDK_VERSION]: sdkVersion(),
  });

  const spanProcessor = createSpanProcessor(config.exporter.spanProcessor, exporter);
  const dropProcessor = new DropFilterSpanProcessor(spanProcessor);

  const provider = new BasicTracerProvider({
    forceFlushTimeoutMillis: 30_000,
    generalLimits: {
      attributeCountLimit: defaultAttributeCountLimit,
      attributeValueLengthLimit,
    },
    resource,
    sampler: new AlwaysOnSampler(),
    spanLimits: {
      attributeCountLimit: defaultAttributeCountLimit,
      attributePerEventCountLimit: defaultAttributeCountLimit,
      attributePerLinkCountLimit: defaultAttributeCountLimit,
      attributeValueLengthLimit,
      eventCountLimit: defaultAttributeCountLimit,
      linkCountLimit: defaultAttributeCountLimit,
    },
    spanProcessors: [dropProcessor],
  });

  return provider;
}

export function tracerFromProvider(provider: TracerProviderLike): Tracer {
  return provider.getTracer('stainless-xray');
}

export function spanFromTracer(tracer: Pick<Tracer, 'startSpan'>, name: string): Span {
  return tracer.startSpan(name, { kind: SpanKind.SERVER }, ROOT_CONTEXT);
}

export function spanStatusFromError(span: Span, err: unknown): void {
  if (err instanceof Error) {
    span.recordException(err);
  } else if (typeof err === 'string') {
    span.recordException(err);
  } else {
    span.recordException({ message: String(err) });
  }
  span.setStatus({ code: SpanStatusCode.ERROR });
}

class DropFilterSpanProcessor implements SpanProcessor {
  private readonly next: SpanProcessor;

  constructor(next: SpanProcessor) {
    this.next = next;
  }

  forceFlush(): Promise<void> {
    return this.next.forceFlush();
  }

  onEnd(span: ReadableSpan): void {
    if (span.attributes[AttributeKeySpanDrop] === true) {
      return;
    }
    this.next.onEnd(span);
  }

  onStart(span: SDKSpan, parentContext: Context): void {
    this.next.onStart(span, parentContext);
  }

  shutdown(): Promise<void> {
    return this.next.shutdown();
  }
}

function createSpanProcessor(mode: 'simple' | 'batch', exporter: SpanExporter): SpanProcessor {
  if (mode === 'simple') {
    return new SimpleSpanProcessor(exporter);
  }

  return new BatchSpanProcessor(exporter, {
    maxQueueSize: 2048,
    maxExportBatchSize: 512,
    scheduledDelayMillis: 5_000,
    exportTimeoutMillis: 30_000,
  });
}

function sdkVersion(): string {
  if (typeof __XRAY_VERSION__ !== 'undefined') {
    return __XRAY_VERSION__;
  }
  return 'unknown';
}

function isNodeRuntime(): boolean {
  const maybeProcess = (
    globalThis as typeof globalThis & {
      process?: { versions?: { node?: string } };
    }
  ).process;
  return !!maybeProcess?.versions?.node;
}
