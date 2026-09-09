import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FileTree } from "./FileTree";
import type { Profile } from "@/lib/profiles";
import type { FilesListResult } from "@/lib/filesClient";

vi.mock("@/lib/filesClient", () => ({
  listFiles: vi.fn(),
  createFile: vi.fn(),
  deleteFile: vi.fn(),
  renameFile: vi.fn(),
}));
vi.mock("@/lib/fileDownload", () => ({
  downloadFile: vi.fn(),
}));

import { createFile, deleteFile, listFiles, renameFile } from "@/lib/filesClient";
import { downloadFile } from "@/lib/fileDownload";

const profile: Profile = { id: "p1", label: "Perfil", host: "localhost", relayPort: 4317 };
const root = "/home/user/project";

function listing(): FilesListResult {
  return {
    root,
    path: root,
    entries: [
      { name: "src", path: `${root}/src`, kind: "dir", size: 0, mtimeMs: 900 },
      { name: "notas.txt", path: `${root}/notas.txt`, kind: "file", size: 12, mtimeMs: 1000 },
    ],
  };
}

beforeEach(() => {
  vi.mocked(listFiles).mockResolvedValue(listing());
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function renderTree(
  overrides: {
    onFileDeleted?: (path: string) => void;
    onFileRenamed?: (oldPath: string, newPath: string) => void;
    onOpenTerminal?: (path: string) => void;
    onOpenPinned?: (path: string) => void;
  } = {},
) {
  return render(
    <FileTree
      profile={profile}
      sessionId="session-1"
      root={root}
      expanded={[]}
      activePath={null}
      showHidden={false}
      changedDir={null}
      onToggleExpand={() => {}}
      onOpenPreview={() => {}}
      onOpenPinned={overrides.onOpenPinned ?? (() => {})}
      onFileDeleted={overrides.onFileDeleted ?? (() => {})}
      onFileRenamed={overrides.onFileRenamed ?? (() => {})}
      onOpenTerminal={overrides.onOpenTerminal ?? (() => {})}
    />,
  );
}

describe("FileTree context menu", () => {
  it("shows Baixar/Renomear/Excluir on right-click and downloads on Baixar", async () => {
    const user = userEvent.setup();
    renderTree();
    const row = await screen.findByText("notas.txt");

    await user.pointer({ keys: "[MouseRight]", target: row });
    expect(await screen.findByText("Baixar")).toBeInTheDocument();
    expect(screen.getByText("Renomear")).toBeInTheDocument();
    expect(screen.getByText("Excluir")).toBeInTheDocument();

    await user.click(screen.getByText("Baixar"));
    expect(downloadFile).toHaveBeenCalledWith(profile, "session-1", `${root}/notas.txt`, "notas.txt", 1000);
  });

  it("renames the file and reports the new path to the caller", async () => {
    vi.mocked(renameFile).mockResolvedValue({ path: `${root}/renomeado.txt` });
    const onFileRenamed = vi.fn();
    const user = userEvent.setup();
    renderTree({ onFileRenamed });
    const row = await screen.findByText("notas.txt");

    await user.pointer({ keys: "[MouseRight]", target: row });
    await user.click(await screen.findByText("Renomear"));

    const dialog = await screen.findByRole("dialog");
    const input = within(dialog).getByDisplayValue("notas.txt");
    await user.clear(input);
    await user.type(input, "renomeado.txt");
    await user.click(within(dialog).getByRole("button", { name: "Renomear" }));

    await waitFor(() => expect(renameFile).toHaveBeenCalledWith(profile, "session-1", `${root}/notas.txt`, "renomeado.txt"));
    expect(onFileRenamed).toHaveBeenCalledWith(`${root}/notas.txt`, `${root}/renomeado.txt`);
  });

  it("deletes the file only after confirming, and reports it to the caller", async () => {
    vi.mocked(deleteFile).mockResolvedValue(undefined);
    const onFileDeleted = vi.fn();
    const user = userEvent.setup();
    renderTree({ onFileDeleted });
    const row = await screen.findByText("notas.txt");

    await user.pointer({ keys: "[MouseRight]", target: row });
    await user.click(await screen.findByText("Excluir"));

    // The confirmation dialog, not the delete call, should gate the action.
    const dialog = await screen.findByRole("alertdialog");
    expect(deleteFile).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole("button", { name: "Excluir" }));

    await waitFor(() => expect(deleteFile).toHaveBeenCalledWith(profile, "session-1", `${root}/notas.txt`));
    expect(onFileDeleted).toHaveBeenCalledWith(`${root}/notas.txt`);
  });

  it("right-clicking a row never also surfaces the panel's own menu", async () => {
    const user = userEvent.setup();
    renderTree();
    const row = await screen.findByText("notas.txt");

    await user.pointer({ keys: "[MouseRight]", target: row });
    expect(await screen.findByText("Baixar")).toBeInTheDocument();
    expect(screen.queryByText("Novo arquivo")).toBeNull();
  });

  it("creates a new file from the panel's background menu and opens it", async () => {
    vi.mocked(createFile).mockResolvedValue({ path: `${root}/criado.txt` });
    const onOpenPinned = vi.fn();
    const user = userEvent.setup();
    const { container } = renderTree({ onOpenPinned });
    await screen.findByText("notas.txt");

    // The tree's own scroll container, not a specific row — the empty
    // background is what the panel-level menu listens on.
    const panel = container.firstElementChild as HTMLElement;
    await user.pointer({ keys: "[MouseRight]", target: panel });
    await user.click(await screen.findByText("Novo arquivo"));

    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByPlaceholderText("nome-do-arquivo.txt"), "criado.txt");
    await user.click(within(dialog).getByRole("button", { name: "Criar" }));

    await waitFor(() => expect(createFile).toHaveBeenCalledWith(profile, "session-1", "criado.txt"));
    expect(onOpenPinned).toHaveBeenCalledWith(`${root}/criado.txt`);
  });

  it("shows Abrir no terminal on right-click of a folder, and reports its path", async () => {
    const onOpenTerminal = vi.fn();
    const user = userEvent.setup();
    renderTree({ onOpenTerminal });
    const row = await screen.findByText("src");

    await user.pointer({ keys: "[MouseRight]", target: row });
    expect(screen.queryByText("Baixar")).toBeNull();
    await user.click(await screen.findByText("Abrir no terminal"));

    expect(onOpenTerminal).toHaveBeenCalledWith(`${root}/src`);
  });
});
