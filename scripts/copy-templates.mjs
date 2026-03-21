import node_fs from "node:fs";
import node_path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = node_path.resolve(node_path.dirname(fileURLToPath(import.meta.url)), "..");
const sourceDir = node_path.join(rootDir, "src", "templates");
const targetDir = node_path.join(rootDir, "dist", "templates");

try {
  node_fs.cpSync(sourceDir, targetDir, { recursive: true });
} catch (error) {
  console.error(`Failed to copy templates from ${sourceDir} to ${targetDir}: ${error.message}`);
  process.exit(1);
}
