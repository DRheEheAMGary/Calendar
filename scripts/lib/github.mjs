/**
 * github.mjs — the smallest useful wrapper around the GitHub REST API.
 *
 * Uses Node's built-in fetch, so the project keeps zero dependencies. Every
 * call is explicit about its method and body, and failures surface the response
 * body because GitHub puts the real reason there.
 */

export class GitHubApiError extends Error {
  constructor(message, status, body) {
    super(message);
    this.name = 'GitHubApiError';
    this.status = status;
    this.body = body;
  }
}

export function createGitHubClient({ token, repository, apiBase = 'https://api.github.com', fetchImpl = fetch }) {
  if (!token) throw new Error('A GitHub token is required (set GH_TOKEN or GITHUB_TOKEN).');
  if (!repository || !repository.includes('/')) {
    throw new Error(`GITHUB_REPOSITORY must look like "owner/name", received: ${JSON.stringify(repository)}`);
  }

  const [owner, repo] = repository.split('/');
  const base = `${apiBase.replace(/\/$/, '')}/repos/${owner}/${repo}`;
  const isAbsolute = /^https?:\/\//i.test(apiBase);

  async function request(pathname, { method = 'GET', body, query } = {}) {
    // `apiBase` may be a full origin (tests) or a bare path prefix (a GitHub
    // Enterprise proxy mounted under a path).
    const url = new URL(`${base}${pathname}`, isAbsolute ? undefined : 'https://api.github.com');
    for (const [key, value] of Object.entries(query ?? {})) {
      if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
    }

    const response = await fetchImpl(url, {
      method,
      headers: {
        accept: 'application/vnd.github+json',
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        'user-agent': 'calendar-reminder-action',
        'x-github-api-version': '2022-11-28',
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

    const text = await response.text();
    let payload = null;
    if (text !== '') {
      try {
        payload = JSON.parse(text);
      } catch {
        payload = text;
      }
    }

    if (!response.ok) {
      const detail = payload && typeof payload === 'object' ? payload.message : payload;
      throw new GitHubApiError(
        `${method} ${pathname} failed with ${response.status}${detail ? `: ${detail}` : ''}`,
        response.status,
        payload,
      );
    }

    return { payload, headers: response.headers };
  }

  return {
    owner,
    repo,

    /** All issues with the given label, oldest first. Excludes pull requests. */
    async listIssuesByLabel(label) {
      const issues = [];
      for (let page = 1; page <= 3; page += 1) {
        const { payload } = await request('/issues', {
          query: { state: 'all', labels: label, per_page: 100, page },
        });
        const pageIssues = payload.filter((issue) => !issue.pull_request);
        issues.push(...pageIssues);
        if (payload.length < 100) break;
      }
      return issues;
    },

    createIssue: ({ title, body, labels }) =>
      request('/issues', { method: 'POST', body: { title, body, labels } }).then((result) => result.payload),

    updateIssue: (number, { title, body }) =>
      request(`/issues/${number}`, { method: 'PATCH', body: { title, body } }).then((result) => result.payload),

    addComment: (number, body) =>
      request(`/issues/${number}/comments`, { method: 'POST', body: { body } }).then((result) => result.payload),

    closeIssue: (number) =>
      request(`/issues/${number}`, { method: 'PATCH', body: { state: 'closed', state_reason: 'completed' } }).then(
        (result) => result.payload,
      ),

    reopenIssue: (number) =>
      request(`/issues/${number}`, { method: 'PATCH', body: { state: 'open' } }).then((result) => result.payload),
  };
}
