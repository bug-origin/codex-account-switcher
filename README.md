# codex-account-switcher

Switch Codex between multiple accounts, API keys, and providers from the command line.

Codex reads its active local state from `~/.codex/config.toml` and `~/.codex/auth.json`. This tool stores complete profiles under `~/.codex/profiles/<name>/` and swaps those two active files when you run `codex-switch use <name>`.

It is designed for people who use both:

- the official OpenAI / ChatGPT Codex login
- a third-party OpenAI-compatible API key and base URL

## Install

```sh
npm install -g @oepnok/codex-account-switcher
```

Or run from a checkout:

```sh
git clone https://github.com/bug-origin/codex-account-switcher.git
cd codex-account-switcher
npm install -g .
```

## Quick Start

Save your current Codex setup:

```sh
codex-switch save official --label "OpenAI ChatGPT"
```

Configure Codex for your third-party provider, then save it too:

```sh
codex-switch save third-party --label "Third-party API"
```

Switch any time:

```sh
codex-switch use official
codex-switch use third-party
```

Check what is active:

```sh
codex-switch status
codex-switch list
```

## Import Existing Files

If you already keep separate files, import them directly:

```sh
codex-switch import official \
  --config ~/.codex/config.official.toml \
  --auth ~/.codex/auth.official.json

codex-switch import third-party \
  --config ~/.codex/config.third-party.toml \
  --auth ~/.codex/auth.third-party.json
```

Then switch with:

```sh
codex-switch use official
codex-switch use third-party
```

## Commands

```text
codex-switch status
codex-switch list
codex-switch save <name> [--label <text>] [--force]
codex-switch import <name> --config <path> --auth <path> [--label <text>] [--force]
codex-switch use <name> [--no-backup]
codex-switch backup
codex-switch delete <name> --force
codex-switch paths
codex-switch doctor
```

Aliases:

- `codex-account`
- `codex-profile`

## How It Works

Each profile is a directory:

```text
~/.codex/profiles/official/
  config.toml
  auth.json
  profile.json
```

When you run `codex-switch use official`, the tool:

1. verifies the profile has both `config.toml` and `auth.json`
2. backs up the current active files to `~/.codex/switch-backups/`
3. atomically replaces `~/.codex/config.toml` and `~/.codex/auth.json`
4. records the last switched profile in `~/.codex/.active-profile`

The command output never prints `config.toml` or `auth.json` contents.

## Environment Variables

- `CODEX_HOME`: override the Codex home directory. Defaults to `~/.codex`.
- `CODEX_SWITCHER_PROFILES_DIR`: override where profiles are stored. Defaults to `$CODEX_HOME/profiles`.

Equivalent command-line flags:

```sh
codex-switch --codex-home /path/to/.codex status
codex-switch --profiles-dir /path/to/profiles list
```

## Security Notes

Profiles and backups contain credentials because `auth.json` can contain API keys or login tokens. Keep your `~/.codex` directory private, do not commit profile directories, and do not paste `auth.json` into issue reports.

The tool writes profile, backup, config, and auth files with `0600` permissions on POSIX filesystems and profile directories with `0700` permissions.

## Publishing

To publish your fork:

```sh
npm test
npm pack --dry-run
npm publish
```

For GitHub, create a repository and push:

```sh
git init
git add .
git commit -m "Initial release"
git branch -M main
git remote add origin git@github.com:bug-origin/codex-account-switcher.git
git push -u origin main
```
