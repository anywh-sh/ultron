import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { PROFILES, findProfile, type Profile } from "./profiles";
import { mountChatView } from "./chatView";
import { mountSessionPicker } from "./sessionPicker";

function profileWindowLabel(profile: Profile): string {
  return `profile-${profile.id}`;
}

function sessionWindowLabel(profile: Profile, sessionName: string): string {
  return `profile-${profile.id}-session-${sessionName}`;
}

async function focusOrCreateWindow(label: string, url: string, title: string): Promise<void> {
  const existing = await WebviewWindow.getByLabel(label);
  if (existing) {
    await existing.setFocus();
    return;
  }
  new WebviewWindow(label, { url, title, width: 1000, height: 700 });
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
      void focusOrCreateWindow(
        profileWindowLabel(profile),
        `index.html?profile=${profile.id}`,
        `ultron — ${profile.label}`,
      );
    });
    list.appendChild(button);
  }

  picker.append(heading, hint, list);
  root.appendChild(picker);
}

function renderSessionPicker(root: HTMLElement, profile: Profile): void {
  document.title = `ultron — ${profile.label}`;
  void mountSessionPicker(root, profile, {
    onOpenSession: (sessionName) => {
      void focusOrCreateWindow(
        sessionWindowLabel(profile, sessionName),
        `index.html?profile=${profile.id}&session=${encodeURIComponent(sessionName)}`,
        `ultron — ${profile.label} — ${sessionName}`,
      );
    },
  });
}

function renderChat(root: HTMLElement, profile: Profile, sessionName: string): void {
  const container = document.createElement("div");
  container.id = "chat-container";
  root.appendChild(container);

  document.title = `ultron — ${profile.label} — ${sessionName}`;
  mountChatView(container, profile, sessionName);
}

window.addEventListener("DOMContentLoaded", () => {
  const root = document.querySelector<HTMLDivElement>("#app");
  if (!root) {
    throw new Error("#app not found in index.html");
  }

  const params = new URLSearchParams(window.location.search);
  const profileId = params.get("profile");
  if (profileId === null) {
    renderProfilePicker(root);
    return;
  }

  const profile = findProfile(profileId);
  if (!profile) {
    throw new Error(`perfil desconhecido: ${profileId}`);
  }

  const sessionName = params.get("session");
  if (sessionName === null) {
    renderSessionPicker(root, profile);
    return;
  }

  renderChat(root, profile, sessionName);
});
