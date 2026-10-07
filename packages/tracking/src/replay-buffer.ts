import { REPLAY_FORMAT, REPLAY_LIMITS, type ReplayChunk, type ReplayEvent, type ReplayCaptureSource } from './replay-contract';

// Preserve whole events and sequence numbers across retry. Losing a structural
// event invalidates the segment, rather than producing a misleading replay.
export class ReplayBuffer {
  private events: ReplayEvent[] = [];
  private bytes = 0;
  private sequence = 0;
  private queue: { chunk: ReplayChunk; body: string; bytes: number }[] = [];
  private segmentId = crypto.randomUUID();
  private captureSource: ReplayCaptureSource | undefined;
  private segments: { windowId: string; segmentId: string; count: number }[] = [];
  constructor(private readonly recordingId: string, private readonly windowId: string) {}
  setSource(source: ReplayCaptureSource) { this.captureSource = source; }
  get size() { return this.bytes + (this.events.length ? 1024 : 0) + this.queue.reduce((sum, item) => sum + item.bytes, 0); }
  get pending() { return this.queue.length; }
  get segment() { return this.segmentId; }
  inventory() { this.seal(); return [...this.segments, { windowId: this.windowId, segmentId: this.segmentId, count: this.sequence }].filter(segment => segment.count > 0); }
  push(event: ReplayEvent) {
    const bytes = new TextEncoder().encode(JSON.stringify(event)).byteLength + 1;
    if (bytes > (event.type === 2 ? REPLAY_LIMITS.snapshotBytes : REPLAY_LIMITS.eventBytes) || this.size + bytes + 1024 > REPLAY_LIMITS.bufferBytes) return false;
    if (this.bytes + bytes > REPLAY_LIMITS.chunkBytes - 1024 || this.events.length >= REPLAY_LIMITS.events) this.seal();
    this.events.push(event); this.bytes += bytes;
    if (bytes > REPLAY_LIMITS.eventBytes) this.seal();
    return true;
  }
  seal() {
    if (!this.events.length) return;
    const chunk: ReplayChunk = { version: 1, format: REPLAY_FORMAT, recordingId: this.recordingId, windowId: this.windowId,
      segmentId: this.segmentId, sequence: this.sequence++, recorderVersion: this.captureSource ? `posthog-js:${this.captureSource.sdkVersion}` : '2.1.6', ...(this.captureSource ? { captureSource: this.captureSource } : {}), events: this.events };
    const body = JSON.stringify(chunk);
    this.queue.push({ chunk, body, bytes: new TextEncoder().encode(body).byteLength });
    this.events = []; this.bytes = 0;
  }
  peek() { return this.queue[0]; }
  acknowledge() { this.queue.shift(); }
  restart() { this.seal(); this.segments.push({ windowId: this.windowId, segmentId: this.segmentId, count: this.sequence }); this.segmentId = crypto.randomUUID(); this.sequence = 0; }
  clear() { this.queue = []; this.events = []; this.bytes = 0; }
}
