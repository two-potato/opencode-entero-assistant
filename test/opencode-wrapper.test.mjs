import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const wrapper = new URL("../opencode-entero", import.meta.url);

test("project wrapper always starts OpenCode in pure mode", async () => {
  const directory = await mkdtemp(join(tmpdir(), "opencode-entero-wrapper-"));
  const capture = join(directory, "args.txt");
  const fakeOpenCode = join(directory, "opencode");
  await writeFile(fakeOpenCode, `#!/bin/sh\nprintf '%s\\n' "$@" > "$CAPTURE_FILE"\n`, { mode: 0o755 });

  const result = spawnSync(wrapper.pathname, ["run", "--agent", "search-orchestrator", "test request"], {
    encoding: "utf8",
    env: {
      ...process.env,
      CAPTURE_FILE: capture,
      PATH: `${directory}:${process.env.PATH}`,
    },
  });

  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual((await readFile(capture, "utf8")).trim().split("\n"), [
    "--pure",
    "run",
    "--agent",
    "search-orchestrator",
    "test request",
  ]);
});
