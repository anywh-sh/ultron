import { fetchSessionNames } from "./relayClient";
import type { Profile } from "./profiles";

export interface SessionPickerCallbacks {
  onOpenSession: (sessionName: string) => void;
}

export async function mountSessionPicker(
  root: HTMLElement,
  profile: Profile,
  callbacks: SessionPickerCallbacks,
): Promise<void> {
  const picker = document.createElement("main");
  picker.id = "session-picker";

  const heading = document.createElement("h1");
  heading.textContent = `ultron — ${profile.label}`;

  const hint = document.createElement("p");
  hint.textContent = "Sessões abertas:";

  const list = document.createElement("div");
  list.id = "session-list";

  const newSessionForm = document.createElement("form");
  newSessionForm.id = "new-session-form";
  const input = document.createElement("input");
  input.type = "text";
  input.placeholder = "nome da nova sessão (ex: projeto-x)";
  const createButton = document.createElement("button");
  createButton.type = "submit";
  createButton.textContent = "Abrir";
  newSessionForm.append(input, createButton);

  picker.append(heading, hint, list, newSessionForm);
  root.appendChild(picker);

  function addSessionButton(name: string): void {
    const button = document.createElement("button");
    button.textContent = name;
    button.addEventListener("click", () => callbacks.onOpenSession(name));
    list.appendChild(button);
  }

  newSessionForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const name = input.value.trim();
    if (!name) return;
    callbacks.onOpenSession(name);
    input.value = "";
  });

  try {
    const sessionNames = await fetchSessionNames(profile.host, profile.relayPort);
    for (const name of sessionNames) {
      addSessionButton(name);
    }
    if (sessionNames.length === 0) {
      const empty = document.createElement("p");
      empty.textContent = "Nenhuma sessão aberta ainda — crie uma abaixo.";
      list.appendChild(empty);
    }
  } catch (error) {
    const errorEl = document.createElement("p");
    errorEl.textContent = `Não foi possível listar sessões: ${
      error instanceof Error ? error.message : String(error)
    }`;
    list.appendChild(errorEl);
  }
}
