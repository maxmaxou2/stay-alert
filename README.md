# stay-alert

A macOS-only CLI that notifies you when your AI coding agent (Claude Code, opencode) or any long-running shell command needs your attention — but only when your terminal isn't focused.

## Overview

stay-alert wires up:

- **Claude Code** `Stop` and `Notification` hooks
- **opencode** plugin events
- An optional **zsh** `preexec`/`precmd` hook for arbitrary long-running commands

Notifications are delivered through a tiny bundled Swift app (`StayAlertNotifier.app`) so banners carry a real icon and survive Terminal/iTerm/Ghostty permission quirks. When your terminal is the frontmost window (and, under tmux, the active pane is the one running the agent), notifications are downgraded to **transient** and otherwise are **sticky** so you don't miss them.

## Status

Early / personal use. macOS only. Requires `bun` and Xcode Command Line Tools (for `swiftc`).

## Install

```sh
git clone https://github.com/<you>/stay-alert.git
cd stay-alert
make setup        # installs prereqs, runs `bun link`, then `stay-alert init`
```

`make setup` will:

1. Ensure Xcode CLT, Homebrew, and `bun` are present.
2. `bun install` and `bun link` (exposes the `stay-alert` binary globally).
3. Run `stay-alert init --claude-code --opencode --shell-rc ~/.zshrc`.

Override the shell rc target with `make setup SHELL_RC=/path/to/rc`.

To uninstall the global link: `make uninstall`.

## Quickstart

```sh
stay-alert init                  # Claude Code + opencode (no shell hook)
stay-alert init --shell          # also install the zsh hook into ~/.zshrc
stay-alert test                  # fire one transient + one sticky banner
stay-alert grant-terminal-notifications
                                 # run once per terminal app (Terminal, iTerm, Ghostty…)
                                 # to trigger macOS' notification-permission prompt
```

If banners don't appear, open **System Settings → Notifications → StayAlertNotifier** and make sure alerts are enabled.

## Commands

| Command | Purpose |
| --- | --- |
| `init [--claude-code] [--opencode] [--shell] [--shell-rc PATH]` | Install hooks/plugin/shell wrapper. With no flags, defaults to `--claude-code --opencode`. |
| `grant-terminal-notifications` | Prompt the current terminal app for macOS notification permission. |
| `test` | Send one transient and one sticky notification. |
| `claude-code-hook <on-stop\|on-notification>` | Internal — invoked by Claude Code. |
| `notify-command --cmd C --exit N --duration-ms N` | Internal — invoked by the zsh hook. |

Flags: `--help/-h`, `--version/-v`. Set `STAY_ALERT_DEBUG=1` for verbose errors.

## Configuration

Configuration lives at `~/.config/stay-alert/config.toml` (respects `XDG_CONFIG_HOME`). All keys are optional; missing keys fall back to defaults. See `examples/config.toml`.

```toml
[notifications]
# stickySound:    sound for sticky banners (default: "default")
# transientSound: sound for transient banners (default: none — omit the key)
stickySound = "default"
# iconClaudeCode / iconOpencode: absolute paths overriding assets/*.png
# iconClaudeCode = "/absolute/path/to/icon.png"

[shell]
thresholdMs = 15000              # only notify for commands longer than this
ignore = ["vim", "nvim", "ssh", "tmux", "claude", "opencode", ...]
```

Override the install root with `STAY_ALERT_HOME` (otherwise XDG paths are used; the notifier bundle is built into `~/Applications/StayAlertNotifier.app`).

## How focus detection works

stay-alert decides between transient and sticky banners using a small Swift helper (`bundle-id`) that resolves:

1. The bundle ID of the terminal hosting the current shell (via the process tree, falling back to the tmux client PID).
2. The frontmost app's bundle ID.
3. Under tmux, whether the active pane matches `$TMUX_PANE` of the calling process.

If host == frontmost (and the tmux pane matches), the terminal is considered focused → **transient**. Otherwise → **sticky**.

## Notifications on macOS

Banners are sent through `StayAlertNotifier.app`, built and code-signed (ad-hoc) on `init`. The bundle is rebuilt automatically when the Swift source or icons change.

- Icons live in `assets/notifier.png`, `assets/claude-code.png`, `assets/opencode.png` (`.icns` also accepted).
- Per-user icon overrides via the `iconClaudeCode` / `iconOpencode` config keys.
- Run `stay-alert grant-terminal-notifications` once per terminal emulator you use, so macOS associates the permission with that terminal.

## Claude Code setup

`stay-alert init --claude-code` patches `~/.claude/settings.json` to add two hooks:

```json
{
  "hooks": {
    "Stop":         [{"hooks": [{"type": "command", "command": "stay-alert claude-code-hook on-stop"}]}],
    "Notification": [{"hooks": [{"type": "command", "command": "stay-alert claude-code-hook on-notification"}]}]
  }
}
```

Existing hooks are preserved; a `.stay-alert.bak` backup is created on first change. The title shown in the banner includes the project folder name (`Claude Code · my-repo`).

## opencode setup

`stay-alert init --opencode` writes `~/.config/opencode/plugins/stay-alert.ts` (copied from `examples/opencode-plugin.ts`) and runs `bun link stay-alert` inside `~/.config/opencode` so the plugin can `import "stay-alert"`. An existing plugin file is backed up to `stay-alert.ts.bak` before being overwritten.

## Shell hook (zsh)

`stay-alert init --shell [--shell-rc PATH]` inserts a managed block into your `.zshrc`:

```sh
# stay-alert begin (managed — do not edit)
… preexec/precmd hooks that call `stay-alert notify-command` …
# stay-alert end
```

Re-running `init` updates the block in place. A `.stay-alert.bak` is created on first modification. Open a new shell or `source ~/.zshrc` for it to take effect.

## Development

```sh
make check        # lint + typecheck + test
make test         # bun test
make lint         # biome check
make format       # biome format --write
make typecheck    # tsc --noEmit
```

Layout:

- `src/cli/` — CLI entrypoint and subcommands
- `src/core/` — config, paths, focus detection, notify dispatcher
- `src/native/` — Swift sources for the notifier bundle and `bundle-id` helper
- `examples/` — sample `config.toml` and the opencode plugin source
- `test/` — `bun test` suites

## License

MIT — see [LICENSE](./LICENSE).
