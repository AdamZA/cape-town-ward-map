// Copy ../data into public/data so Vite serves and bundles it. (No symlinks: painful on Windows.)
import { cpSync, rmSync } from "node:fs";

const src = new URL("../../data/", import.meta.url);
const dst = new URL("../public/data/", import.meta.url);
rmSync(dst, { recursive: true, force: true });
cpSync(src, dst, { recursive: true });
console.log("copied data/ -> web/public/data/");
