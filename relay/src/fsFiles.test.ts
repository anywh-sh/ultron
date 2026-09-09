import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deleteFile, listFiles, readFileForViewer, renameFile, resolveRawFile, resolveWithinRoot } from "./fsFiles.js";

function withTempDir(run: (dir: string) => void): void {
  const dir = mkdtempSync(join(tmpdir(), "ultron-fsfiles-test-"));
  try {
    run(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("resolveWithinRoot: no path given resolves to the root itself", () => {
  withTempDir((dir) => {
    assert.deepEqual(resolveWithinRoot(dir, null), { ok: true, root: dir, path: dir });
  });
});

test("resolveWithinRoot: rejects a relative path", () => {
  withTempDir((dir) => {
    assert.deepEqual(resolveWithinRoot(dir, "relative/path"), { ok: false, error: "invalid_path" });
  });
});

test("resolveWithinRoot: rejects a path that resolves outside the root", () => {
  withTempDir((outer) => {
    withTempDir((root) => {
      // A real, existing path that just isn't under `root` — this is what a
      // `../` traversal collapses down to once `path.resolve` normalizes it.
      const result = resolveWithinRoot(root, outer);
      assert.equal(result.ok, false);
      if (!result.ok) assert.equal(result.error, "outside_root");
    });
  });
});

test("resolveWithinRoot: rejects a symlink that escapes the root", () => {
  withTempDir((outer) => {
    withTempDir((root) => {
      const target = join(outer, "secret.txt");
      writeFileSync(target, "conteúdo secreto");
      const link = join(root, "link-pra-fora");
      symlinkSync(target, link);

      const result = resolveWithinRoot(root, link);
      assert.equal(result.ok, false);
      if (!result.ok) assert.equal(result.error, "outside_root");
    });
  });
});

test("resolveWithinRoot: nonexistent path propagates not_found", () => {
  withTempDir((dir) => {
    const result = resolveWithinRoot(dir, join(dir, "nao-existe"));
    assert.deepEqual(result, { ok: false, error: "not_found" });
  });
});

test("listFiles: directories before files, alphabetical within each group", () => {
  withTempDir((dir) => {
    mkdirSync(join(dir, "pasta-b"));
    mkdirSync(join(dir, "pasta-a"));
    writeFileSync(join(dir, "b.txt"), "b");
    writeFileSync(join(dir, "a.txt"), "a");

    const result = listFiles(dir, null, false);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.deepEqual(
      result.entries.map((e) => [e.name, e.kind]),
      [
        ["pasta-a", "dir"],
        ["pasta-b", "dir"],
        ["a.txt", "file"],
        ["b.txt", "file"],
      ],
    );
  });
});

test("listFiles: dotfiles and node_modules are hidden by default, shown with showHidden", () => {
  withTempDir((dir) => {
    writeFileSync(join(dir, ".env"), "SECRET=1");
    mkdirSync(join(dir, "node_modules"));
    writeFileSync(join(dir, "visible.txt"), "conteúdo");

    const filtered = listFiles(dir, null, false);
    assert.equal(filtered.ok, true);
    if (filtered.ok) assert.deepEqual(filtered.entries.map((e) => e.name), ["visible.txt"]);

    const all = listFiles(dir, null, true);
    assert.equal(all.ok, true);
    if (all.ok) {
      assert.deepEqual(
        all.entries.map((e) => e.name).sort(),
        [".env", "node_modules", "visible.txt"],
      );
    }
  });
});

test("listFiles: a path outside the root is rejected", () => {
  withTempDir((outer) => {
    withTempDir((root) => {
      const result = listFiles(root, outer, false);
      assert.equal(result.ok, false);
      if (!result.ok) assert.equal(result.error, "outside_root");
    });
  });
});

test("readFileForViewer: plain text file", () => {
  withTempDir((dir) => {
    const file = join(dir, "notas.txt");
    writeFileSync(file, "linha 1\nlinha 2\n");

    const result = readFileForViewer(dir, file);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.kind, "text");
    if (result.kind === "text") {
      assert.equal(result.content, "linha 1\nlinha 2\n");
      assert.equal(result.truncated, false);
    }
  });
});

test("readFileForViewer: a large text file is truncated at the byte cap", () => {
  withTempDir((dir) => {
    const file = join(dir, "grande.txt");
    const size = 2 * 1024 * 1024 + 10;
    writeFileSync(file, Buffer.alloc(size, "a"));

    const result = readFileForViewer(dir, file);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.kind, "text");
    if (result.kind === "text") {
      assert.equal(result.truncated, true);
      assert.equal(result.content.length, 2 * 1024 * 1024);
      assert.equal(result.size, size);
    }
  });
});

test("readFileForViewer: a file with a null byte is classified as binary", () => {
  withTempDir((dir) => {
    const file = join(dir, "dados.bin");
    writeFileSync(file, Buffer.from([0x00, 0x01, 0x02, 0xff]));

    const result = readFileForViewer(dir, file);
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.kind, "binary");
  });
});

test("readFileForViewer: an image is detected by extension, without reading its bytes", () => {
  withTempDir((dir) => {
    const file = join(dir, "foto.png");
    // Deliberately not a real PNG — detection is extension-only, this
    // proves the content is never sniffed for image files.
    writeFileSync(file, "not actually a png");

    const result = readFileForViewer(dir, file);
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.kind, "image");
      if (result.kind === "image") assert.equal(result.mime, "image/png");
    }
  });
});

test("readFileForViewer: an empty file is text, not binary", () => {
  withTempDir((dir) => {
    const file = join(dir, "vazio.txt");
    writeFileSync(file, "");

    const result = readFileForViewer(dir, file);
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.kind, "text");
  });
});

test("resolveRawFile: resolves mime by extension", () => {
  withTempDir((dir) => {
    const file = join(dir, "foto.webp");
    writeFileSync(file, "bytes");

    const result = resolveRawFile(dir, file);
    assert.deepEqual(result, { ok: true, path: file, mime: "image/webp" });
  });
});

test("resolveRawFile: nonexistent file propagates not_found", () => {
  withTempDir((dir) => {
    const result = resolveRawFile(dir, join(dir, "nao-existe.png"));
    assert.deepEqual(result, { ok: false, error: "not_found" });
  });
});

test("deleteFile: removes the file", () => {
  withTempDir((dir) => {
    const file = join(dir, "descarte.txt");
    writeFileSync(file, "lixo");

    assert.deepEqual(deleteFile(dir, file), { ok: true });
    assert.equal(existsSync(file), false);
  });
});

test("deleteFile: a directory is rejected as not_found", () => {
  withTempDir((dir) => {
    const sub = join(dir, "pasta");
    mkdirSync(sub);

    const result = deleteFile(dir, sub);
    assert.deepEqual(result, { ok: false, error: "not_found" });
    assert.equal(existsSync(sub), true);
  });
});

test("deleteFile: a path outside the root is rejected", () => {
  withTempDir((outer) => {
    withTempDir((root) => {
      const file = join(outer, "fora.txt");
      writeFileSync(file, "fora");

      const result = deleteFile(root, file);
      assert.equal(result.ok, false);
      if (!result.ok) assert.equal(result.error, "outside_root");
      assert.equal(existsSync(file), true);
    });
  });
});

test("renameFile: renames within the same directory", () => {
  withTempDir((dir) => {
    const file = join(dir, "antigo.txt");
    writeFileSync(file, "conteúdo");

    const result = renameFile(dir, file, "novo.txt");
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.path, join(dir, "novo.txt"));
    assert.equal(existsSync(file), false);
    assert.equal(existsSync(join(dir, "novo.txt")), true);
  });
});

test("renameFile: a name containing a path separator is rejected", () => {
  withTempDir((dir) => {
    const file = join(dir, "antigo.txt");
    writeFileSync(file, "conteúdo");

    const result = renameFile(dir, file, "../fora.txt");
    assert.deepEqual(result, { ok: false, error: "invalid_name" });
    assert.equal(existsSync(file), true);
  });
});

test("renameFile: a name that already exists in the directory is rejected", () => {
  withTempDir((dir) => {
    const file = join(dir, "antigo.txt");
    writeFileSync(file, "conteúdo");
    writeFileSync(join(dir, "novo.txt"), "já existe");

    const result = renameFile(dir, file, "novo.txt");
    assert.deepEqual(result, { ok: false, error: "already_exists" });
    assert.equal(existsSync(file), true);
  });
});
