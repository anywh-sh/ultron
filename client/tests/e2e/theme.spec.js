// Switching to the light theme, in the real Tauri window. This is the one
// tier that can prove any of it.
//
// `themeApply.ts` resolves a theme by reading colors back through
// `getComputedStyle` on a hidden probe element, which is how it supports
// `rgb()`, `hsl()` and `oklch()` without hand-parsing them. Under happy-dom —
// where every unit test in this project runs — that read returns nothing, so
// every derived token silently falls back to the built-in dark value and no
// unit test can tell a working derivation from a broken one. Here there is a
// real engine, so this is where "the light theme actually paints" is a
// question that can be asked at all.
//
// It also stands in for the manual check the light theme never got: it was
// added late and, unlike the dark one, was not looked at on every screen as
// it was built.
describe("anywh themes", () => {
  async function rootState() {
    return browser.execute(() => {
      const root = document.documentElement;
      const styles = getComputedStyle(root);
      return {
        appearance: root.dataset.appearance,
        colorScheme: styles.colorScheme,
        background: styles.getPropertyValue("--background").trim(),
        foreground: styles.getPropertyValue("--foreground").trim(),
        onPrimary: styles.getPropertyValue("--primary-foreground").trim(),
      };
    });
  }

  async function openAppearance() {
    const menu = await $('[aria-label="Menu"]');
    await menu.waitForExist({ timeout: 15000 });
    // Keyboard, not a click: a WebDriver click never delivers the
    // `pointerdown` a Radix trigger opens on (see shell.spec.js).
    await menu.click();
    await browser.keys("Enter");

    const settings = await $('[role="menuitem"]');
    await settings.waitForExist({ timeout: 5000 });
    await browser.keys("Enter");

    const dialog = await $('[role="dialog"]');
    await dialog.waitForExist({ timeout: 5000 });

    const appearance = await $('//button[contains(., "Appearance")]');
    await appearance.waitForExist({ timeout: 5000 });
    await appearance.click();
    return dialog;
  }

  async function pick(themeName) {
    const card = await $(`//button[.//span[text()="${themeName}"]]`);
    await card.waitForExist({ timeout: 5000 });
    await card.click();
  }

  it("starts on the dark built-in with its tokens painted", async () => {
    const state = await rootState();
    if (state.appearance !== "dark") {
      throw new Error(`expected the app to start dark, got "${state.appearance}"`);
    }
    // Not just "a value": an empty custom property is exactly what a failed
    // derivation writes, and it reads as "fine" everywhere else.
    if (!/^#|^rgb/.test(state.background)) {
      throw new Error(`expected --background to hold a color, got "${state.background}"`);
    }
  });

  it("repaints the window when the light built-in is picked", async () => {
    const before = await rootState();
    await openAppearance();
    await pick("Papel");

    await browser.waitUntil(async () => (await rootState()).appearance === "light", {
      timeout: 5000,
      timeoutMsg: "picking the light theme did not flip the root's appearance",
    });

    const after = await rootState();
    // Both halves matter: `data-appearance` drives the `dark:` variant and
    // `color-scheme` drives the native controls (scrollbars, form widgets),
    // and a theme that flipped one without the other would leave a light page
    // with dark scrollbars.
    if (after.colorScheme !== "light") {
      throw new Error(`expected color-scheme to follow the theme, got "${after.colorScheme}"`);
    }
    if (after.background === before.background || after.foreground === before.foreground) {
      throw new Error("the light theme painted the same surface and ink as the dark one");
    }
  });

  it("derives the label on a filled button rather than leaving it empty", async () => {
    // The token the unit tier structurally cannot check: it is written by
    // `themeApply.ts` from a parsed color, and under happy-dom that parse
    // yields nothing. An empty value here would mean a button label painted
    // in whatever it inherits.
    const { onPrimary } = await rootState();
    if (!/^#|^rgb/.test(onPrimary)) {
      throw new Error(`expected --primary-foreground to hold a color, got "${onPrimary}"`);
    }
  });

  it("goes back to the dark built-in", async () => {
    await pick("Noite");
    await browser.waitUntil(async () => (await rootState()).appearance === "dark", {
      timeout: 5000,
      timeoutMsg: "picking the dark theme did not flip the root's appearance back",
    });

    await browser.keys("Escape");
    await browser.waitUntil(async () => !(await $('[role="dialog"]').isExisting()), {
      timeout: 5000,
      timeoutMsg: "settings dialog stayed open after Escape",
    });
  });
});
