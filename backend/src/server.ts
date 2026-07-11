import "dotenv/config";
import { ConfigError, loadConfig } from "./config";
import { initSentry } from "./lib/sentry";
import { buildApp } from "./app";

initSentry("api");

async function main() {
  const config = loadConfig();
  const app = await buildApp(config);
  await app.listen({ port: config.PORT, host: "0.0.0.0" });
}

main().catch((err) => {
  if (err instanceof ConfigError) {
    console.error(err.message);
  } else {
    console.error("api failed to start:", err);
  }
  process.exit(1);
});
