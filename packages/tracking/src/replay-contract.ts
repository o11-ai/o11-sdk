export const REPLAY_FORMAT = 'rrweb-jsonl-v1' as const;
export const REPLAY_LIMITS = { chunkBytes: 256_000, eventBytes: 240_000, snapshotBytes: 1_000_000, bufferBytes: 2_000_000, events: 2000, flushMs: 5000 } as const;
export type ReplayEvent = { type: number; timestamp: number; data: unknown };
export type ReplaySession = { recordingId: string; token: string; expiresAt: string; serverTime?: string; sampleRate: number; enabled: boolean };
export type ReplayCaptureSource = { provider: 'posthog'; sdkVersion: string; sessionId: string; windowId: string };
export type ReplayChunk = { version: 1; format: typeof REPLAY_FORMAT; recordingId: string; windowId: string; segmentId: string; sequence: number; recorderVersion: string; captureSource?: ReplayCaptureSource; events: ReplayEvent[] };
export type ReplayStatus = 'stopped' | 'starting' | 'recording' | 'paused' | 'sampled-out' | 'failed' | 'waiting-for-replay';
