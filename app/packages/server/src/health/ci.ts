/**
 * The private repository's last CI run (spec §12.2 Health), read from the
 * GitHub Actions API with an optional fine-grained token that can read
 * Actions on that repository only. Cached for a minute.
 */

export interface CiRun {
  status: string;
  /** `success`, `failure`, … once completed. */
  conclusion: string | null;
  url: string;
  sha: string;
  created: string;
  title: string;
}

export type CiState =
  | { kind: "not_configured"; reason: string }
  | { kind: "ok"; run: CiRun | null }
  | { kind: "error"; message: string };

/** `owner/repo` from a GitHub remote URL (SSH or HTTPS), if it is one. */
export function githubRepo(remoteUrl: string | undefined): string | undefined {
  if (!remoteUrl) return undefined;
  const match = /^(?:git@github\.com:|ssh:\/\/git@github\.com\/|https:\/\/github\.com\/)([^/\s]+\/[^/\s]+?)(?:\.git)?\/?$/.exec(remoteUrl);
  return match?.[1];
}

export interface CiOptions {
  token?: string;
  repo?: string;
  branch?: string;
  fetch?: typeof fetch;
  now?: () => number;
  cacheMs?: number;
}

export class CiStatus {
  readonly #options: CiOptions;
  #cached: { at: number; state: CiState } | undefined;

  constructor(options: CiOptions) {
    this.#options = options;
  }

  async state(): Promise<CiState> {
    const { token, repo } = this.#options;
    if (!token) return { kind: "not_configured", reason: "No GitHub token is configured (OCTOSPROUT_GITHUB_TOKEN_FILE)." };
    if (!repo) return { kind: "not_configured", reason: "The workspace remote is not a GitHub repository." };
    const now = (this.#options.now ?? Date.now)();
    if (this.#cached && now - this.#cached.at < (this.#options.cacheMs ?? 60_000)) return this.#cached.state;

    let state: CiState;
    try {
      const url = `https://api.github.com/repos/${repo}/actions/runs?branch=${encodeURIComponent(this.#options.branch ?? "main")}&per_page=1`;
      const response = await (this.#options.fetch ?? fetch)(url, {
        headers: { accept: "application/vnd.github+json", authorization: `Bearer ${token}`, "x-github-api-version": "2022-11-28", "user-agent": "octosprout-server" },
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) {
        state = { kind: "error", message: `GitHub answered ${response.status}.` };
      } else {
        const data = (await response.json()) as { workflow_runs?: Array<Record<string, unknown>> };
        const run = data.workflow_runs?.[0];
        state = {
          kind: "ok",
          run: run
            ? {
                status: String(run.status),
                conclusion: typeof run.conclusion === "string" ? run.conclusion : null,
                url: String(run.html_url),
                sha: String(run.head_sha),
                created: String(run.created_at),
                title: String(run.display_title ?? run.name ?? ""),
              }
            : null,
        };
      }
    } catch (error) {
      state = { kind: "error", message: (error as Error).message };
    }
    this.#cached = { at: now, state };
    return state;
  }
}
