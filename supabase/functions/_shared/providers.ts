// Shared provider-metric fetchers for the "bet on yourself" feature.
//
// Pure HTTP only — no DB access. Each provider returns a number that the
// self-bet edge function compares against the bet's baseline/target.
//
// Metric model (uniform across providers):
//   measureMetric(...) returns a value such that  final - baseline >= target.
//   - github / strava measure activity strictly *within* the bet window, so
//     they take `sinceISO` (= the bet's period_start). Baseline at open time is
//     therefore ~0 and the delta is the in-window count.
//   - chesscom / leetcode return a *lifetime cumulative* count, so the delta
//     between settle and open naturally equals the in-window activity.

export type Provider = 'github' | 'strava' | 'chesscom' | 'leetcode';
export type Metric = 'commits' | 'runs' | 'wins' | 'solves';

export const METRIC_FOR: Record<Provider, Metric> = {
  github: 'commits',
  strava: 'runs',
  chesscom: 'wins',
  leetcode: 'solves',
};

const UA = 'ScrollTax/1.0 (self-bet verifier)';

// ─── GitHub ──────────────────────────────────────────────────────────────────
// Uses the authenticated viewer's contributionsCollection so no username is
// needed and private contributions the user can see are included. Counts commits
// authored in [sinceISO, now].
export async function githubCommitsInWindow(token: string, sinceISO: string): Promise<number> {
  const query = `
    query($from: DateTime!, $to: DateTime!) {
      viewer {
        contributionsCollection(from: $from, to: $to) {
          totalCommitContributions
        }
      }
    }`;
  const resp = await fetch('https://api.github.com/graphql', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'User-Agent': UA,
    },
    body: JSON.stringify({ query, variables: { from: sinceISO, to: new Date().toISOString() } }),
  });
  const json = await resp.json();
  // Distinguish a real "0 commits" from an API failure (rate limit, revoked token,
  // GraphQL errors). Returning 0 on failure would silently understate progress.
  if (!resp.ok || json?.errors) {
    throw new Error('github_api_error');
  }
  return json?.data?.viewer?.contributionsCollection?.totalCommitContributions ?? 0;
}

export async function githubLogin(token: string): Promise<string | null> {
  const resp = await fetch('https://api.github.com/user', {
    headers: { Authorization: `Bearer ${token}`, 'User-Agent': UA },
  });
  if (!resp.ok) return null;
  const json = await resp.json();
  return json?.login ?? null;
}

// ─── Strava ──────────────────────────────────────────────────────────────────
export interface StravaTokens {
  access_token: string;
  refresh_token: string;
  expires_at: number; // unix seconds
}

export async function exchangeStravaCode(
  clientId: string, clientSecret: string, code: string,
): Promise<StravaTokens> {
  const resp = await fetch('https://www.strava.com/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      grant_type: 'authorization_code',
    }),
  });
  if (!resp.ok) throw new Error(`strava_exchange_failed_${resp.status}`);
  return await resp.json();
}

export async function refreshStravaToken(
  clientId: string, clientSecret: string, refreshToken: string,
): Promise<StravaTokens> {
  const resp = await fetch('https://www.strava.com/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  });
  if (!resp.ok) throw new Error(`strava_refresh_failed_${resp.status}`);
  return await resp.json();
}

export async function stravaAthlete(token: string): Promise<{ id: number; username: string } | null> {
  const resp = await fetch('https://www.strava.com/api/v3/athlete', {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!resp.ok) return null;
  const a = await resp.json();
  return { id: a?.id, username: a?.username ?? `${a?.firstname ?? ''} ${a?.lastname ?? ''}`.trim() };
}

// Counts Run activities recorded on/after `sinceISO`.
export async function stravaRunsInWindow(token: string, sinceISO: string): Promise<number> {
  const after = Math.floor(new Date(sinceISO).getTime() / 1000);
  let page = 1;
  let runs = 0;
  // Page through up to ~1000 activities (10 pages) — ample for a bet window.
  while (page <= 10) {
    const resp = await fetch(
      `https://www.strava.com/api/v3/athlete/activities?after=${after}&per_page=100&page=${page}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (!resp.ok) break;
    const acts = await resp.json();
    if (!Array.isArray(acts) || acts.length === 0) break;
    runs += acts.filter((a: any) => a?.type === 'Run' || a?.sport_type === 'Run').length;
    if (acts.length < 100) break;
    page += 1;
  }
  return runs;
}

// ─── Chess.com (public, no auth) ─────────────────────────────────────────────
export async function chesscomExists(username: string): Promise<boolean> {
  const resp = await fetch(`https://api.chess.com/pub/player/${encodeURIComponent(username)}`, {
    headers: { 'User-Agent': UA },
  });
  return resp.ok;
}

// Lifetime wins across all time controls.
export async function chesscomTotalWins(username: string): Promise<number> {
  const resp = await fetch(`https://api.chess.com/pub/player/${encodeURIComponent(username)}/stats`, {
    headers: { 'User-Agent': UA },
  });
  if (!resp.ok) return 0;
  const s = await resp.json();
  const buckets = ['chess_rapid', 'chess_blitz', 'chess_bullet', 'chess_daily'];
  return buckets.reduce((sum, b) => sum + (s?.[b]?.record?.win ?? 0), 0);
}

// ─── LeetCode (unofficial public GraphQL) ────────────────────────────────────
async function leetcodeQuery(username: string): Promise<any> {
  const query = `
    query($username: String!) {
      matchedUser(username: $username) {
        username
        submitStatsGlobal { acSubmissionNum { difficulty count } }
      }
    }`;
  const resp = await fetch('https://leetcode.com/graphql', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': UA,
      Referer: 'https://leetcode.com',
    },
    body: JSON.stringify({ query, variables: { username } }),
  });
  if (!resp.ok) return null;
  return await resp.json();
}

export async function leetcodeExists(username: string): Promise<boolean> {
  const json = await leetcodeQuery(username);
  return !!json?.data?.matchedUser;
}

// Lifetime total accepted solutions (difficulty "All").
export async function leetcodeTotalSolved(username: string): Promise<number> {
  const json = await leetcodeQuery(username);
  const nums = json?.data?.matchedUser?.submitStatsGlobal?.acSubmissionNum;
  if (!Array.isArray(nums)) return 0;
  const all = nums.find((n: any) => n.difficulty === 'All');
  return all?.count ?? 0;
}

// ─── Unified measurement ─────────────────────────────────────────────────────
export interface MeasureCtx {
  username?: string | null;
  accessToken?: string | null;
  sinceISO: string; // bet period_start
}

export async function measureMetric(provider: Provider, ctx: MeasureCtx): Promise<number> {
  switch (provider) {
    case 'github':
      if (!ctx.accessToken) throw new Error('github_token_missing');
      return await githubCommitsInWindow(ctx.accessToken, ctx.sinceISO);
    case 'strava':
      if (!ctx.accessToken) throw new Error('strava_token_missing');
      return await stravaRunsInWindow(ctx.accessToken, ctx.sinceISO);
    case 'chesscom':
      if (!ctx.username) throw new Error('chesscom_username_missing');
      return await chesscomTotalWins(ctx.username);
    case 'leetcode':
      if (!ctx.username) throw new Error('leetcode_username_missing');
      return await leetcodeTotalSolved(ctx.username);
  }
}
