# Metrora GNOME Extension

Monitor local AI coding usage, tokens and costs from the GNOME desktop panel.

## Requirements

- GNOME Shell 45 or later
- Metrora CLI installed from this repository
- `glib-compile-schemas` (usually part of `glib2-devel` or `libglib2.0-dev`)

The extension currently retains the inherited UUID `codeburn@codeburn.dev`, settings schema and `codeburn` CLI fallback so existing GNOME installations and local state continue to work. Its product-facing identity is Metrora.

## Install

```bash
cd gnome
chmod +x install.sh
./install.sh
```

Then restart GNOME Shell:
- **Wayland:** log out and back in
- **X11:** press `Alt+F2`, type `r`, press Enter

Enable the extension:

```bash
gnome-extensions enable codeburn@codeburn.dev
```

## Configure

Open preferences:

```bash
gnome-extensions prefs codeburn@codeburn.dev
```

Or use the GNOME Extensions app.

### Settings

| Setting | Default | Description |
|---------|---------|-------------|
| Refresh Interval | 30s | How often to poll the local compatibility CLI |
| Default Period | Today | Period shown on open |
| Compact Mode | Off | Hide cost label, show icon only |
| Budget Threshold | $0 | Daily budget alert (0 = disabled) |
| Budget Alerts | Off | Show warning when budget exceeded |
| CLI Path | (auto) | Custom path to the local Metrora/compatibility binary |

## Uninstall

```bash
gnome-extensions disable codeburn@codeburn.dev
rm -r ~/.local/share/gnome-shell/extensions/codeburn@codeburn.dev
```

## Development

```bash
# Compile schemas locally
glib-compile-schemas schemas/

# Symlink for development
ln -sf "$(pwd)" ~/.local/share/gnome-shell/extensions/codeburn@codeburn.dev

# Watch logs
journalctl -f -o cat /usr/bin/gnome-shell
```
