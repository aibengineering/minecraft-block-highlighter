import { describe, expect, test, afterEach } from "bun:test";
import type { HighlightFrame } from "./types.js";
import { BlockHighlighter } from "./highlighter.js";

describe("paths", () => {
  test("are carried in the same snapshot as the highlights", () => {
    const highlighter = new BlockHighlighter();
    highlighter.publishPath({ points: [{ x: 1, y: 2, z: 3 }] });
    // One poll, both overlays: what a client draws is its own decision.
    expect(highlighter.snapshot().path?.points).toEqual([{ x: 1, y: 2, z: 3 }]);
  });

  test("replace one another rather than accumulating", () => {
    const highlighter = new BlockHighlighter();
    highlighter.publishPath({ points: [{ x: 0, y: 0, z: 0 }] });
    highlighter.publishPath({ points: [{ x: 9, y: 9, z: 9 }] });
    const path = highlighter.snapshot().path;
    expect(path?.points).toEqual([{ x: 9, y: 9, z: 9 }]);
    expect(path?.revision).toBe(2);
  });

  test("clear back to nothing", () => {
    const highlighter = new BlockHighlighter();
    highlighter.publishPath({ points: [{ x: 0, y: 0, z: 0 }] });
    highlighter.clearPath();
    expect(highlighter.snapshot().path).toBeNull();
  });
});

describe("BlockHighlighter Server & HTTP API", () => {
  let highlighter: BlockHighlighter | undefined;

  afterEach(async () => {
    if (highlighter) {
      await highlighter.stopServer();
      highlighter = undefined;
    }
  });

  test("concurrent starts share a listener and immediate stops await its closure", async () => {
    highlighter = new BlockHighlighter({ port: 0 });
    const starting = highlighter.startServer();
    expect(highlighter.startServer()).toBe(starting);
    const stopping = highlighter.stopServer();
    expect(highlighter.stopServer()).toBe(stopping);
    const server = await starting;
    await stopping;
    expect(server.listening).toBe(false);
    const restarted = await highlighter.startServer();
    expect(restarted.listening).toBe(true);
    expect(restarted).not.toBe(server);
  });

  test("a host can serve the feed from its own listener", () => {
    const feed = new BlockHighlighter();

    // Nobody has read the feed, so nothing is watching and a scope is inert.
    expect(feed.listening()).toBe(false);
    expect(feed.scope().enabled).toBe(false);
    expect(feed.handle("GET", "/anything/else")).toBe(null);

    const answer = feed.handle("GET", "/debug/api/highlights");

    expect(answer?.status).toBe(200);
    // Reading the feed is what turns highlighting on.
    expect(feed.listening()).toBe(true);
    expect(feed.scope().enabled).toBe(true);
  });

  test("starts standalone server and responds to /debug/api/highlights", async () => {
    highlighter = new BlockHighlighter({ port: 25588 });
    await highlighter.startServer();

    await highlighter.publish([
      { x: 10, y: 64, z: 20, colour: "#1f8cff" },
    ], { label: "Test Approaching" });

    const response = await fetch("http://127.0.0.1:25588/debug/api/highlights");
    expect(response.status).toBe(200);
    const data = (await response.json()) as any;
    expect(data.label).toBe("Test Approaching");
    expect(data.highlights).toEqual([
      expect.objectContaining({ x: 10, y: 64, z: 20, colour: "#1f8cff" }),
    ]);
  });

  test("standalone server listens on the configured host", async () => {
    highlighter = new BlockHighlighter({ port: 0, host: "127.0.0.1" });
    const server = await highlighter.startServer();
    const address = server.address();
    expect(typeof address === "object" && address?.address).toBe("127.0.0.1");
    expect(new BlockHighlighter().host).toBe("127.0.0.1");
  });

});

describe("highlight hold", () => {
  test("persistent highlights survive elapsed time, serialize, and clear without clearing paths", async () => {
    const highlighter = new BlockHighlighter();
    highlighter.publishPath({ points: [{ x: 1, y: 2, z: 3 }] });
    await highlighter.publish([{ x: 0, y: 0, z: 0, colour: "#ffffff" }], {
      label: "Current targets", lifetime: "until-cleared",
    });
    const snapshot = JSON.parse(JSON.stringify(highlighter.snapshot()));
    expect(snapshot.highlights[0].expiresAt).toBeGreaterThan(Date.now() + 60_000);
    const revision = snapshot.revision;
    highlighter.clearHighlights();
    expect(highlighter.snapshot().highlights).toEqual([]);
    expect(highlighter.snapshot().label).toBe("");
    expect(highlighter.snapshot().revision).toBeGreaterThan(revision);
    expect(highlighter.snapshot().path?.points).toEqual([{ x: 1, y: 2, z: 3 }]);
  });

  test("aborting the current owner clears its persistent highlights", async () => {
    const highlighter = new BlockHighlighter();
    const owner = new AbortController();
    await highlighter.publish([{ x: 0, y: 0, z: 0, colour: "#ffffff" }], {
      lifetime: "until-cleared", signal: owner.signal,
    });
    owner.abort();
    expect(highlighter.snapshot().highlights).toEqual([]);
  });

  test("an old owner's abort cannot erase a newer publication", async () => {
    const highlighter = new BlockHighlighter();
    const old = new AbortController();
    await highlighter.publish([{ x: 0, y: 0, z: 0, colour: "#ffffff" }], {
      lifetime: "until-cleared", signal: old.signal,
    });
    await highlighter.publish([{ x: 9, y: 0, z: 0, colour: "#ffffff" }]);
    old.abort();
    expect(highlighter.snapshot().highlights[0]?.x).toBe(9);
    const cancelled = new AbortController();
    cancelled.abort();
    await expect(highlighter.publish([], { lifetime: "until-cleared", signal: cancelled.signal })).rejects.toBeDefined();
    expect(highlighter.snapshot().highlights[0]?.x).toBe(9);
  });

  test("persistent highlights reject expiration waits and conflicting timers", async () => {
    const highlighter = new BlockHighlighter();
    await expect(highlighter.publish([], { lifetime: "until-cleared", waitUntil: "expired" })).rejects.toThrow("until-cleared");
    await expect(highlighter.publish([], { lifetime: "until-cleared", holdMs: 1 })).rejects.toThrow("until-cleared");
  });

  test("the caller decides how long its highlight stays up", async () => {
    const highlighter = new BlockHighlighter();
    await highlighter.publish([{ x: 0, y: 0, z: 0, colour: "#ffffff" }], { holdMs: 5_000 });
    const [highlight] = highlighter.snapshot().highlights;
    const held = highlight.expiresAt - (highlight.visibleAt ?? 0);
    expect(held).toBeGreaterThanOrEqual(4_900);
  });

  test("a caller that says nothing gets the brief default", async () => {
    const highlighter = new BlockHighlighter();
    await highlighter.publish([{ x: 0, y: 0, z: 0, colour: "#ffffff" }]);
    const [highlight] = highlighter.snapshot().highlights;
    expect(highlight.expiresAt - (highlight.visibleAt ?? 0)).toBe(700);
  });
});


describe("live selections", () => {
  test("a failing display source is detached without throwing into its host", () => {
    const highlighter = new BlockHighlighter();
    let reads = 0;
    highlighter.followHighlights(() => { reads++; throw new Error("broken observer"); }, new AbortController().signal);
    expect(highlighter.handle("GET", "/debug/api/highlights")?.status).toBe(500);
    expect(highlighter.handle("GET", "/debug/api/highlights")?.status).toBe(200);
    expect(reads).toBe(1);
    expect(highlighter.snapshot().entities).toEqual([]);
  });

  test("do no display work without polls, catch up on late joins, and reuse unchanged frames", () => {
    const highlighter = new BlockHighlighter({}, () => "overworld");
    const owner = new AbortController();
    let reads = 0;
    let frame: HighlightFrame = { label: "Mining", blocks: [{ x: 1, y: 2, z: 3, colour: "#ffaa0d" }], entities: [] };
    highlighter.followHighlights(() => { reads++; return frame; }, owner.signal);
    expect(reads).toBe(0);
    frame = { label: "Pickup", blocks: [], entities: [{ entityId: 42, colour: "#33ff61" }] };
    expect(reads).toBe(0);
    highlighter.handle("GET", "/debug/api/highlights");
    expect(reads).toBe(1);
    expect(highlighter.snapshot().highlights).toEqual([]);
    expect(highlighter.snapshot().entities).toEqual([{ entityId: 42, colour: "#33ff61", dimension: "overworld" }]);
    const previous = highlighter.snapshot();
    highlighter.handle("GET", "/debug/api/highlights");
    expect(highlighter.snapshot().revision).toBe(previous.revision);
    expect(highlighter.snapshot().entities).toBe(previous.entities);
    owner.abort();
    highlighter.handle("GET", "/debug/api/highlights");
    expect(reads).toBe(2);
    expect(highlighter.snapshot().entities).toEqual([]);
  });

  test("replacing a live source releases its owner and bounds mixed geometry", async () => {
    const highlighter = new BlockHighlighter({ maxHighlights: 2 });
    const old = new AbortController();
    highlighter.followHighlights(() => ({ label: "", blocks: [], entities: [] }), old.signal);
    const current = new AbortController();
    highlighter.followHighlights(() => ({ label: "Mixed", blocks: [{ x: 0, y: 0, z: 0, colour: "#ffffff" }], entities: [
      { entityId: 1, colour: "#ffffff" }, { entityId: 2, colour: "#ffffff" },
    ] }), current.signal);
    old.abort();
    highlighter.handle("GET", "/debug/api/highlights");
    expect(highlighter.snapshot().entities.length).toBe(1);
    await highlighter.publish([{ x: 5, y: 0, z: 0, colour: "#ffffff" }]);
    current.abort();
    highlighter.handle("GET", "/debug/api/highlights");
    expect(highlighter.snapshot().entities).toEqual([]);
    expect(highlighter.snapshot().highlights[0]?.x).toBe(5);
  });

  test("a scope notices a listener joining after the action starts", () => {
    const highlighter = new BlockHighlighter();
    const scope = highlighter.scope();
    expect(scope.enabled).toBe(false);
    highlighter.observePoll();
    expect(scope.enabled).toBe(true);
  });
});
