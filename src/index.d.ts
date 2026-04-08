import { Express } from 'express';
import { Server } from 'http';

export interface VoiceBotConfig {
  sipNumber?: string;
  port?: number;
  wsUrl?: string;
  elevenlabs: {
    agentId: string;
    apiKey?: string;
  };
}

export interface CallEvent {
  ucid: string;
  did?: string;
  metadata?: Record<string, any>;
}

export interface TranscriptEvent {
  ucid: string;
  role: 'user' | 'agent';
  text: string;
  isFinal: boolean;
}

export interface ToolCallEvent {
  ucid: string;
  name: string;
  params: Record<string, any>;
  id: string;
}

export interface PostStreamEvent {
  ucid: string;
  req: any;
  params: Record<string, any>;
}

export interface VoiceBotHooks {
  onCallStart?: (event: CallEvent) => void | Promise<void>;
  onCallEnd?: (event: { ucid: string }) => void | Promise<void>;
  onTranscript?: (event: TranscriptEvent) => void;
  onToolCall?: (event: ToolCallEvent) => any;
  onInterrupt?: (event: { ucid: string }) => void;
  onError?: (event: { ucid: string; error: Error }) => void;
  onCDR?: (data: any) => void;
  getInitData?: (event: { ucid: string; did: string }) => Record<string, any>;
  onPostStream?: (event: PostStreamEvent) => string | null;
}

export class KooKooVoiceBot {
  constructor(config: VoiceBotConfig, hooks?: VoiceBotHooks);
  use(...args: Parameters<Express['use']>): this;
  getExpressApp(): Express;
  start(): Promise<Server>;
  stop(): Promise<void>;
}

export const xml: {
  playAndHangup(text: string, lang?: string): string;
  transfer(number: string, record?: boolean): string;
  ccTransfer(queue: string, department?: string, timeout?: number): string;
  hangup(): string;
};

export function samplesToBase64(samples: number[]): string;
export function base64ToChunks(base64: string, chunkSize?: number): number[][];
export function buildMediaPacket(ucid: string, samples: number[]): string;
