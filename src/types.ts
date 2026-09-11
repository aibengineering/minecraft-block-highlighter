export interface Position3 {
  x: number;
  y: number;
  z: number;
}

export type BlockColour = `#${string}`;

export type HighlightableBlock = Position3 | { position: Position3 };

export interface BlockHighlight {
  x: number;
  y: number;
  z: number;
  colour: BlockColour;
}

/**
 * A route through the world, drawn as a line rather than as a set of cells.
 *
 * Paths are kept apart from block highlights because they are a different
 * shape of thing: an ordered sequence with a head, replaced wholesale every
 * time the bot re-plans, and never accumulated the way blocks are. They are also wanted
 * at different times, which is why each overlay has its own switch.
 */
export interface BotPath {
  /**
   * The whole line, starting where the bot stands. Callers hand over finished
   * geometry rather than pieces the renderer has to assemble.
   */
  points: Position3[];
  colour?: BlockColour;
}

export interface PublishedPath extends BotPath {
  dimension?: string;
  revision: number;
  publishedAt: number;
}

export type PublishBlockCollection = (
  blocks: import("./block-collection.js").BlockCollection<any>,
  options?: HighlightOptions,
) => Promise<void>;

export interface BlockHighlighterPublishedHighlight {
  x: number;
  y: number;
  z: number;
  colour: string;
  dimension?: string;
  visibleAt?: number;
  expiresAt: number;
}

export interface BlockHighlighterFeedSnapshot {
  label?: string;
  revision: number;
  highlights: BlockHighlighterPublishedHighlight[];
  path: PublishedPath | null;
}

export interface BlockHighlighterOptions {
  port?: number;
  /** How long after a poll a client still counts as watching. */
  listenerTimeoutMs?: number;
  maxHighlights?: number;
}

export interface AmbientHighlighterContext {
  /**
   * Whether anything is listening. Collections created inside this context
   * inherit it and skip highlight accumulation and publication when false.
   * Construction and ordinary array operations still retain and process blocks.
   * Leave undefined to keep highlighting live.
   */
  enabled?: boolean;
  highlighter?: import("./highlighter.js").BlockHighlighter;
  publish?: PublishBlockCollection;
  signal?: AbortSignal;
  step?: string;
}

export interface HighlightOptions {
  label?: string;
  signal?: AbortSignal;
  step?: string;
  revealIntervalMs?: number;
  /**
   * How long the highlight stays up once it has finished revealing. The caller
   * knows what the highlight is for — a glance at one block or a look at a
   * whole rejected pass — so how long it is worth holding is theirs to say.
   */
  holdMs?: number;
  /** Resolve after publication, or after this highlight has finished its visible lifetime. */
  waitUntil?: "published" | "expired";
}

export interface BlockCollectionOptions {
  label?: string;
  enabled?: boolean;
  signal?: AbortSignal;
  highlighter?: import("./highlighter.js").BlockHighlighter;
  publish?: PublishBlockCollection;
}

export const DEFAULT_BLOCK_HIGHLIGHTER_PORT = 25575;
/** Maximum route geometry retained and rendered by the companion mod. */
export const MAX_PATH_POINTS = 512;
export const DEFAULT_BLOCK_HIGHLIGHTER_ENDPOINT = "http://127.0.0.1:25575/debug/api/highlights";
