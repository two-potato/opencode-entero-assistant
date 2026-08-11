import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

async function text(path) {
  return readFile(new URL(path, root), "utf8");
}

function frontmatter(source) {
  const match = source.match(/^---\n([\s\S]*?)\n---/);
  assert.ok(match, "agent or skill must have YAML frontmatter");
  return match[1];
}

function topLevelPermissionNames(yaml) {
  const block = yaml.split("\npermission:\n")[1] ?? "";
  return [...block.matchAll(/^  ([^\s][^:]*):/gm)].map((match) => match[1].replace(/^['"]|['"]$/g, ""));
}

test("project config selects only the approved local OpenAI setup", async () => {
  const config = JSON.parse(await text("opencode.json"));
  assert.equal(config.default_agent, "search-orchestrator");
  assert.equal(config.model, "openai/gpt-5.6-terra-fast");
  assert.equal(config.small_model, "openai/gpt-5.6-luna-fast");
  assert.equal(config.share, "disabled");
  assert.equal(config.subagent_depth, 1);
  assert.deepEqual(config.permission, { edit: "deny", bash: "deny", external_directory: "deny" });
});

test("orchestrator is primary and exposes only approved delegation and deterministic workflow tools", async () => {
  const yaml = frontmatter(await text(".opencode/agents/search-orchestrator.md"));
  assert.match(yaml, /^mode: primary$/m);
  assert.match(yaml, /^model: openai\/gpt-5\.6-terra-fast$/m);
  assert.match(yaml, /^  "\*": deny$/m);
  assert.match(yaml, /^    internet-researcher: allow$/m);
  assert.match(yaml, /^    entero-site-search: allow$/m);
  assert.deepEqual(topLevelPermissionNames(yaml).sort(), [
    "*",
    "procurement_rank_offers",
    "procurement_validate_research",
    "question",
    "skill",
    "task",
  ]);
});

test("internet researcher exposes only web reads", async () => {
  const yaml = frontmatter(await text(".opencode/agents/internet-researcher.md"));
  assert.match(yaml, /^mode: subagent$/m);
  assert.match(yaml, /^model: openai\/gpt-5\.6-luna-fast$/m);
  assert.deepEqual(topLevelPermissionNames(yaml).sort(), ["*", "webfetch", "websearch"]);
});

test("Entero agent exposes only the three bounded adapter tools", async () => {
  const yaml = frontmatter(await text(".opencode/agents/entero-site-search.md"));
  assert.match(yaml, /^mode: subagent$/m);
  assert.match(yaml, /^model: openai\/gpt-5\.6-terra-fast$/m);
  assert.deepEqual(topLevelPermissionNames(yaml).sort(), ["*", "entero_next_page", "entero_read_product", "entero_search"]);
});

test("skill directory names match skill frontmatter names", async () => {
  for (const name of ["normalize-product-request", "validate-product-offers"]) {
    const yaml = frontmatter(await text(`.opencode/skills/${name}/SKILL.md`));
    assert.match(yaml, new RegExp(`^name: ${name}$`, "m"));
  }
});
