import { describe, expect, test } from "bun:test";
import { BlockCollection } from "./block-collection.js";
import { BlockHighlighter } from "./highlighter.js";
import { runWithHighlighter } from "./context.js";

describe("BlockCollection", () => {
  test("is a true Array containing blocks and supports array operations", () => {
    const b1 = { position: { x: 10, y: 64, z: 20 }, name: "sand" };
    const b2 = { position: { x: 11, y: 64, z: 20 }, name: "gravel" };
    const collection = new BlockCollection(b1, b2);

    expect(Array.isArray(collection)).toBe(true);
    expect(collection.length).toBe(2);
    expect(collection[0]).toBe(b1);
    expect(collection.filter((b) => b.name === "sand").length).toBe(1);

    const names: string[] = [];
    for (const b of collection) names.push(b.name);
    expect(names).toEqual(["sand", "gravel"]);
  });

  test("can chain directly on standard Array via .toHighlightableBlocks() and publish with ambient context", async () => {
    const highlighter = new BlockHighlighter();
    const positions = [
      { x: 1, y: 64, z: 2 },
      { x: 3, y: 64, z: 4 },
      { x: 5, y: 64, z: 6 },
    ];

    await runWithHighlighter({ highlighter }, async () => {
      const candidates = positions
        .map((p) => ({ position: { x: p.x, y: p.y, z: p.z } }))
        .filter((p) => p.position.x > 1)
        .toHighlightableBlocks("Filtered candidates");

      expect(Array.isArray(candidates)).toBe(true);
      expect(candidates.length).toBe(2);
      await candidates.highlight("#ffaa0d");

      const snapshot = highlighter.snapshot();
      expect(snapshot.label).toBe("Filtered candidates");
      expect(snapshot.highlights.map((h) => ({ x: h.x, y: h.y, z: h.z, colour: h.colour }))).toEqual([
        { x: 3, y: 64, z: 4, colour: "#ffaa0d" },
        { x: 5, y: 64, z: 6, colour: "#ffaa0d" },
      ]);
    });
  });

  test("highlight with subset highlights specific blocks and publishes", async () => {
    const highlighter = new BlockHighlighter();
    const b1 = { x: 1, y: 2, z: 3 };
    const b2 = { x: 4, y: 5, z: 6 };

    await runWithHighlighter({ highlighter }, async () => {
      const collection = [b1, b2].toHighlightableBlocks();
      await collection.highlight([b1], "#33ff61", "Accepted target");

      const snapshot = highlighter.snapshot();
      expect(snapshot.label).toBe("Accepted target");
      expect(snapshot.highlights.map((h) => ({ x: h.x, y: h.y, z: h.z, colour: h.colour }))).toEqual([
        { x: 1, y: 2, z: 3, colour: "#33ff61" },
      ]);
    });
  });

  test("forwards a call-owned visible lifetime and settlement point", async () => {
    const publishedOptions: any[] = [];
    const customPublish = async (_blocks: any, options: any) => {
      publishedOptions.push(options);
    };

    await runWithHighlighter({ publish: customPublish }, async () => {
      const collection = [{ x: 1, y: 2, z: 3 }].toHighlightableBlocks();
      await collection.highlight("#ffaa0d", "Ambient highlight");
      await collection.highlight("#33ff61", "Staged highlight", { holdMs: 50, waitUntil: "expired" });

      expect(publishedOptions.length).toBe(2);
      expect(publishedOptions[0].waitUntil).toBeUndefined();
      expect(publishedOptions[0].label).toBe("Ambient highlight");
      expect(publishedOptions[1].holdMs).toBe(50);
      expect(publishedOptions[1].waitUntil).toBe("expired");
      expect(publishedOptions[1].label).toBe("Staged highlight");
    });
  });

  test("rejects invalid hex colour strings", () => {
    expect(() =>
      new BlockCollection().highlightBlocks([{ x: 0, y: 0, z: 0 }], "invalid" as `#${string}`),
    ).toThrow(/#RRGGBB/);
  });

  test("inert when disabled and does not iterate inputs", async () => {
    const highlighter = new BlockHighlighter();
    await runWithHighlighter({ highlighter }, async () => {
      // Inertness is the collection's own state now; the highlighter has no say.
      const collection = [{ x: 0, y: 0, z: 0 }].toHighlightableBlocks({ enabled: false });
      await collection.highlight("#ffaa00");
      expect(highlighter.snapshot().highlights).toEqual([]);
    });
  });

  test("aborts highlight waiting naturally when signal triggers", async () => {
    const highlighter = new BlockHighlighter();
    const controller = new AbortController();

    setTimeout(() => {
      controller.abort(new Error("Action timeout"));
    }, 20);

    await runWithHighlighter({ highlighter, signal: controller.signal }, async () => {
      const collection = [{ x: 1, y: 2, z: 3 }].toHighlightableBlocks();
      await expect(collection.highlight("#ffaa00", { holdMs: 1000, waitUntil: "expired" })).rejects.toThrow(
        "Action timeout",
      );
    });
  });
});
