/**
 * octosprout-server: inbox API (§15.2), web UI and JSON API, auth (§18.2),
 * proposals and approvals (§9) and the Git write service (§8).
 *
 * Built so far: the Git write service. The inbox API builds on it next (§21, Phase 1).
 */
export * from "./git/exec.js";
export * from "./git/lock.js";
export * from "./git/write-service.js";
