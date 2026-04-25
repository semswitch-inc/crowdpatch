// Octokit wrapper for the operations CrowdPatch needs:
//   - branchExists: precondition check before opening a PR
//   - openPr:       opens the fix PR after the agent pushes its branch
//
// We deliberately keep this thin — no retries, no caching, no magic. If a
// caller needs more, build it on top.

import { Octokit } from "@octokit/core";

interface OpenPrParams {
  owner: string;
  repo: string;
  head: string;
  base: string;
  title: string;
  body: string;
}

interface OpenPrResult {
  number: number;
  url: string;
  html_url: string;
}

export class GitHubClient {
  private readonly octokit: Octokit;

  constructor(token: string) {
    this.octokit = new Octokit({ auth: token });
  }

  async branchExists(
    owner: string,
    repo: string,
    branch: string,
  ): Promise<boolean> {
    try {
      await this.octokit.request(
        "GET /repos/{owner}/{repo}/branches/{branch}",
        { owner, repo, branch },
      );
      return true;
    } catch (err) {
      if (isNotFound(err)) return false;
      throw err;
    }
  }

  async openPr(params: OpenPrParams): Promise<OpenPrResult> {
    const response = await this.octokit.request(
      "POST /repos/{owner}/{repo}/pulls",
      {
        owner: params.owner,
        repo: params.repo,
        head: params.head,
        base: params.base,
        title: params.title,
        body: params.body,
      },
    );

    return {
      number: response.data.number,
      url: response.data.url,
      html_url: response.data.html_url,
    };
  }

  async getBranchHeadSha(
    owner: string,
    repo: string,
    branch: string,
  ): Promise<string> {
    const response = await this.octokit.request(
      "GET /repos/{owner}/{repo}/branches/{branch}",
      { owner, repo, branch },
    );
    return (response.data as { commit: { sha: string } }).commit.sha;
  }
}

// @octokit/core throws RequestError objects with a numeric .status. We check
// structurally instead of importing RequestError to avoid the extra dep.
function isNotFound(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "status" in err &&
    err.status === 404
  );
}

// Parse owner + repo from a github_repo_url like "https://github.com/owner/repo"
// or "https://github.com/owner/repo.git" (with optional trailing slash).
// Returns null on malformed input. Rejects query strings, hash fragments,
// and whitespace anywhere in the owner/repo segments — none of those are
// valid for `git clone` and the agent path would fail downstream anyway.
export function parseRepoUrl(
  url: string,
): { owner: string; repo: string } | null {
  const match =
    /^https:\/\/github\.com\/([^/?#\s]+)\/([^/?#\s]+?)(?:\.git)?\/?$/.exec(url);
  if (!match) return null;
  const owner = match[1];
  const repo = match[2];
  if (!owner || !repo) return null;
  return { owner, repo };
}
