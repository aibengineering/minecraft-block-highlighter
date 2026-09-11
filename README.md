# Minecraft Block Highlighter

Draw coloured block outlines and bot routes in Minecraft using a TypeScript feed
and a companion client mod. Useful for watching a bot's candidate blocks,
accepted targets, and planned movement while debugging a playthrough.

The TypeScript package publishes geometry over local HTTP. The NeoForge mod
polls that feed and draws it in your Minecraft client. It does not calculate
routes or control the bot.

## Requirements

- Minecraft Java Edition **1.21.4** with **NeoForge 21.4.157** (the build target).
- **Java 21** to build and run the mod.
- **Bun 1.4.0** for development and tests. Package builds also work with npm.
- The built package uses **ES modules** and targets **Node.js 20+** or Bun.
  Tests currently run under Bun.

This is an initial candidate. Other Minecraft versions and loaders are not
supported. In-game reconnect verification and playthrough overhead measurement
remain outstanding; passing builds do not establish those results.

## Build from source

From the repository root:

```sh
bun install --frozen-lockfile
bun run test
bun run build
```

Build the mod on Windows:

```powershell
cd mod
.\gradlew.bat build
```

Or on Linux/macOS:

```sh
cd mod
bash gradlew build
```

Gradle downloads its build dependencies on the first run. The resulting mod is
`mod/build/libs/blockhighlighter-0.1.0.jar`.

With Minecraft closed, copy that JAR into the **mods** directory of the specific
NeoForge instance you want to use. Remove any older Block Highlighter JAR from
that same directory to avoid loading duplicate versions. No server-side mod is
required. Build commands do not install or remove mods.

## Use the TypeScript package

The current package and companion mod version is **0.1.0**.

### Install from GitHub

This package is not published on npm yet. Install it directly from the private
[aibengineering/minecraft-block-highlighter repository](https://github.com/aibengineering/minecraft-block-highlighter):

```sh
npm install "git+https://github.com/aibengineering/minecraft-block-highlighter.git#main"
```

You need Git, Node.js 20+, npm, and a GitHub account with access to this private
repository. Authenticate Git over HTTPS using your credential manager. If you
use GitHub CLI, run `gh auth login` followed by `gh auth setup-git` first.
The installation builds JavaScript and type declarations automatically using
`prepare`; installation scripts must be enabled. Bun is used for development
and tests but is not needed for this npm installation path.

`#main` installs the current main branch. Replace it with a full commit SHA to
select a specific revision. Import the installed package using
`@aibengineering/minecraft-block-highlighter`, as in the examples below.

Alternatively, clone and pack it yourself, then install the tarball with npm or Bun:

```sh
git clone https://github.com/aibengineering/minecraft-block-highlighter.git
cd minecraft-block-highlighter
bun install --frozen-lockfile
npm pack
```

From your consuming project:

```sh
npm install /path/to/aibengineering-minecraft-block-highlighter-0.1.0.tgz
# Or:
bun add /path/to/aibengineering-minecraft-block-highlighter-0.1.0.tgz
```

The Minecraft mod JAR is built and installed separately as described above.

### Standalone highlights

```ts
import {
  BlockHighlighter,
  blockCollection,
} from "@aibengineering/minecraft-block-highlighter";

const highlighter = new BlockHighlighter();
await highlighter.startServer();

const blocks = blockCollection([
  { x: 10, y: 64, z: 20 },
  { x: 10, y: 65, z: 20 },
], { label: "Candidate sites", highlighter });

await blocks.highlight("#33ff61", { holdMs: 5_000 });

// Keep the server alive while using the viewer.
// At application shutdown: await highlighter.stopServer();
```

Load a world with the mod installed before publishing the highlights. Coordinates
must match the world being viewed. Colours use `#RRGGBB`.

### Attach to a bot

For a bot emitting `path_update`, `goal_reached`, `path_stop`, and `end` events:

```ts
import {
  attachHighlighter,
  blockCollection,
  runWithHighlighter,
} from "@aibengineering/minecraft-block-highlighter";

// `bot` is your existing bot instance, with entity.position and game.dimension.
const overlay = attachHighlighter(bot);
const startup = await overlay.ready;
if (startup.error) console.warn("Overlay unavailable", startup.error);

// Run this when your bot has candidate blocks to display.
async function showCandidates(candidates: { x: number; y: number; z: number }[]) {
  await runWithHighlighter(overlay.highlighter.scope(), async () => {
    await blockCollection(candidates, "Candidates").highlight("#33ff61");
  });
}

// During your application's cleanup:
// await overlay.stop();
```

Routes follow path events automatically. Published geometry is stamped with the
bot's current dimension. `ready` reports an optional startup error as data;
`stop()` waits for pending startup and releases the listener and subscriptions.
The attachment also cleans up when the bot emits `end`.

If the application already owns an HTTP listener, pass `{ serveStandalone: false }`
to `attachHighlighter`. Forward the request method and URL to
`overlay.highlighter.handle(method, url)`. A non-null result contains `status` and
`body`; send the body as JSON. A null result belongs to your application's router.

## Viewer controls and connection

- **N** toggles routes.
- **O** toggles block highlights and labels.
- Rebind these in Minecraft's Controls menu. Visibility settings persist in
  `config/blockhighlighter-client.properties` within the game instance.

The default feed is `http://127.0.0.1:25575/debug/api/highlights`. To use another
local port, pass `{ port: 25576 }` to the highlighter or attachment, and add this
JVM argument to the Minecraft instance:

```text
-Dblockhighlighter.url=http://127.0.0.1:25576/debug/api/highlights
```

The standalone server binds to loopback. A shared HTTP host controls its own
binding and access policy. The viewer still polls when both overlays are hidden.

If nothing appears, check the feed URL in a browser, inspect `ready.error`, confirm
the world/dimension and coordinates, and check the N/O toggles. Highlights expire
quickly by default (700 ms); use a longer `holdMs` while checking setup.

## Behaviour and limits

- Each publication replaces the previous block picture or route.
- The feed defaults to 768 block highlights; the mod renders at most 768.
- Route conversion inspects at most 512 input points including the bot origin;
  published routes contain at most 512 points. Longer routes show their beginning.
- Highlights publish immediately by default. `waitUntil: "expired"` deliberately
  pauses the caller for the reveal and hold duration; use it only when wanted.
- `scope()` samples whether a viewer polled recently. Disabled collections skip
  highlight work, but still retain their input and support ordinary array work.
- Importing the package also installs the existing `toHighlightableBlocks` and
  `toBlockCollection` Array helpers. The explicit `blockCollection` factory is
  used above to make construction visible.
- The viewer must observe the same world as the publisher. Dimension matching
  does not identify a particular server or save.

## Development

`bun run test` runs typechecking and the TypeScript tests. `bun run build` emits
`dist/`. The CI workflow builds both components on Windows and Linux; the Java
build currently has no automated gameplay tests.

For bug reports, include Minecraft/NeoForge versions, runtime version, the setup
steps, and a minimal reproduction. A real in-game screenshot or recording is
helpful for rendering issues.

## License

[MIT](LICENSE), copyright 2026 AI Bengineering.
