# Notification icons

Drop two image files here to give Claude Code and opencode banners
their own icons:

- `claude-code.png` (or `.icns`) — used for Claude Code notifications
- `opencode.png` (or `.icns`) — used for opencode notifications

If either file is missing, notifications fall back to no icon (the
banner still shows title + message).

To override per-user without committing to the repo, set in
`~/.config/stay-alert/config.toml`:

```toml
[notifications]
iconClaudeCode = "/absolute/path/to/your/claude-code-icon.png"
iconOpencode   = "/absolute/path/to/your/opencode-icon.png"
```
