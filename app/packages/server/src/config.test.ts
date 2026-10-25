import { describe, expect, it } from "vitest";

import { ConfigError, loadConfig } from "./config.js";

describe("loadConfig", () => {
  it("has working defaults", () => {
    expect(loadConfig({})).toEqual({
      repoDir: "/var/lib/octosprout/repo",
      stateDir: "/var/lib/octosprout/state",
      host: "0.0.0.0",
      port: 8080,
      trustProxy: false,
      syncIntervalMs: 60_000,
      logLevel: "info",
    });
  });

  it("reads every setting", () => {
    expect(
      loadConfig({
        OCTOSPROUT_REPO_DIR: "/r",
        OCTOSPROUT_STATE_DIR: "/s",
        OCTOSPROUT_HOST: "127.0.0.1",
        OCTOSPROUT_PORT: "9000",
        OCTOSPROUT_REMOTE_URL: "git@github.com:bfarkas/octosprout-private.git",
        OCTOSPROUT_DEPLOY_KEY_FILE: "/run/secrets/deploy_key",
        OCTOSPROUT_TRUST_PROXY: "172.18.0.0/16, 10.0.0.1",
        OCTOSPROUT_SYNC_INTERVAL_SECONDS: "30",
        OCTOSPROUT_LOG_LEVEL: "debug",
      }),
    ).toEqual({
      repoDir: "/r",
      stateDir: "/s",
      host: "127.0.0.1",
      port: 9000,
      remoteUrl: "git@github.com:bfarkas/octosprout-private.git",
      deployKeyFile: "/run/secrets/deploy_key",
      trustProxy: ["172.18.0.0/16", "10.0.0.1"],
      syncIntervalMs: 30_000,
      logLevel: "debug",
    });
  });

  it.each([
    [{ OCTOSPROUT_PORT: "0" }, /OCTOSPROUT_PORT/],
    [{ OCTOSPROUT_PORT: "http" }, /OCTOSPROUT_PORT/],
    [{ OCTOSPROUT_PORT: "70000" }, /OCTOSPROUT_PORT/],
    [{ OCTOSPROUT_SYNC_INTERVAL_SECONDS: "0" }, /SYNC_INTERVAL/],
    [{ OCTOSPROUT_LOG_LEVEL: "loud" }, /LOG_LEVEL/],
  ])("rejects %j", (env, message) => {
    expect(() => loadConfig(env)).toThrow(ConfigError);
    expect(() => loadConfig(env)).toThrow(message);
  });
});
