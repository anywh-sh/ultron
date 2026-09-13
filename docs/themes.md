# Themes

A theme is a JSON file with six colors in it. Everything else — the surface
stack, faint text, the terminal and syntax palettes, button ink — is derived
from those six, and any derived token can be overridden individually if you
disagree with what was derived.

Themes are chosen per profile and stored in the host registry next to the
profile's label, so picking one on your laptop shows up on your phone the
next time it syncs.

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

Custom themes land in `~/.config/anywh/themes/*.json` on the relay machine
and are host-wide: a theme added once is selectable from every profile on
that machine. The built-in theme ships inside the app and always works, even
with the relay unreachable.

## Deleting one

Deleting a theme that a profile is currently using leaves that reference
dangling on purpose — the profile falls back to the built-in theme rather
than having its theme silently rewritten to something it never chose.
