import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { format } from "@scalar/rust-fmt";
for (const path of [
  "apps/desktop/src-tauri/src/lib.rs",
  "apps/desktop/src-tauri/src/export.rs",
  "apps/desktop/src-tauri/src/main.rs",
  "apps/desktop/src-tauri/build.rs",
]) {
  const target = fileURLToPath(new URL("../" + path, import.meta.url));
  const source = await readFile(target, "utf8");
  await writeFile(target, await format(source, { edition: "2021" }));
  console.log(`Formatted ${path}`);
}
