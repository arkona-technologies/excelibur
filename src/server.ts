import { fileURLToPath } from "url";
import path from "path";
import { startServer } from "./server-app.js";

export { buildServer, startServer } from "./server-app.js";

const is_main =
  typeof process.argv[1] === "string" &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (is_main) {
  startServer().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
