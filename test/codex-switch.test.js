"use strict";

const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const cli = path.join(__dirname, "..", "bin", "codex-switch.js");

function run(codexHome, args, options = {}) {
  return execFileSync(process.execPath, [cli, "--codex-home", codexHome, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    ...options
  });
}

function makeCodexHome() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-switch-test-"));
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function writeActive(codexHome, name, secret) {
  fs.writeFileSync(
    path.join(codexHome, "config.toml"),
    `model = "${name}"\nmodel_provider = "${name}-provider"\n`,
    { mode: 0o600 }
  );
  fs.writeFileSync(
    path.join(codexHome, "auth.json"),
    JSON.stringify({ OPENAI_API_KEY: secret }, null, 2),
    { mode: 0o600 }
  );
}

test("saves and switches complete Codex profiles", () => {
  const codexHome = makeCodexHome();
  writeActive(codexHome, "official", "sk-official-secret");
  run(codexHome, ["save", "official", "--label", "OpenAI"]);

  writeActive(codexHome, "third-party", "sk-third-party-secret");
  run(codexHome, ["save", "third-party", "--label", "Third Party"]);

  const listOutput = run(codexHome, ["list"]);
  assert.match(listOutput, /official - OpenAI/);
  assert.match(listOutput, /third-party - Third Party/);
  assert.doesNotMatch(listOutput, /sk-third-party-secret/);

  const switchOutput = run(codexHome, ["use", "official"]);
  assert.match(switchOutput, /Switched Codex profile: official/);
  assert.match(fs.readFileSync(path.join(codexHome, "config.toml"), "utf8"), /model = "official"/);
  assert.match(fs.readFileSync(path.join(codexHome, "auth.json"), "utf8"), /sk-official-secret/);

  const statusOutput = run(codexHome, ["status"]);
  assert.match(statusOutput, /Active profile: official/);
  assert.doesNotMatch(statusOutput, /sk-official-secret/);
});

test("import creates a profile from explicit config and auth paths", () => {
  const codexHome = makeCodexHome();
  writeActive(codexHome, "active", "sk-active-secret");

  const importDir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-switch-import-"));
  const configPath = path.join(importDir, "config.third.toml");
  const authPath = path.join(importDir, "auth.third.json");
  fs.writeFileSync(configPath, 'model = "third"\n', { mode: 0o600 });
  fs.writeFileSync(authPath, '{"OPENAI_API_KEY":"sk-import-secret"}\n', { mode: 0o600 });

  const output = run(codexHome, ["import", "third", "--config", configPath, "--auth", authPath]);
  assert.match(output, /Imported profile: third/);

  run(codexHome, ["use", "third"]);
  assert.equal(fs.readFileSync(path.join(codexHome, "config.toml"), "utf8"), 'model = "third"\n');
  assert.equal(fs.readFileSync(path.join(codexHome, "auth.json"), "utf8"), '{"OPENAI_API_KEY":"sk-import-secret"}\n');
});

test("switching writes a backup by default", () => {
  const codexHome = makeCodexHome();
  writeActive(codexHome, "one", "sk-one");
  run(codexHome, ["save", "one"]);
  writeActive(codexHome, "two", "sk-two");
  run(codexHome, ["save", "two"]);

  run(codexHome, ["use", "one"]);
  const backupsDir = path.join(codexHome, "switch-backups");
  const backups = fs.readdirSync(backupsDir);
  assert.ok(backups.length >= 1);
  assert.ok(fs.existsSync(path.join(backupsDir, backups[0], "config.toml")));
  assert.ok(fs.existsSync(path.join(backupsDir, backups[0], "auth.json")));
});

test("invalid profile names are rejected", () => {
  const codexHome = makeCodexHome();
  writeActive(codexHome, "active", "sk-active");

  assert.throws(
    () => run(codexHome, ["save", "../bad"]),
    /invalid profile name/
  );
});
