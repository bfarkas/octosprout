#!/usr/bin/env node
/**
 * octosprout-server
 *
 *   octosprout-server [serve]
 *   octosprout-server token create <name>
 *   octosprout-server token revoke <name>
 *   octosprout-server token list
 */
import { ConfigError, loadConfig } from "./config.js";
import { TokenStore } from "./http/tokens.js";
import { startServer } from "./server.js";

const USAGE = "usage: octosprout-server [serve] | token create <name> | token revoke <name> | token list";

async function main(argv: string[]): Promise<number> {
  const [command = "serve", subcommand, name] = argv;
  const config = loadConfig();

  if (command === "token") {
    const tokens = new TokenStore(config.stateDir);
    if (subcommand === "create" && name) {
      console.log(tokens.create(name));
      console.error(`Created token '${name}'. This is the only time it is shown.`);
      return 0;
    }
    if (subcommand === "revoke" && name) {
      const revoked = tokens.revoke(name);
      console.error(revoked ? `Revoked token '${name}'.` : `No active token named '${name}'.`);
      return revoked ? 0 : 1;
    }
    if (subcommand === "list") {
      for (const token of tokens.list()) {
        console.log(`${token.name}\t${token.scope}\tcreated ${token.created}${token.revoked ? `\trevoked ${token.revoked}` : ""}`);
      }
      return 0;
    }
    console.error(USAGE);
    return 2;
  }

  if (command !== "serve") {
    console.error(USAGE);
    return 2;
  }

  const server = await startServer(config);
  let stopping = false;
  const stop = (signal: string): void => {
    if (stopping) return;
    stopping = true;
    console.error(`${signal} received, shutting down`);
    server.close().then(
      () => process.exit(0),
      (error: unknown) => {
        console.error(error);
        process.exit(1);
      },
    );
  };
  process.on("SIGTERM", () => stop("SIGTERM"));
  process.on("SIGINT", () => stop("SIGINT"));
  return -1; // keep running
}

main(process.argv.slice(2)).then(
  (code) => {
    if (code >= 0) process.exit(code);
  },
  (error: unknown) => {
    console.error(error instanceof ConfigError ? `Configuration error: ${error.message}` : error);
    process.exit(1);
  },
);
