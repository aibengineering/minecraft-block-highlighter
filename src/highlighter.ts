import http from "node:http";
import type {
  AmbientHighlighterContext,
  BlockHighlight,
  BotPath,
  PublishedPath,
  BlockHighlighterFeedSnapshot,
  BlockHighlighterOptions,
  BlockHighlighterPublishedHighlight,
  HighlightOptions,
} from "./types.js";
import { DEFAULT_BLOCK_HIGHLIGHTER_PORT, MAX_PATH_POINTS } from "./types.js";

/** Used when a caller does not say how long its highlight is worth holding. */
const DEFAULT_HOLD_MS = 700;
/** Amber, so a route reads as distinct from any block highlight colour. */
const DEFAULT_PATH_COLOUR = "#ffc440" as const;
const HIGHLIGHTS_PATH = "/debug/api/highlights";
/** The mod polls every 25 ms, so silence this long means the client is gone. */
const DEFAULT_LISTENER_TIMEOUT_MS = 2_000;

export interface PublishOptions extends HighlightOptions {}

export class BlockHighlighter {
  static #defaultInstance?: BlockHighlighter;

  static get default(): BlockHighlighter {
    if (!this.#defaultInstance) {
      this.#defaultInstance = new BlockHighlighter();
    }
    return this.#defaultInstance;
  }

  static setDefault(instance: BlockHighlighter): void {
    this.#defaultInstance = instance;
  }

  port: number;
  maxHighlights: number;
  listenerTimeoutMs: number;

  #server?: http.Server;
  #starting?: Promise<http.Server>;
  #stopping?: Promise<void>;
  #revision = 0;
  #label = "";
  #highlights: BlockHighlighterPublishedHighlight[] = [];
  #lastPolledAt = 0;
  #path: PublishedPath | null = null;
  #pathRevision = 0;
  #currentDimension: () => string | undefined;

  constructor(options: BlockHighlighterOptions = {}, currentDimension: () => string | undefined = () => undefined) {
    this.port = options.port ?? DEFAULT_BLOCK_HIGHLIGHTER_PORT;
    this.maxHighlights = options.maxHighlights ?? 768;
    this.listenerTimeoutMs = options.listenerTimeoutMs ?? DEFAULT_LISTENER_TIMEOUT_MS;
    this.#currentDimension = currentDimension;
  }

  snapshot(): BlockHighlighterFeedSnapshot {
    return {
      label: this.#label,
      revision: this.#revision,
      highlights: this.#highlights,
      path: this.#path,
    };
  }

  /**
   * Replace the drawn route. Unlike `publish`, this never waits: a route is
   * ambient state that the bot overwrites as it re-plans, so there is nothing
   * to step through and nothing to hold a caller on.
   */
  publishPath(path: BotPath): void {
    this.#path = {
      points: path.points.slice(0, MAX_PATH_POINTS).map(({ x, y, z }) => ({ x, y, z })),
      colour: path.colour ?? DEFAULT_PATH_COLOUR,
      dimension: this.#currentDimension(),
      revision: ++this.#pathRevision,
      publishedAt: Date.now(),
    };
  }

  clearPath(): void {
    if (!this.#path) return;
    this.#path = null;
    this.#pathRevision += 1;
  }

  async publish(highlights: BlockHighlight[], options: PublishOptions = {}): Promise<void> {
    const signal = options.signal;
    signal?.throwIfAborted();

    const revealIntervalMs = options.revealIntervalMs ?? 0;

    const now = Date.now();
    const dimension = this.#currentDimension();
    this.#label = options.label ?? "";
    const source = highlights.slice(0, this.maxHighlights);
    const revealDurationMs = Math.max(0, source.length - 1) * revealIntervalMs;
    const holdMs = options.holdMs ?? DEFAULT_HOLD_MS;
    const expiresAt = now + revealDurationMs + holdMs;

    this.#highlights = source.map((block, index) => ({
      x: block.x,
      y: block.y,
      z: block.z,
      colour: block.colour,
      dimension,
      visibleAt: now + index * revealIntervalMs,
      expiresAt,
    }));
    this.#revision += 1;

    if (options.waitUntil !== "expired") return;

    // Waiting through the same lifetime the caller assigned to the picture
    // prevents a following publication from replacing a staged checkpoint.
    const waitMs = revealDurationMs + holdMs;
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        if (signal) signal.removeEventListener("abort", onAbort);
        resolve();
      }, waitMs);
      function onAbort() {
        clearTimeout(timeout);
        signal?.removeEventListener("abort", onAbort);
        reject(signal?.reason ?? new Error("Highlight wait aborted"));
      }
      if (signal) {
        if (signal.aborted) {
          clearTimeout(timeout);
          reject(signal.reason);
          return;
        }
        signal.addEventListener("abort", onAbort);
      }
    });
  }

  /** Record that a client just read the feed. */
  observePoll(): void {
    this.#lastPolledAt = Date.now();
  }

  /**
   * Whether a client read the feed recently enough to still be watching.
   * Highlighting follows its audience: with nobody reading, collections built
   * inside `scope()` skip highlight work; ordinary array operations still run.
   */
  listening(): boolean {
    return Date.now() - this.#lastPolledAt < this.listenerTimeoutMs;
  }

  /** The ambient context for one run, so callers need no highlighting vocabulary. */
  scope(signal?: AbortSignal): AmbientHighlighterContext {
    return { enabled: this.listening(), highlighter: this, signal };
  }

  /**
   * Serve the feed from a host that already owns an HTTP listener, so the
   * highlighter needs no port of its own. Returns null for anything it does
   * not answer, leaving the caller's own routing untouched.
   */
  handle(method: string, url: string): { status: number; body: unknown } | null {
    const { pathname } = new URL(url, "http://127.0.0.1");
    if (pathname === HIGHLIGHTS_PATH && method === "GET") {
      this.observePoll();
      return { status: 200, body: this.snapshot() };
    }
    return null;
  }

  startServer(port = this.port): Promise<http.Server> {
    if (this.#stopping) return this.#stopping.then(() => this.startServer(port));
    if (this.#starting) return this.#starting;
    if (this.#server) return Promise.resolve(this.#server);
    this.port = port;

    this.#starting = new Promise<http.Server>((resolve, reject) => {
      const server = http.createServer((request, response) => {
        const answer = this.handle(request.method ?? "GET", request.url ?? "/") ?? {
          status: 404,
          body: { error: "Not found" },
        };
        response.writeHead(answer.status, {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
        });
        response.end(JSON.stringify(answer.body));
      });

      server.once("error", reject);
      server.listen(this.port, "127.0.0.1", () => {
        this.#server = server;
        resolve(server);
      });
    }).finally(() => { this.#starting = undefined; });
    return this.#starting;
  }

  stopServer(): Promise<void> {
    if (this.#stopping) return this.#stopping;
    this.#stopping = (async () => {
      // A failed bind owns no listener, but a pending successful bind must close.
      await this.#starting?.catch(() => {});
      const server = this.#server;
      if (!server) return;
      await new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });
      this.#server = undefined;
      this.#lastPolledAt = 0;
    })().finally(() => { this.#stopping = undefined; });
    return this.#stopping;
  }
}
