import { describe, expect, test } from "bun:test";
import { EventEmitter } from "node:events";
import { BlockHighlighter } from "./highlighter.js";
import { followBotPath, routeLine } from "./path-feed.js";

class FakeBot extends EventEmitter {
  entity = { position: { x: 0, y: 64, z: 0 } };
}

describe("followBotPath", () => {
  test("does not inspect route nodes beyond the render budget", () => {
    const path = Array.from({ length: 511 }, (_, x) => ({ x, y: 64, z: 0 }));
    Object.defineProperty(path, 511, { get() { throw new Error("outside budget"); } });
    expect(routeLine({ x: 0, y: 64, z: 0 }, { path })).toHaveLength(512);
  });

  test("publication bounds and copies geometry owned by the caller", () => {
    const highlighter = new BlockHighlighter();
    const points = Array.from({ length: 1000 }, (_, x) => ({ x, y: 64, z: 0 }));
    highlighter.publishPath({ points });
    points[0].x = 999;
    expect(highlighter.snapshot().path?.points).toHaveLength(512);
    expect(highlighter.snapshot().path?.points[0].x).toBe(0);
  });
  test("draws the route the bot reports, from where it stands", () => {
    const bot = new FakeBot();
    const highlighter = new BlockHighlighter();
    followBotPath(bot, highlighter);

    bot.emit("path_update", { status: "success", path: [{ x: 1, y: 64, z: 0 }, { x: 2, y: 64, z: 1 }] });

    // The line starts where the bot stands (Y lifted to mid-body) and runs
    // through the middle of every block it plans to walk.
    expect(highlighter.snapshot().path?.points).toEqual([
      { x: 0, y: 64.5, z: 0 },
      { x: 1.5, y: 64.5, z: 0.5 },
      { x: 2.5, y: 64.5, z: 1.5 },
    ]);
  });

  test("replaces the route as the bot re-plans", () => {
    const bot = new FakeBot();
    const highlighter = new BlockHighlighter();
    followBotPath(bot, highlighter);

    bot.emit("path_update", { status: "success", path: [{ x: 1, y: 64, z: 0 }] });
    bot.emit("path_update", { status: "partial", path: [{ x: 5, y: 64, z: 0 }] });

    expect(highlighter.snapshot().path?.points).toEqual([{ x: 0, y: 64.5, z: 0 }, { x: 5.5, y: 64.5, z: 0.5 }]);
  });

  test("rubs the route out when the search gives up", () => {
    const bot = new FakeBot();
    const highlighter = new BlockHighlighter();
    followBotPath(bot, highlighter);

    bot.emit("path_update", { status: "success", path: [{ x: 1, y: 64, z: 0 }] });
    bot.emit("path_update", { status: "noPath", path: [] });

    expect(highlighter.snapshot().path).toBeNull();
  });

  test("rubs the route out on arrival", () => {
    const bot = new FakeBot();
    const highlighter = new BlockHighlighter();
    followBotPath(bot, highlighter);

    bot.emit("path_update", { status: "success", path: [{ x: 1, y: 64, z: 0 }] });
    bot.emit("goal_reached");

    expect(highlighter.snapshot().path).toBeNull();
  });

  test("ignores nodes that are not points rather than drawing a broken line", () => {
    const bot = new FakeBot();
    const highlighter = new BlockHighlighter();
    followBotPath(bot, highlighter);

    bot.emit("path_update", { status: "success", path: [{ x: 1, y: 64, z: 0 }, { x: null, y: 64, z: 0 }] });

    expect(highlighter.snapshot().path?.points).toEqual([{ x: 0, y: 64.5, z: 0 }, { x: 1.5, y: 64.5, z: 0.5 }]);
  });

  test("stops drawing once unsubscribed", () => {
    const bot = new FakeBot();
    const highlighter = new BlockHighlighter();
    const stop = followBotPath(bot, highlighter);

    bot.emit("path_update", { status: "success", path: [{ x: 1, y: 64, z: 0 }] });
    stop();
    bot.emit("path_update", { status: "success", path: [{ x: 7, y: 64, z: 0 }] });

    expect(highlighter.snapshot().path).toBeNull();
  });
});
