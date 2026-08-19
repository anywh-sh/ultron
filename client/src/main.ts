import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { PROFILES, findProfile, type Profile } from "./profiles";
import { mountTerminalView } from "./terminalView";

function windowLabelFor(profile: Profile): string {
  return `profile-${profile.id}`;
}

async function openProfileWindow(profile: Profile): Promise<void> {
  const label = windowLabelFor(profile);
  const existing = await WebviewWindow.getByLabel(label);
  if (existing) {
    await existing.setFocus();
    return;
  }

  new WebviewWindow(label, {
    url: `index.html?profile=${profile.id}`,
    title: `ultron — ${profile.label}`,
    width: 1000,
    height: 700,
  });
}

function renderProfilePicker(root: HTMLElement): void {
  const picker = document.createElement("main");
  picker.id = "profile-picker";

  const heading = document.createElement("h1");
  heading.textContent = "ultron";

  const hint = document.createElement("p");
  hint.textContent = "Escolha um perfil:";

  const list = document.createElement("div");
  list.id = "profile-list";
  for (const profile of PROFILES) {
    const button = document.createElement("button");
    button.textContent = profile.label;
    button.dataset.profileId = profile.id;
    button.addEventListener("click", () => {
      void openProfileWindow(profile);
    });
    list.appendChild(button);
  }

  picker.append(heading, hint, list);
  root.appendChild(picker);
}

function renderTerminal(root: HTMLElement, profile: Profile): void {
  const container = document.createElement("div");
  container.id = "terminal-container";
  root.appendChild(container);

  document.title = `ultron — ${profile.label}`;
  mountTerminalView(container, profile);
}

window.addEventListener("DOMContentLoaded", () => {
  const root = document.querySelector<HTMLDivElement>("#app");
  if (!root) {
    throw new Error("#app not found in index.html");
  }

  const profileId = new URLSearchParams(window.location.search).get("profile");
  if (profileId === null) {
    renderProfilePicker(root);
    return;
  }

  const profile = findProfile(profileId);
  if (!profile) {
    throw new Error(`perfil desconhecido: ${profileId}`);
  }
  renderTerminal(root, profile);
});
