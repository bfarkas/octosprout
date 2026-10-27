#!/usr/bin/env node
/**
 * octosprout-server
 *
 *   octosprout-server [serve]
 *   octosprout-server token create <name>
 *   octosprout-server token revoke <name>
 *   octosprout-server token list
 *   octosprout-server approval-key generate <file>
 *   octosprout-server approval-key show
 */
import { ConfigError, loadConfig } from "./config.js";
import { generateSigningKeyFile, keyEntry, loadSigningKey } from "./approvals/signing-key.js";
import { TokenStore } from "./http/tokens.js";
import { startServer } from "./server.js";

const USAGE =
  "usage: octosprout-server [serve] | token create <name> | token revoke <name> | token list | approval-key generate <file> | approval-key show";

async function main(argv: string[]): Promise<number> {
  const [command = "serve", subcommand, name] = argv;

  // Generating a key needs no configuration: it runs before the server is set up.
  if (command === "approval-key" && subcommand === "generate" && name) {
    const key = generateSigningKeyFile(name);
    console.error(`Wrote the approval signing key to ${name}. Mount it as the approval_signing_key secret.`);
    console.error("Its public key, for approval_public_keys in octosprout.yaml (the server can add it for you from Settings):");
    console.log(keyEntry(key).trimEnd());
    return 0;
  }

  const config = loadConfig();

  if (command === "approval-key") {
    if (subcommand !== "show") {
      console.error(USAGE);
      return 2;
    }
    if (!config.approvalKeyFile) {
      console.error("OCTOSPROUT_APPROVAL_KEY_FILE is not set.");
      return 1;
    }
    console.log(keyEntry(loadSigningKey(config.approvalKeyFile)).trimEnd());
    return 0;
  }

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
