# Themes

A theme is a JSON file with six colors in it. Everything else — the surface
stack, faint text, the terminal and syntax palettes, button ink — is derived
from those six, and any derived token can be overridden individually if you
disagree with what was derived.

Picking a theme is an app-level choice: one selection per installation,
applied to every profile in that app. It does not sync between devices —
choosing one on your laptop leaves the app on your phone painting whatever
it was already using.

## The minimum viable theme

```json
{
  "version": 1,
  "id": "my-theme",
  "name": "My theme",
  "appearance": "dark",
  "colors": {
    "background": "#2e3440",
    "foreground": "#eceff4",
    "muted-foreground": "#8f9bb0",
    "primary": "#88c0d0",
    "destructive": "#bf616a",
    "border": "#434c5e"
  }
}
```

`appearance` is `"dark"` or `"light"` and tells the app which direction to
derive in. The six keys under `colors` are all required.

## Overriding what was derived

Every color key maps 1:1 to the CSS custom property of the same name —
`background` becomes `--background` — so adding an optional key to `colors`
replaces exactly that token and nothing else. There are a few dozen,
covering surfaces (`bg-sidebar`, `bg-elevated`, `surface-hover`, `card`),
text (`text-faint`, `primary-ink`), syntax highlighting (`syntax-keyword`,
`syntax-string`, …) and per-profile accents.

You don't have to look them up. Use **Create copy** on any existing theme to
get its full JSON with every token spelled out, then edit from there — that
is the intended way to write a theme, and it's why the dialog exists.

One derived token worth knowing about: `primary-foreground`, the label on a
filled button, is derived from the accent itself rather than defaulting to
`foreground`, because `foreground` is unreadable on any mid-tone accent.
Declare it yourself if your accent sits somewhere the derivation guesses
wrong.

## Adding one

**Settings → Appearance → Add theme**, then either paste the JSON or pick a
file. The dialog validates before saving and reports one message per field,
so a broken theme tells you exactly which key is wrong rather than failing
as a whole.

The theme file itself is stored on the relay machine, under
`~/.config/anywh/themes/*.json`, and is host-wide: add a theme once and it
becomes selectable from every profile on that machine — by any app that
connects to it, each still making its own choice about whether to use it.

The built-in theme ships inside the app and always works, even with the
relay unreachable.

## Deleting one

Deleting a theme file that an app is currently painting leaves that
selection dangling on purpose. The app falls back to the built-in theme
rather than having its choice silently rewritten to something nobody picked,
and the same happens whenever the relay holding the file is unreachable.
