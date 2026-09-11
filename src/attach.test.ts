import { describe, expect, test } from "bun:test";
import { EventEmitter } from "node:events";
import { attachHighlighter } from "./attach.js";

class FakeBot extends EventEmitter {
  entity = { position: { x: 0, y: 64, z: 0 } };
  game = { dimension: "minecraft:the_nether" };
}

describe("attachHighlighter", () => {
  test("immediate stop closes startup and removes all owned listeners", async () => {
    const bot = new FakeBot();
    const attached = attachHighlighter(bot, { port: 0 });
    const starting = attached.highlighter.startServer();
    const stopping = attached.stop();
    expect(attached.stop()).toBe(stopping);
    await stopping;
    expect((await starting).listening).toBe(false);
    expect(bot.eventNames()).toEqual([]);
    expect(await attached.ready).toEqual({});
  });
  test("draws the bot's route without any further wiring", () => {
    const bot = new FakeBot();
    const { highlighter } = attachHighlighter(bot, { serveStandalone: false });

    bot.emit("path_update", { status: "success", path: [{ x: 1, y: 64, z: 0 }] });

    expect(highlighter.snapshot().path?.points).toEqual([{ x: 0, y: 64.5, z: 0 }, { x: 1.5, y: 64.5, z: 0.5 }]);
  });

  test("captures the bot's dimension when geometry is published", async () => {
    const bot = new FakeBot();
    const { highlighter } = attachHighlighter(bot, { serveStandalone: false });

    await highlighter.publish([{ x: 1, y: 2, z: 3, colour: "#ffffff" }]);
    expect(highlighter.snapshot().highlights[0]?.dimension).toBe("minecraft:the_nether");

    bot.game.dimension = "minecraft:the_end";
    expect(highlighter.snapshot().highlights[0]?.dimension).toBe("minecraft:the_nether");

    bot.emit("path_update", { status: "success", path: [{ x: 1, y: 64, z: 0 }] });
    expect(highlighter.snapshot().path?.dimension).toBe("minecraft:the_end");
  });

  test("stops drawing when the bot disconnects", () => {
    const bot = new FakeBot();
    const { highlighter } = attachHighlighter(bot, { serveStandalone: false });

    bot.emit("path_update", { status: "success", path: [{ x: 1, y: 64, z: 0 }] });
    bot.emit("end");
    bot.emit("path_update", { status: "success", path: [{ x: 8, y: 64, z: 0 }] });

    expect(highlighter.snapshot().path).toBeNull();
  });

  test("survives a port that is already taken", async () => {
    const first = attachHighlighter(new FakeBot(), { port: 0 });
    const server = await first.highlighter.startServer();
    const address = server.address() as { port: number };
    const second = attachHighlighter(new FakeBot(), { port: address.port });
    try {
      expect((await second.ready).error).toMatchObject({ code: "EADDRINUSE" });
    } finally {
      await second.stop();
      await first.stop();
    }
  });

  test("stopping twice is harmless", async () => {
    const attached = attachHighlighter(new FakeBot(), { serveStandalone: false });
    await attached.stop();
    await attached.stop();
  });
});
