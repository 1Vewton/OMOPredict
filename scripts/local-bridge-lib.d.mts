// Type declarations for the local debug bridge (scripts/lib/local-bridge.mjs).
//
// The implementation is plain ESM JavaScript on purpose: it must run on a bare Node install, with
// no build step and no dependencies. It is unit-tested from the desktop package
// (desktop/src/shell/localBridge.test.ts), which is type-checked, so the public surface is
// declared here rather than leaving that test to consume an implicit `any`.
//
// Keep this file in sync with scripts/lib/local-bridge.mjs.

import type { IncomingMessage, Server, ServerResponse } from 'node:http'

/** JSON-RPC reserved error codes (same family as Go `internal/rpc`). */
export declare const PARSE_ERROR: number
export declare const INVALID_REQUEST: number
export declare const METHOD_NOT_FOUND: number
export declare const INVALID_PARAMS: number

/** Single-line ceiling; must match the Go side (16 MiB). */
export declare const MAX_LINE_BYTES: number

/** Default per-RPC timeout in milliseconds. */
export declare const DEFAULT_CALL_TIMEOUT_MS: number

/** Extension -> Content-Type table. */
export declare const MIME_TYPES: Record<string, string>

/** Headers attached to every bridge response. */
export declare const COMMON_HEADERS: Record<string, string>

/** The row `GET /api/auth/me` answers with in single-user mode. */
export declare const LOCAL_USER: { id: string; username: string }

/** Content-Type for a path (unknown extensions -> application/octet-stream). */
export declare function mimeFor(filePath: string): string

/** Options for {@link resolveStaticFile}; all are injection points for tests. */
export interface ResolveStaticDeps {
  exists?: (path: string) => boolean
  isFile?: (path: string) => boolean
  platform?: string
}

/** A resolved renderer asset. */
export interface ResolvedAsset {
  filePath: string
  mimeType: string
  /** true when the request was an unknown path served by index.html (SPA deep link). */
  spaFallback: boolean
}

/**
 * Resolve a URL pathname to a file inside the renderer dist directory.
 *
 * Returns null when the renderer is not built, the path is malformed, or it expresses traversal
 * intent. The rule is **intent, not outcome**: any path containing a `.`/`..` segment is refused
 * before resolving (separator-agnostic), because such paths can normalise back *inside* the root
 * and would otherwise be answered with a 200 + index.html SPA fallback. Callers answer 404.
 */
export declare function resolveStaticFile(
  pathname: string,
  rootDir: string,
  deps?: ResolveStaticDeps,
): ResolvedAsset | null

/** A successful REST -> RPC mapping. */
export interface MappedCall {
  rpc: string
  params?: unknown
  /** HTTP status to answer with on success (202 for tasks.create). */
  status: number
}

/** A request that belongs to the API but is ill-formed or not allowed. */
export interface MappedFailure {
  error: string
  status: number
}

/**
 * Map one decoded HTTP request onto a `internal/rpc` method + params.
 *
 * Returns null when the path is not an API route (the caller serves statics instead).
 */
export declare function mapRequest(
  method: string,
  pathname: string,
  body?: unknown,
): MappedCall | MappedFailure | null

/** Error carrying an HTTP-ish status code. */
export declare class BridgeRpcError extends Error {
  readonly code: number
  constructor(code: number, message: string)
}

/** Minimal duplex sink the client writes request lines to. */
export interface JsonLinesIo {
  write(line: string): unknown
}

export interface JsonLinesClientOptions {
  timeoutMs?: number
  onProtocolError?: (message: string) => void
}

/** Newline-delimited JSON-RPC 2.0 client (id-correlated, tolerant of stdout pollution). */
export declare class JsonLinesClient {
  constructor(io: JsonLinesIo, opts?: JsonLinesClientOptions)
  /** Number of in-flight calls. */
  readonly pendingCount: number
  request<T = unknown>(
    method: string,
    params?: unknown,
    callOpts?: { timeoutMs?: number },
  ): Promise<T>
  /** Feed raw stdout; tolerates partial lines and CRLF. */
  acceptChunk(chunk: Buffer | string): void
  /** Handle one complete response line. */
  acceptLine(line: string): void
  /** Reject every in-flight call (peer exited). */
  failAll(message: string): void
  /** Refuse new calls. */
  shutdown(): void
}

/** Map a bridge/RPC failure onto an HTTP status code. */
export declare function statusForError(e: unknown): number

/** Write a JSON response. */
export declare function sendJson(res: ServerResponse, status: number, payload: unknown): void

/** Write `{ error }` as JSON. */
export declare function sendError(res: ServerResponse, status: number, message: string): void

/** Read and JSON-parse a request body (empty body -> undefined). */
export declare function readJsonBody(req: IncomingMessage): Promise<unknown>

/** Collapsed RPC client surface the handler needs. */
export interface BridgeClient {
  request(method: string, params?: unknown): Promise<unknown>
}

export interface BridgeHandlerOptions {
  client: BridgeClient
  distDir: string
  log?: (message: string) => void
  /** Injection point for static resolution (tests). */
  resolveStatic?: typeof resolveStaticFile
}

/** Build the bridge's HTTP request handler. */
export declare function createBridgeHandler(
  opts: BridgeHandlerOptions,
): (req: IncomingMessage, res: ServerResponse) => void

/** Create (but do not start) the bridge HTTP server. */
export declare function createBridgeServer(opts: BridgeHandlerOptions): Server
