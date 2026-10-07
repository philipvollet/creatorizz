import { addAccountSnapshot, db, tx, type Account } from '../db.ts';
import { refreshAvatar } from '../avatars.ts';

// Free: GitHub's GraphQL and REST APIs with a personal token.
const API = 'https://api.github.com';

/**
 * One GraphQL request: profile, repos, the contribution calendar with typed per-day
 * contributions (commits, PRs, reviews, issues), and lifetime totals for discussion replies
 * and accepted answers. Closes and comments come from the events feed.
 */
function query(login: string): string {
  const q = (s: string) => JSON.stringify(s);
  return `query {
  user(login: ${q(login)}) {
    name avatarUrl
    followers { totalCount }
    following { totalCount }
    pullRequests { totalCount }
    mergedPullRequests: pullRequests(states: MERGED) { totalCount }
    issues { totalCount }
    repositoryDiscussions { totalCount }
    repositoryDiscussionComments { totalCount }
    answers: repositoryDiscussionComments(onlyAnswers: true) { totalCount }
    repositories(ownerAffiliations: OWNER, isFork: false, first: 100, orderBy: { field: STARGAZERS, direction: DESC }) {
      totalCount
      nodes { name stargazerCount forkCount }
    }
    contributionsCollection {
      totalCommitContributions totalPullRequestContributions
      totalIssueContributions totalPullRequestReviewContributions
      contributionCalendar { totalContributions weeks { contributionDays { date contributionCount } } }
      commitContributionsByRepository(maxRepositories: 100) {
        contributions(first: 100, orderBy: { field: OCCURRED_AT, direction: DESC }) { nodes { occurredAt commitCount } }
      }
      pullRequestContributions(first: 100, orderBy: { direction: DESC }) { nodes { occurredAt pullRequest { mergedAt } } }
      pullRequestReviewContributions(first: 100, orderBy: { direction: DESC }) { nodes { occurredAt } }
      issueContributions(first: 100, orderBy: { direction: DESC }) { nodes { occurredAt } }
    }
  }
}`;
}

async function gh(path: string, init?: RequestInit) {
  const token = process.env.GITHUB_TOKEN;
  if (!token) throw new Error('GITHUB_TOKEN is not set');
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: { Authorization: `bearer ${token}`, 'Content-Type': 'application/json', 'User-Agent': 'creatorizz', ...init?.headers },
  });
  const body = await res.json();
  if (!res.ok || body.errors) throw new Error(`github ${path}: ${res.status} ${JSON.stringify(body.errors ?? body).slice(0, 300)}`);
  return body;
}

/** Everything for one account. Returns the raw responses for storage. */
export async function fetchUser(account: Account) {
  const graph = await gh('/graphql', { method: 'POST', body: JSON.stringify({ query: query(account.handle) }) });
  // Authenticated as the same user, this feed includes private events too.
  const events: any[] = [];
  for (let page = 1; page <= 3; page++) {
    const batch = await gh(`/users/${account.handle}/events?per_page=100&page=${page}`);
    events.push(...batch);
    if (batch.length < 100) break;
  }
  return { graph, events };
}

function eventRow(e: any) {
  const p = e.payload ?? {};
  const item = p.pull_request ?? p.issue ?? p.discussion ?? null;
  return {
    id: String(e.id),
    type: String(e.type),
    action: p.action ?? (e.type === 'PullRequestEvent' && p.pull_request?.merged ? 'merged' : null),
    repo: e.repo?.name ?? null,
    title: item?.title ?? p.release?.name ?? null,
    url: p.comment?.html_url ?? p.review?.html_url ?? item?.html_url ?? null,
    createdAt: e.created_at,
  };
}

/** Typed per-day counts from the contribution nodes. Merges are dated by when they merged. */
function activityByDay(cc: any): Record<string, Map<string, number>> {
  const out: Record<string, Map<string, number>> = {
    commits: new Map(), prs_opened: new Map(), prs_merged: new Map(), reviews: new Map(), issues_opened: new Map(),
  };
  const add = (kind: string, at: string | null | undefined, n = 1) => {
    if (!at) return;
    const d = at.slice(0, 10);
    out[kind].set(d, (out[kind].get(d) ?? 0) + n);
  };
  for (const repo of cc.commitContributionsByRepository ?? []) for (const c of repo.contributions.nodes) add('commits', c.occurredAt, c.commitCount);
  for (const c of cc.pullRequestContributions?.nodes ?? []) {
    add('prs_opened', c.occurredAt);
    add('prs_merged', c.pullRequest?.mergedAt);
  }
  for (const c of cc.pullRequestReviewContributions?.nodes ?? []) add('reviews', c.occurredAt);
  for (const c of cc.issueContributions?.nodes ?? []) add('issues_opened', c.occurredAt);
  return out;
}

export async function ingestUser(account: Account, body: { graph: any; events: any[] }, takenAt: string) {
  const d = body.graph.data;
  const u = d.user;
  const cc = u.contributionsCollection;
  const repos = u.repositories.nodes as { name: string; stargazerCount: number; forkCount: number }[];
  const days = cc.contributionCalendar.weeks.flatMap((w: any) => w.contributionDays) as { date: string; contributionCount: number }[];

  tx(() => {
    addAccountSnapshot(account.id, takenAt, {
      followers: u.followers.totalCount,
      following: u.following.totalCount,
      postsCount: u.repositories.totalCount,
      extra: {
        stars: repos.reduce((s, r) => s + r.stargazerCount, 0),
        forks: repos.reduce((s, r) => s + r.forkCount, 0),
        topRepos: repos.slice(0, 5).map((r) => ({ name: r.name, stars: r.stargazerCount })),
        yearContributions: cc.contributionCalendar.totalContributions,
        // Lifetime counters. Their day-to-day change is activity too, kept beyond any API window.
        totals: {
          prs: u.pullRequests.totalCount,
          prsMerged: u.mergedPullRequests.totalCount,
          issues: u.issues.totalCount,
          discussions: u.repositoryDiscussions.totalCount,
          discussionComments: u.repositoryDiscussionComments.totalCount,
          answers: u.answers.totalCount,
        },
      },
    });
    const up = db.prepare(
      'INSERT INTO github_day (account_id, day, contributions) VALUES (?, ?, ?) ON CONFLICT (account_id, day) DO UPDATE SET contributions = excluded.contributions',
    );
    for (const x of days) up.run(account.id, x.date, x.contributionCount);
    const act = db.prepare(
      'INSERT INTO github_activity_day (account_id, day, kind, n) VALUES (?, ?, ?, ?) ON CONFLICT (account_id, day, kind) DO UPDATE SET n = excluded.n',
    );
    for (const [kind, byDay] of Object.entries(activityByDay(cc))) {
      for (const [d, n] of byDay) act.run(account.id, d, kind, n);
    }
    const ev = db.prepare(
      'INSERT OR IGNORE INTO github_event (id, account_id, type, action, repo, title, url, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    );
    for (const e of body.events) {
      const r = eventRow(e);
      ev.run(r.id, account.id, r.type, r.action, r.repo, r.title, r.url, r.createdAt);
    }
  });
  await refreshAvatar(account, u.avatarUrl, u.name);
  return days.length + body.events.length;
}

// ---------- repositories (handle "owner/name") ----------

export const isRepo = (account: Account) => account.handle.includes('/');

const REPO_QUERY = `query ($owner: String!, $name: String!) {
  repository(owner: $owner, name: $name) {
    nameWithOwner stargazerCount forkCount
    owner { login avatarUrl }
    watchers { totalCount }
    openIssues: issues(states: OPEN) { totalCount }
    closedIssues: issues(states: CLOSED) { totalCount }
    openPRs: pullRequests(states: OPEN) { totalCount }
    mergedPRs: pullRequests(states: MERGED) { totalCount }
    closedPRs: pullRequests(states: CLOSED) { totalCount }
    discussions { totalCount }
    latestRelease { tagName publishedAt }
    stargazers(last: 100, orderBy: { field: STARRED_AT, direction: ASC }) { edges { starredAt } }
  }
}`;

export async function fetchRepo(account: Account) {
  const [owner, name] = account.handle.split('/');
  const graph = await gh('/graphql', { method: 'POST', body: JSON.stringify({ query: REPO_QUERY, variables: { owner, name } }) });
  return { graph };
}

/** Repository totals; their change between two readings is the activity of that day. */
export async function ingestRepo(account: Account, body: { graph: any }, takenAt: string) {
  const r = body.graph.data.repository;
  const totals = {
    stars: r.stargazerCount,
    forks: r.forkCount,
    watchers: r.watchers.totalCount,
    issuesOpen: r.openIssues.totalCount,
    issuesClosed: r.closedIssues.totalCount,
    prsOpen: r.openPRs.totalCount,
    prsMerged: r.mergedPRs.totalCount,
    prsClosed: r.closedPRs.totalCount,
    discussions: r.discussions.totalCount,
  };
  // Stars per day from the newest 100 star timestamps. The earliest day in that batch may be
  // cut off, so it is left out rather than under-counted.
  const starDays = new Map<string, number>();
  for (const e of r.stargazers.edges as { starredAt: string }[]) {
    const d = e.starredAt.slice(0, 10);
    starDays.set(d, (starDays.get(d) ?? 0) + 1);
  }
  const first = [...starDays.keys()].sort()[0];
  if (r.stargazers.edges.length === 100 && first) starDays.delete(first);

  tx(() => {
    const prev = db
      .prepare('SELECT extra FROM account_snapshot WHERE account_id = ? AND extra IS NOT NULL ORDER BY taken_at DESC LIMIT 1')
      .get(account.id) as { extra: string } | undefined;
    const before = prev ? JSON.parse(prev.extra)?.totals : null;
    addAccountSnapshot(account.id, takenAt, {
      postsCount: null,
      extra: { repo: r.nameWithOwner, totals, release: r.latestRelease ?? null },
    });
    const up = db.prepare(
      'INSERT INTO github_repo_day (account_id, day, kind, n) VALUES (?, ?, ?, ?) ON CONFLICT (account_id, day, kind) DO UPDATE SET n = excluded.n',
    );
    for (const [d, n] of starDays) up.run(account.id, d, 'stars', n);
    if (before) {
      // Totals only ever say how much changed since the last reading; that lands on today.
      const day = takenAt.slice(0, 10);
      const add = db.prepare(
        'INSERT INTO github_repo_day (account_id, day, kind, n) VALUES (?, ?, ?, ?) ON CONFLICT (account_id, day, kind) DO UPDATE SET n = n + excluded.n',
      );
      const delta = {
        issues_opened: totals.issuesOpen + totals.issuesClosed - (before.issuesOpen + before.issuesClosed),
        issues_closed: totals.issuesClosed - before.issuesClosed,
        prs_opened: totals.prsOpen + totals.prsMerged + totals.prsClosed - (before.prsOpen + before.prsMerged + (before.prsClosed ?? 0)),
        prs_merged: totals.prsMerged - before.prsMerged,
        discussions: totals.discussions - before.discussions,
        forks: totals.forks - before.forks,
      };
      for (const [kind, n] of Object.entries(delta)) if (n > 0) add.run(account.id, day, kind, n);
    }
  });
  await refreshAvatar(account, r.owner.avatarUrl, r.nameWithOwner);
  return starDays.size + 1;
}
