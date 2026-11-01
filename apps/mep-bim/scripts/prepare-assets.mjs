// Copia para a pasta pública do renderer os arquivos carregados em tempo de
// execução: o binário WebAssembly do web-ifc e o modelo de exemplo.
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const pub = join(root, "src", "renderer", "public");

const copies = [
  [join(root, "node_modules", "web-ifc", "web-ifc.wasm"), join(pub, "wasm", "web-ifc.wasm")],
  [join(root, "samples", "exemplo-mep.ifc"), join(pub, "samples", "exemplo-mep.ifc")],
];

for (const [src, dest] of copies) {
  if (!existsSync(src)) {
    console.warn(`[prepare-assets] não encontrado: ${src}`);
    continue;
  }
  mkdirSync(dirname(dest), { recursive: true });
  copyFileSync(src, dest);
  console.log(`[prepare-assets] ${src.slice(root.length + 1)} -> ${dest.slice(root.length + 1)}`);
}
