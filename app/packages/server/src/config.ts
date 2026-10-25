/**
 * Server configuration from environment variables (spec §18.1).
 * Secrets arrive as files (Docker secrets), never as values.
 */

export interface ServerConfig {
  /** The dedicated clone of the workspace repository. */
  repoDir: string;
  /** Sessions, credentials, token hashes: everything that is not in Git. */
  stateDir: string;
  host: string;
  port: number;
  /** Where to clone the workspace from when `repoDir` is empty. */
  remoteUrl?: string;
  /** SSH deploy key with write access to the workspace repository only. */
  deployKeyFile?: string;
  /** WebAuthn relying party ID. Passkeys keep working across subdomains of it. */
  rpId: string;
  /** The exact origin the app is served from. */
  origin: string;
  /** File holding the setup token for passkey registration. Without it, /setup is disabled. */
  setupTokenFile?: string;
  /** Trust `X-Forwarded-For` from these proxies (Caddy), or not at all. */
  trustProxy: boolean | string[];
  syncIntervalMs: number;
  logLevel: string;
}

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

const LOG_LEVELS = ["fatal", "error", "warn", "info", "debug", "trace", "silent"];

function integer(env: NodeJS.ProcessEnv, name: string, fallback: number, min: number, max: number): number {
  const raw = env[name];
  if (raw === undefined || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new ConfigError(`${name} must be an integer from ${min} to ${max}, got '${raw}'.`);
  }
  return value;
}

/** Normalizes to a bare origin; WebAuthn compares it exactly. */
function origin(value: string): string {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" && url.hostname !== "localhost") throw new Error("not https");
    return url.origin;
  } catch {
    throw new ConfigError(`OCTOSPROUT_ORIGIN must be an https origin (http is allowed for localhost only), got '${value}'.`);
  }
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const logLevel = env.OCTOSPROUT_LOG_LEVEL || "info";
  if (!LOG_LEVELS.includes(logLevel)) {
    throw new ConfigError(`OCTOSPROUT_LOG_LEVEL must be one of ${LOG_LEVELS.join(", ")}.`);
  }

  const trust = env.OCTOSPROUT_TRUST_PROXY;
  const trustProxy = trust === undefined || trust === "" || trust === "false" ? false : trust.split(",").map((entry) => entry.trim());

  return {
    repoDir: env.OCTOSPROUT_REPO_DIR || "/var/lib/octosprout/repo",
    stateDir: env.OCTOSPROUT_STATE_DIR || "/var/lib/octosprout/state",
    host: env.OCTOSPROUT_HOST || "0.0.0.0",
    port: integer(env, "OCTOSPROUT_PORT", 8080, 1, 65535),
    ...(env.OCTOSPROUT_REMOTE_URL ? { remoteUrl: env.OCTOSPROUT_REMOTE_URL } : {}),
    ...(env.OCTOSPROUT_DEPLOY_KEY_FILE ? { deployKeyFile: env.OCTOSPROUT_DEPLOY_KEY_FILE } : {}),
    rpId: env.OCTOSPROUT_RP_ID || "octosprout.de",
    origin: origin(env.OCTOSPROUT_ORIGIN || "https://app.octosprout.de"),
    ...(env.OCTOSPROUT_SETUP_TOKEN_FILE ? { setupTokenFile: env.OCTOSPROUT_SETUP_TOKEN_FILE } : {}),
    trustProxy,
    syncIntervalMs: integer(env, "OCTOSPROUT_SYNC_INTERVAL_SECONDS", 60, 1, 3600) * 1000,
    logLevel,
  };
}
