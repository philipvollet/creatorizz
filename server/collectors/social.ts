// Instagram, TikTok and YouTube: one Apify run per account returns the profile (followers)
// and its latest posts with their numbers, so each is a single "sweep" like X.
// Prices read off the public actor objects on 2026-10-06.
import { addAccountSnapshot, tx, type Account } from '../db.ts';
import { expireOld, recordPost, scrapeWindow, type ScrapedPost } from '../posts.ts';
import { refreshAvatar } from '../avatars.ts';
import { accountOptions } from '../config.ts';

export interface Sweep {
  actor: string;
  input: (account: Account) => { input: unknown; maxCharge: number };
  ingest: (account: Account, items: any[], takenAt: string) => Promise<number>;
}

async function ingestWith(
  account: Account,
  takenAt: string,
  profile: { followers: number | null; following?: number | null; postsCount?: number | null; avatar?: string | null; name?: string | null; extra?: unknown } | null,
  posts: ScrapedPost[],
) {
  tx(() => {
    if (profile) {
      addAccountSnapshot(account.id, takenAt, {
        followers: profile.followers,
        following: profile.following ?? null,
        postsCount: profile.postsCount ?? null,
        extra: profile.extra,
      });
    }
    for (const p of posts) recordPost(account.id, p, takenAt);
    expireOld(account.id, takenAt);
  });
  if (profile) await refreshAvatar(account, profile.avatar, profile.name);
  return posts.length;
}

/** apify~instagram-profile-scraper: $0.0026 per profile, which carries the latest 12 posts. */
export const instagram: Sweep = {
  actor: 'apify~instagram-profile-scraper',
  input: (account) => ({ input: { usernames: [account.handle] }, maxCharge: 0.01 }),
  ingest: async (account, items, takenAt) => {
    const p = items.find((i) => i.username?.toLowerCase() === account.handle.toLowerCase());
    if (!p) throw new Error('instagram: profile not in result');
    const posts: ScrapedPost[] = (p.latestPosts ?? [])
      .filter((x: any) => x.id && x.timestamp)
      .map((x: any) => ({
        platformPostId: String(x.shortCode ?? x.id),
        url: x.url ?? null,
        postedAt: new Date(x.timestamp).toISOString(),
        kind: x.type === 'Video' ? 'video' : 'post',
        text: x.caption ?? null,
        media: x.displayUrl ? [{ type: x.type === 'Video' ? 'video' : 'image', url: x.displayUrl }] : undefined,
        metrics: { likes: Math.max(x.likesCount ?? 0, 0), comments: x.commentsCount ?? 0, shares: 0, views: x.videoViewCount ?? null },
      }));
    return ingestWith(
      account,
      takenAt,
      { followers: p.followersCount ?? null, following: p.followsCount ?? null, postsCount: p.postsCount ?? null, avatar: p.profilePicUrlHD ?? p.profilePicUrl, name: p.fullName },
      posts,
    );
  },
};

/** clockworks~tiktok-profile-scraper: $0.003 per video; every video carries the author's follower count. */
export const tiktok: Sweep = {
  actor: 'clockworks~tiktok-profile-scraper',
  input: (account) => {
    const n = scrapeWindow(account.id);
    return {
      input: { profiles: [account.handle], resultsPerPage: n, profileSorting: 'latest', excludePinnedPosts: true },
      maxCharge: +(n * 0.003 + 0.01).toFixed(4),
    };
  },
  ingest: async (account, items, takenAt) => {
    const own = items.filter((v) => v.authorMeta?.name?.toLowerCase() === account.handle.toLowerCase());
    const a = own[0]?.authorMeta;
    const posts: ScrapedPost[] = own
      .filter((v) => v.id && v.createTimeISO)
      .map((v) => ({
        platformPostId: String(v.id),
        url: v.webVideoUrl ?? null,
        postedAt: new Date(v.createTimeISO).toISOString(),
        kind: 'video',
        text: v.text ?? null,
        media: (v.videoMeta?.coverUrl ?? v.videoMeta?.originalCoverUrl) ? [{ type: 'video', url: v.videoMeta.coverUrl ?? v.videoMeta.originalCoverUrl }] : undefined,
        metrics: { likes: v.diggCount ?? 0, comments: v.commentCount ?? 0, shares: v.shareCount ?? 0, views: v.playCount ?? null, bookmarks: v.collectCount ?? null },
      }));
    return ingestWith(
      account,
      takenAt,
      a ? { followers: a.fans ?? null, following: a.following ?? null, postsCount: a.video ?? null, avatar: a.originalAvatarUrl ?? a.avatar, name: a.nickName, extra: { hearts: a.heart ?? null } } : null,
      posts,
    );
  },
};

/** streamers~youtube-scraper: $0.004 per video, with exact dates, views, likes and comments. */
export const youtube: Sweep = {
  actor: 'streamers~youtube-scraper',
  input: (account) => {
    const n = scrapeWindow(account.id);
    const base = account.url.replace(/\/(videos|shorts|streams)?\/?$/, '');
    return {
      input: { startUrls: [{ url: `${base}/videos` }], maxResults: n, maxResultsShorts: 0, maxResultStreams: 0 },
      maxCharge: +(n * 0.004 + 0.01).toFixed(4),
    };
  },
  ingest: async (account, items, takenAt) => {
    const videos = items.filter((v) => v.id && v.date && v.type !== 'shorts');
    const c = items[0];
    const posts: ScrapedPost[] = videos.map((v) => ({
      platformPostId: String(v.id),
      url: v.url ?? null,
      postedAt: new Date(v.date).toISOString(),
      kind: 'video',
      text: v.title ?? null,
      media: v.thumbnailUrl ? [{ type: 'image', url: v.thumbnailUrl }] : undefined,
      metrics: { likes: v.likes ?? 0, comments: v.commentsCount ?? 0, shares: 0, views: v.viewCount ?? null },
    }));
    return ingestWith(
      account,
      takenAt,
      c
        ? {
            followers: c.numberOfSubscribers ?? null,
            postsCount: c.channelTotalVideos ?? null,
            // The listed avatar is 68px; ask for a larger rendition.
            avatar: c.channelAvatarUrl?.replace(/=s\d+-/, '=s400-'),
            name: c.channelName,
            extra: { totalViews: c.channelTotalViews ?? null },
          }
        : null,
      posts,
    );
  },
};

/**
 * clearpath~reddit-subreddit-posts-scraper: $0.002 per post, $0.0005 per start. A subreddit is
 * a community: its "followers" are its members, and its posts are mostly other people's. Only
 * posts by the usernames in the account's `authors` (config.json) are kept; with none listed,
 * the sweep reads a single post, just for the member count it carries.
 * Reddit's own JSON API refuses unauthenticated reads, hence the actor.
 */
export const reddit: Sweep = {
  actor: 'clearpath~reddit-subreddit-posts-scraper',
  input: (account) => {
    const n = accountOptions('reddit', account.handle).authors.length ? Math.min(scrapeWindow(account.id), 12) : 1;
    return { input: { subreddit: account.handle, maxPostsPerSubreddit: n, sort: 'new' }, maxCharge: +(n * 0.002 + 0.01).toFixed(4) };
  },
  ingest: async (account, items, takenAt) => {
    const own = items.filter((p) => p.subreddit?.toLowerCase() === account.handle.toLowerCase());
    const authors = new Set(accountOptions('reddit', account.handle).authors);
    const posts: ScrapedPost[] = own
      .filter((p) => authors.has(String(p.author ?? '').toLowerCase()))
      .filter((p) => p.id && (p.created_utc || p.createdAt))
      .map((p) => ({
        platformPostId: String(p.id),
        url: p.permalink ? `https://www.reddit.com${p.permalink}` : (p.url ?? null),
        postedAt: p.created_utc ? new Date(p.created_utc * 1000).toISOString() : new Date(p.createdAt).toISOString(),
        kind: 'community',
        text: p.title ?? null,
        media: typeof p.thumbnail === 'string' && p.thumbnail.startsWith('http') ? [{ type: 'image', url: p.thumbnail }] : undefined,
        metrics: { likes: Math.max(p.score ?? 0, 0), comments: p.num_comments ?? 0, shares: p.num_crossposts ?? 0, views: p.view_count ?? null },
      }));
    const members = own[0]?.subreddit_subscribers ?? null;
    return ingestWith(account, takenAt, members !== null ? { followers: members, name: `r/${account.handle}` } : null, posts);
  },
};

export const SWEEPS = { instagram, tiktok, youtube, reddit } as const;
