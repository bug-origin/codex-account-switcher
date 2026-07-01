#!/usr/bin/env node
"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const MANAGED_FILES = ["config.toml", "auth.json"];
const MARKER_FILE = ".active-profile";

function main(argv) {
  const parsed = parseGlobalOptions(argv);
  const ctx = createContext(parsed.global);
  const args = parsed.args;
  const rawCommand = args.shift() || "status";
  const command = normalizeCommand(rawCommand);

  if (parsed.global.help || command === "help") {
    printHelp();
    return;
  }

  if (parsed.global.version || command === "version") {
    console.log(getPackageVersion());
    return;
  }

  switch (command) {
    case "status":
      assertNoArgs(args, "status");
      printStatus(ctx);
      return;
    case "list":
      assertNoArgs(args, "list");
      listProfiles(ctx);
      return;
    case "save":
      saveProfile(ctx, args);
      return;
    case "import":
      importProfile(ctx, args);
      return;
    case "use":
      useProfile(ctx, args);
      return;
    case "backup":
      assertNoArgs(args, "backup");
      backupActiveProfile(ctx, { announce: true });
      return;
    case "delete":
      deleteProfile(ctx, args);
      return;
    case "paths":
      assertNoArgs(args, "paths");
      printPaths(ctx);
      return;
    case "doctor":
      assertNoArgs(args, "doctor");
      runDoctor(ctx);
      return;
    default:
      fail(`unknown command: ${rawCommand}\nRun "codex-switch help" for usage.`);
  }
}

function parseGlobalOptions(argv) {
  const args = [...argv];
  const global = {
    codexHome: process.env.CODEX_HOME || "",
    profilesDir: process.env.CODEX_SWITCHER_PROFILES_DIR || "",
    help: false,
    version: false
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--codex-home") {
      global.codexHome = requireOptionValue(args, index, arg);
      args.splice(index, 2);
      index -= 1;
    } else if (arg.startsWith("--codex-home=")) {
      global.codexHome = arg.slice("--codex-home=".length);
      args.splice(index, 1);
      index -= 1;
    } else if (arg === "--profiles-dir") {
      global.profilesDir = requireOptionValue(args, index, arg);
      args.splice(index, 2);
      index -= 1;
    } else if (arg.startsWith("--profiles-dir=")) {
      global.profilesDir = arg.slice("--profiles-dir=".length);
      args.splice(index, 1);
      index -= 1;
    } else if (arg === "-h" || arg === "--help") {
      global.help = true;
      args.splice(index, 1);
      index -= 1;
    } else if (arg === "-V" || arg === "--version") {
      global.version = true;
      args.splice(index, 1);
      index -= 1;
    }
  }

  return { args, global };
}

function createContext(global) {
  const codexHome = path.resolve(expandHome(global.codexHome || path.join(os.homedir(), ".codex")));
  const profilesDir = path.resolve(expandHome(global.profilesDir || path.join(codexHome, "profiles")));
  return {
    codexHome,
    profilesDir,
    backupsDir: path.join(codexHome, "switch-backups"),
    markerPath: path.join(codexHome, MARKER_FILE)
  };
}

function normalizeCommand(command) {
  const aliases = new Map([
    ["current", "status"],
    ["ls", "list"],
    ["profiles", "list"],
    ["switch", "use"],
    ["activate", "use"],
    ["remove", "delete"],
    ["rm", "delete"],
    ["path", "paths"],
    ["--help", "help"],
    ["-h", "help"],
    ["--version", "version"],
    ["-V", "version"]
  ]);
  return aliases.get(command) || command;
}

function printHelp() {
  console.log(`codex-switch ${getPackageVersion()}

Switch Codex between saved config/auth profiles.

Usage:
  codex-switch status
  codex-switch list
  codex-switch save <name> [--label <text>] [--force]
  codex-switch import <name> --config <path> --auth <path> [--label <text>] [--force]
  codex-switch use <name> [--no-backup]
  codex-switch backup
  codex-switch delete <name> --force
  codex-switch paths
  codex-switch doctor

Global options:
  --codex-home <dir>     Codex home directory. Defaults to CODEX_HOME or ~/.codex.
  --profiles-dir <dir>   Profile storage directory. Defaults to <codex-home>/profiles.
  -h, --help             Show help.
  -V, --version          Show version.

Examples:
  codex-switch save official --label "OpenAI ChatGPT"
  codex-switch import third-party --config ~/.codex/config.third.toml --auth ~/.codex/auth.third.json
  codex-switch use official
  codex-switch use third-party

This tool never prints config.toml or auth.json contents.`);
}

function getPackageVersion() {
  try {
    const packageJsonPath = path.join(__dirname, "..", "package.json");
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
    return packageJson.version || "0.0.0";
  } catch {
    return "0.0.0";
  }
}

function printStatus(ctx) {
  const active = detectActiveProfile(ctx);
  const marker = readMarker(ctx);

  console.log(`Codex home: ${ctx.codexHome}`);
  console.log(`Profiles: ${ctx.profilesDir}`);
  console.log(`Active files: ${managedFileSummary(ctx.codexHome)}`);

  if (active) {
    console.log(`Active profile: ${active}`);
  } else if (marker) {
    console.log(`Active profile: unknown (last switch marker: ${marker})`);
  } else {
    console.log("Active profile: unknown");
  }
}

function listProfiles(ctx) {
  const profiles = readProfiles(ctx);
  const active = detectActiveProfile(ctx);

  if (profiles.length === 0) {
    console.log("No profiles saved.");
    console.log(`Create one with: codex-switch save <name>`);
    return;
  }

  console.log("Profiles:");
  for (const profile of profiles) {
    const marker = profile.name === active ? "*" : " ";
    const label = profile.label && profile.label !== profile.name ? ` - ${profile.label}` : "";
    const updated = profile.updatedAt ? ` (${profile.updatedAt})` : "";
    console.log(`${marker} ${profile.name}${label}${updated}`);
  }
}

function saveProfile(ctx, args) {
  const options = parseCommandOptions(args, {
    flags: ["--force"],
    values: ["--label"]
  });
  const name = options.positionals[0];
  assertSingleName(name, options.positionals, "save");
  assertNoUnknownOptions(options);
  ensureProfileName(name);

  for (const fileName of MANAGED_FILES) {
    const source = path.join(ctx.codexHome, fileName);
    if (!fileExists(source)) {
      fail(`cannot save profile "${name}" because ${source} does not exist`);
    }
  }

  const profileDir = path.join(ctx.profilesDir, name);
  prepareProfileDir(profileDir, options.flags.has("--force"));

  const now = new Date().toISOString();
  const existingManifest = readManifest(profileDir);
  for (const fileName of MANAGED_FILES) {
    copyPrivateFile(path.join(ctx.codexHome, fileName), path.join(profileDir, fileName));
  }
  writeManifest(profileDir, {
    name,
    label: options.values.get("--label") || existingManifest.label || name,
    createdAt: existingManifest.createdAt || now,
    updatedAt: now,
    files: MANAGED_FILES
  });

  console.log(`Saved profile: ${name}`);
}

function importProfile(ctx, args) {
  const options = parseCommandOptions(args, {
    flags: ["--force"],
    values: ["--config", "--auth", "--label"]
  });
  const name = options.positionals[0];
  assertSingleName(name, options.positionals, "import");
  assertNoUnknownOptions(options);
  ensureProfileName(name);

  const configSource = resolveRequiredPath(options.values.get("--config"), "--config");
  const authSource = resolveRequiredPath(options.values.get("--auth"), "--auth");
  assertReadableFile(configSource, "--config");
  assertReadableFile(authSource, "--auth");

  const profileDir = path.join(ctx.profilesDir, name);
  prepareProfileDir(profileDir, options.flags.has("--force"));

  const now = new Date().toISOString();
  const existingManifest = readManifest(profileDir);
  copyPrivateFile(configSource, path.join(profileDir, "config.toml"));
  copyPrivateFile(authSource, path.join(profileDir, "auth.json"));
  writeManifest(profileDir, {
    name,
    label: options.values.get("--label") || existingManifest.label || name,
    createdAt: existingManifest.createdAt || now,
    updatedAt: now,
    files: MANAGED_FILES
  });

  console.log(`Imported profile: ${name}`);
}

function useProfile(ctx, args) {
  const options = parseCommandOptions(args, {
    flags: ["--no-backup"],
    values: []
  });
  const name = options.positionals[0];
  assertSingleName(name, options.positionals, "use");
  assertNoUnknownOptions(options);
  ensureProfileName(name);

  const profileDir = path.join(ctx.profilesDir, name);
  assertCompleteProfile(profileDir, name);
  ensurePrivateDir(ctx.codexHome);

  let backupDir = "";
  if (!options.flags.has("--no-backup")) {
    backupDir = backupActiveProfile(ctx, { announce: false });
  }

  for (const fileName of MANAGED_FILES) {
    copyPrivateFile(path.join(profileDir, fileName), path.join(ctx.codexHome, fileName));
  }
  writePrivateText(ctx.markerPath, `${name}\n`);

  console.log(`Switched Codex profile: ${name}`);
  if (backupDir) {
    console.log(`Backup: ${backupDir}`);
  }
}

function backupActiveProfile(ctx, options) {
  const existingFiles = MANAGED_FILES.filter((fileName) => fileExists(path.join(ctx.codexHome, fileName)));
  if (existingFiles.length === 0) {
    if (options.announce) {
      console.log("No active Codex config/auth files to back up.");
    }
    return "";
  }

  ensurePrivateDir(ctx.backupsDir);
  const backupDir = path.join(ctx.backupsDir, timestampForPath());
  ensurePrivateDir(backupDir);

  for (const fileName of existingFiles) {
    copyPrivateFile(path.join(ctx.codexHome, fileName), path.join(backupDir, fileName));
  }
  const marker = readMarker(ctx);
  if (marker) {
    writePrivateText(path.join(backupDir, MARKER_FILE), `${marker}\n`);
  }

  if (options.announce) {
    console.log(`Backup: ${backupDir}`);
  }
  return backupDir;
}

function deleteProfile(ctx, args) {
  const options = parseCommandOptions(args, {
    flags: ["--force"],
    values: []
  });
  const name = options.positionals[0];
  assertSingleName(name, options.positionals, "delete");
  assertNoUnknownOptions(options);
  ensureProfileName(name);
  if (!options.flags.has("--force")) {
    fail(`refusing to delete "${name}" without --force`);
  }

  const profileDir = path.join(ctx.profilesDir, name);
  if (!directoryExists(profileDir)) {
    fail(`profile not found: ${name}`);
  }
  fs.rmSync(profileDir, { recursive: true, force: false });
  console.log(`Deleted profile: ${name}`);
}

function printPaths(ctx) {
  console.log(`Codex home: ${ctx.codexHome}`);
  console.log(`Profiles: ${ctx.profilesDir}`);
  console.log(`Backups: ${ctx.backupsDir}`);
  console.log(`Marker: ${ctx.markerPath}`);
}

function runDoctor(ctx) {
  const profiles = readProfiles(ctx);
  const active = detectActiveProfile(ctx);
  const problems = [];

  if (!directoryExists(ctx.codexHome)) {
    problems.push(`missing Codex home: ${ctx.codexHome}`);
  }
  for (const fileName of MANAGED_FILES) {
    const activePath = path.join(ctx.codexHome, fileName);
    if (!fileExists(activePath)) {
      problems.push(`missing active file: ${activePath}`);
    }
  }
  for (const profile of profiles) {
    const profileDir = path.join(ctx.profilesDir, profile.name);
    for (const fileName of MANAGED_FILES) {
      if (!fileExists(path.join(profileDir, fileName))) {
        problems.push(`incomplete profile "${profile.name}": missing ${fileName}`);
      }
    }
  }

  console.log(`Codex home: ${ctx.codexHome}`);
  console.log(`Profiles found: ${profiles.length}`);
  console.log(`Active profile: ${active || "unknown"}`);
  if (problems.length === 0) {
    console.log("Doctor: ok");
    return;
  }
  console.log("Doctor: problems found");
  for (const problem of problems) {
    console.log(`- ${problem}`);
  }
  process.exitCode = 1;
}

function readProfiles(ctx) {
  if (!directoryExists(ctx.profilesDir)) {
    return [];
  }
  const names = fs.readdirSync(ctx.profilesDir)
    .filter((entry) => directoryExists(path.join(ctx.profilesDir, entry)))
    .filter(isValidProfileName)
    .sort((a, b) => a.localeCompare(b));

  return names.map((name) => {
    const profileDir = path.join(ctx.profilesDir, name);
    const manifest = readManifest(profileDir);
    return {
      name,
      label: manifest.label || name,
      updatedAt: manifest.updatedAt || ""
    };
  });
}

function detectActiveProfile(ctx) {
  if (!MANAGED_FILES.every((fileName) => fileExists(path.join(ctx.codexHome, fileName)))) {
    return "";
  }

  for (const profile of readProfiles(ctx)) {
    const profileDir = path.join(ctx.profilesDir, profile.name);
    if (!MANAGED_FILES.every((fileName) => fileExists(path.join(profileDir, fileName)))) {
      continue;
    }
    const matches = MANAGED_FILES.every((fileName) => {
      return fileHash(path.join(ctx.codexHome, fileName)) === fileHash(path.join(profileDir, fileName));
    });
    if (matches) {
      return profile.name;
    }
  }
  return "";
}

function readMarker(ctx) {
  try {
    return fs.readFileSync(ctx.markerPath, "utf8").trim();
  } catch {
    return "";
  }
}

function readManifest(profileDir) {
  try {
    return JSON.parse(fs.readFileSync(path.join(profileDir, "profile.json"), "utf8"));
  } catch {
    return {};
  }
}

function writeManifest(profileDir, manifest) {
  writePrivateText(path.join(profileDir, "profile.json"), `${JSON.stringify(manifest, null, 2)}\n`);
}

function prepareProfileDir(profileDir, force) {
  if (directoryExists(profileDir) && !force) {
    fail(`profile already exists: ${path.basename(profileDir)}. Use --force to overwrite it.`);
  }
  ensurePrivateDir(profileDir);
}

function assertCompleteProfile(profileDir, name) {
  if (!directoryExists(profileDir)) {
    fail(`profile not found: ${name}`);
  }
  for (const fileName of MANAGED_FILES) {
    if (!fileExists(path.join(profileDir, fileName))) {
      fail(`profile "${name}" is incomplete: missing ${fileName}`);
    }
  }
}

function managedFileSummary(codexHome) {
  return MANAGED_FILES.map((fileName) => {
    return `${fileName}=${fileExists(path.join(codexHome, fileName)) ? "yes" : "no"}`;
  }).join(", ");
}

function parseCommandOptions(args, spec) {
  const result = {
    flags: new Set(),
    values: new Map(),
    positionals: [],
    unknown: []
  };
  const flagSet = new Set(spec.flags);
  const valueSet = new Set(spec.values);

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (flagSet.has(arg)) {
      result.flags.add(arg);
    } else if (valueSet.has(arg)) {
      result.values.set(arg, requireOptionValue(args, index, arg));
      index += 1;
    } else if ([...valueSet].some((name) => arg.startsWith(`${name}=`))) {
      const name = [...valueSet].find((optionName) => arg.startsWith(`${optionName}=`));
      result.values.set(name, arg.slice(name.length + 1));
    } else if (arg.startsWith("-")) {
      result.unknown.push(arg);
    } else {
      result.positionals.push(arg);
    }
  }

  return result;
}

function requireOptionValue(args, index, optionName) {
  const value = args[index + 1];
  if (!value || value.startsWith("-")) {
    fail(`missing value for ${optionName}`);
  }
  return value;
}

function assertNoUnknownOptions(options) {
  if (options.unknown.length > 0) {
    fail(`unknown option: ${options.unknown[0]}`);
  }
}

function assertSingleName(name, positionals, command) {
  if (!name) {
    fail(`missing profile name for "${command}"`);
  }
  if (positionals.length > 1) {
    fail(`too many arguments for "${command}": ${positionals.slice(1).join(" ")}`);
  }
}

function assertNoArgs(args, command) {
  if (args.length > 0) {
    fail(`"${command}" does not accept arguments: ${args.join(" ")}`);
  }
}

function resolveRequiredPath(value, optionName) {
  if (!value) {
    fail(`missing required ${optionName} path`);
  }
  return path.resolve(expandHome(value));
}

function assertReadableFile(filePath, optionName) {
  if (!fileExists(filePath)) {
    fail(`${optionName} file not found: ${filePath}`);
  }
  try {
    fs.accessSync(filePath, fs.constants.R_OK);
  } catch {
    fail(`${optionName} file is not readable: ${filePath}`);
  }
}

function ensureProfileName(name) {
  if (!isValidProfileName(name)) {
    fail(`invalid profile name: ${name}. Use letters, numbers, dots, dashes, or underscores.`);
  }
}

function isValidProfileName(name) {
  return /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(name);
}

function fileHash(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function copyPrivateFile(source, destination) {
  ensurePrivateDir(path.dirname(destination));
  const temporary = path.join(
    path.dirname(destination),
    `.${path.basename(destination)}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`
  );
  fs.copyFileSync(source, temporary);
  chmodQuietly(temporary, 0o600);
  fs.renameSync(temporary, destination);
  chmodQuietly(destination, 0o600);
}

function writePrivateText(filePath, contents) {
  ensurePrivateDir(path.dirname(filePath));
  const temporary = path.join(
    path.dirname(filePath),
    `.${path.basename(filePath)}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`
  );
  fs.writeFileSync(temporary, contents, { encoding: "utf8", mode: 0o600 });
  chmodQuietly(temporary, 0o600);
  fs.renameSync(temporary, filePath);
  chmodQuietly(filePath, 0o600);
}

function ensurePrivateDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true, mode: 0o700 });
  chmodQuietly(dirPath, 0o700);
}

function chmodQuietly(targetPath, mode) {
  try {
    fs.chmodSync(targetPath, mode);
  } catch {
    // chmod is best-effort on platforms/filesystems that do not support POSIX modes.
  }
}

function fileExists(filePath) {
  try {
    return fs.statSync(filePath).isFile();
  } catch {
    return false;
  }
}

function directoryExists(dirPath) {
  try {
    return fs.statSync(dirPath).isDirectory();
  } catch {
    return false;
  }
}

function timestampForPath() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function expandHome(value) {
  if (!value || value === "~") {
    return value === "~" ? os.homedir() : value;
  }
  if (value.startsWith("~/") || value.startsWith("~\\")) {
    return path.join(os.homedir(), value.slice(2));
  }
  return value;
}

function fail(message) {
  console.error(`codex-switch: ${message}`);
  process.exit(1);
}

if (require.main === module) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    if (error && (error.code || error.path || error.message)) {
      const pieces = [error.code, error.message].filter(Boolean);
      console.error(`codex-switch: ${pieces.join(": ")}`);
      if (error.path) {
        console.error(`path: ${error.path}`);
      }
      process.exit(1);
    }
    throw error;
  }
}

module.exports = { main };
