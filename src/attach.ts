import { BlockHighlighter } from "./highlighter.js";
import { followBotPath, type PathEventSource } from "./path-feed.js";
import type { BlockHighlighterOptions } from "./types.js";

/** A bot whose route can be drawn and whose current dimension can be sampled. */
export interface HighlightableBot extends PathEventSource {
  game?: { dimension?: string } | null;
}

export interface AttachOptions extends BlockHighlighterOptions {
  /**
   * Start a standalone listener owned by the highlighter. Hosts that already
   * own an HTTP server should pass false and mount `handle()` on their own
   * routing instead, so there is only ever one listener on the port.
   */
  serveStandalone?: boolean;
}

export interface AttachedHighlighter {
  highlighter: BlockHighlighter;
  /** Startup failure is reported as data so an optional overlay cannot reject gameplay. */
  ready: Promise<{ error?: unknown }>;
  /** Stop drawing and release the listener. Safe to call more than once. */
  stop: () => Promise<void>;
}

/**
 * Wire a bot to a highlighter: routes follow it from now on and published
 * geometry is stamped with the bot's dimension. By default the highlighter
 * also owns a standalone feed listener; shared HTTP hosts can opt out and mount
 * `handle()` themselves.
 *
 * Everything a caller needs is in the return value, so no part of this has to
 * be repeated by the packages that use it.
 */
export function attachHighlighter(bot: HighlightableBot, options: AttachOptions = {}): AttachedHighlighter {
  const { serveStandalone = true, ...highlighterOptions } = options;
  const highlighter = new BlockHighlighter(highlighterOptions, () => bot.game?.dimension);

  const unfollow = followBotPath(bot, highlighter);
  let stopping: Promise<void> | undefined;
  const stop = () => {
    if (stopping) return stopping;
    unfollow();
    const off = bot.off ?? bot.removeListener;
    off?.call(bot, "end", onEnd);
    stopping = highlighter.stopServer();
    return stopping;
  };

  // A bot that goes away takes its overlay with it; without this a scenario
  // that runs repeatedly would leave a listener behind on every pass.
  const onEnd = () => { void stop().catch(error => console.warn("Block Highlighter shutdown failed", error)); };
  bot.on("end", onEnd);

  const ready = serveStandalone
    ? highlighter.startServer().then(() => ({}), error => ({ error }))
    : Promise.resolve({});

  return { highlighter, ready, stop };
}
