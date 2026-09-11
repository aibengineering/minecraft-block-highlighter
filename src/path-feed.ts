import type { BlockHighlighter } from "./highlighter.js";
import type { Position3 } from "./types.js";
import { MAX_PATH_POINTS } from "./types.js";

/**
 * The shape a pathfinding bot has to have for its route to be drawn. Stated
 * structurally so this package keeps no dependency on mineflayer: anything
 * that emits the same events can be followed, including a test double.
 */
export interface PathEventSource {
  on(event: string, listener: (...args: any[]) => void): void;
  off?(event: string, listener: (...args: any[]) => void): void;
  removeListener?(event: string, listener: (...args: any[]) => void): void;
  entity?: { position?: Position3 | null } | null;
}

/** What the pathfinder reports as it plans; anything else is a route to draw. */
const EMPTY_STATUSES = new Set(["noPath", "timeout"]);

/**
 * Coordinates must already be numbers. Coercing instead would quietly turn a
 * null into the origin and draw a line through 0,0,0.
 */
function point(value: any): Position3 | null {
  const { x, y, z } = value ?? {};
  const finite = (coordinate: unknown) => typeof coordinate === "number" && Number.isFinite(coordinate);
  return finite(x) && finite(y) && finite(z) ? { x, y, z } : null;
}

/**
 * A route node names a block, so the line is drawn through the middle of it on
 * every axis. Anything less puts the line on a block corner or along its floor.
 */
export function routePoint(node: Position3): Position3 {
  return { x: node.x + 0.5, y: node.y + 0.5, z: node.z + 0.5 };
}

/**
 * The bot's own position is already exact in X and Z, but it is a foot
 * position, so only Y is lifted. Passing it through `routePoint` instead would
 * shift the first leg of the line sideways from where the bot actually stands.
 */
export function routeOrigin(position: Position3): Position3 {
  return { x: position.x, y: position.y + 0.5, z: position.z };
}

/**
 * Turn one pathfinder update into a drawable line: where the bot stands,
 * followed by the nodes it plans to walk. This is the single home for that
 * conversion, so an in-world overlay and a viewer overlay cannot disagree
 * about where the same route is.
 */
export function routeLine(currentPosition: unknown, update: unknown): Position3[] {
  const source = update as { path?: unknown } | null | undefined;
  const origin = point(currentPosition);
  const points = origin ? [routeOrigin(origin)] : [];
  if (!Array.isArray(source?.path)) return points;
  const limit = Math.min(source.path.length, MAX_PATH_POINTS - points.length);
  for (let i = 0; i < limit; i++) {
    const node = point(source.path[i]);
    if (node) points.push(routePoint(node));
  }
  return points;
}

/**
 * Draw the bot's route as it plans and re-plans, and rub it out when it stops
 * having one. Returns the unsubscribe, so a session can stop drawing without
 * the caller learning any highlighting vocabulary.
 *
 * The bot is the only source of route geometry here: nothing is inferred, and
 * a plan that never arrives simply leaves the previous route in place until
 * the goal is reached or the search gives up.
 */
export function followBotPath(bot: PathEventSource, highlighter: BlockHighlighter): () => void {
  const onUpdate = (update: any) => {
    const points = EMPTY_STATUSES.has(update?.status) ? [] : routeLine(bot.entity?.position, update);
    // One point is a dot, not a route: the bot standing still with no plan.
    if (points.length < 2) {
      highlighter.clearPath();
      return;
    }
    highlighter.publishPath({ points });
  };
  const onFinished = () => highlighter.clearPath();

  bot.on("path_update", onUpdate);
  bot.on("goal_reached", onFinished);
  bot.on("path_stop", onFinished);

  return () => {
    const off = bot.off ?? bot.removeListener;
    off?.call(bot, "path_update", onUpdate);
    off?.call(bot, "goal_reached", onFinished);
    off?.call(bot, "path_stop", onFinished);
    highlighter.clearPath();
  };
}
