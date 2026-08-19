import { PROFILES, type Profile } from "./profiles";

function navigateToProfile(profile: Profile): void {
  window.location.replace(profile.url);
}

function renderProfilePicker(container: HTMLElement): void {
  for (const profile of PROFILES) {
    const button = document.createElement("button");
    button.textContent = profile.label;
    button.dataset.profileId = profile.id;
    button.addEventListener("click", () => navigateToProfile(profile));
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
