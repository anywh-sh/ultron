import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { PROFILES, type Profile } from "./profiles";

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
    url: profile.url,
    title: `ultron — ${profile.label}`,
    width: 1000,
    height: 700,
  });
}

function renderProfilePicker(container: HTMLElement): void {
  for (const profile of PROFILES) {
    const button = document.createElement("button");
    button.textContent = profile.label;
    button.dataset.profileId = profile.id;
    button.addEventListener("click", () => {
      void openProfileWindow(profile);
    });
    container.appendChild(button);
  }
}

window.addEventListener("DOMContentLoaded", () => {
  const list = document.querySelector<HTMLDivElement>("#profile-list");
  if (!list) {
    throw new Error("#profile-list not found in index.html");
  }
  renderProfilePicker(list);
});
