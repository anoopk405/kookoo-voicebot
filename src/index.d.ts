import { Express } from 'express';
import { Server } from 'http';

export interface ElevenLabsConfig {
  agentId: string;
  apiKey?: string;
}

export interface OpenAITool {
  type: 'function';
  name: string;
  description: string;
  parameters: Record<string, any>;
}

export interface OpenAIConfig {
  apiKey: string;
  model?: string;
  voice?: 'alloy' | 'echo' | 'fable' | 'onyx' | 'nova' | 'shimmer';
  instructions?: string;
  tools?: OpenAITool[];
}

export interface VoiceBotConfig {
  sipNumber?: string;
  provider?: 'elevenlabs' | 'openai';
  port?: number;
  wsUrl?: string;
  elevenlabs?: ElevenLabsConfig;
  openai?: OpenAIConfig;
}

export interface CallStartEvent {
  ucid: string;
  did?: string;
  callerId?: string;
  callerDetails?: Record<string, any>;
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
  onCallStart?: (event: CallStartEvent) => void | Promise<void>;
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

export class ElevenLabsSession {
  constructor(opts: any);
  connect(): void;
  sendAudio(base64: string): void;
  close(): void;
  connected: boolean;
}

export class OpenAIRealtimeSession {
  constructor(opts: any);
  connect(): void;
  sendAudio(base64: string): void;
  close(): void;
  connected: boolean;
}

export function samplesToBase64(samples: number[], targetRate?: number): string;
export function base64ToChunks(base64: string, sourceRate?: number, chunkSize?: number): number[][];
export function samplesToBase64_24k(samples: number[]): string;
export function base64ToChunks_24k(base64: string, chunkSize?: number): number[][];
export function buildMediaPacket(ucid: string, samples: number[]): string;
