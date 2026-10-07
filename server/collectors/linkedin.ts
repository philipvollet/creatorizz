import { addAccountSnapshot, tx, type Account } from '../db.ts';
import { expireOld, recordPost, scrapeWindow, type ScrapedPost } from '../posts.ts';
import { refreshAvatar } from '../avatars.ts';

// Prices read off the public actor objects on 2026-10-06.
export const PROFILE_ACTOR = 'harvestapi~linkedin-profile-scraper'; // $0.004 per profile
export const POSTS_ACTOR = 'harvestapi~linkedin-profile-posts'; // $0.002 per post, $0.00005 per start
// Company pages, same vendor: $0.004 per company, $0.002 per post.
export const COMPANY_ACTOR = 'harvestapi~linkedin-company';
export const COMPANY_POSTS_ACTOR = 'harvestapi~linkedin-company-posts';
const PER_POST_USD = 0.002;

/** Company pages live under /company/; people under /in/. */
export const isCompany = (account: Account) => account.url.includes('/company/');

export function profileActor(account: Account) {
  return isCompany(account) ? COMPANY_ACTOR : PROFILE_ACTOR;
}

export function profileInput(account: Account) {
  const url = account.url.replace(/\/posts\/.*$/, '/');
  return isCompany(account)
    ? { companies: [url] }
    : { profileScraperMode: 'Profile details no email ($4 per 1k)', queries: [account.url] };
}

export const profileMaxCharge = 0.01;

export async function ingestProfile(account: Account, items: any[], takenAt: string) {
  const p = items[0];
  if (!p) throw new Error('linkedin profile: empty result');
  if (isCompany(account)) {
    addAccountSnapshot(account.id, takenAt, {
      followers: p.followerCount ?? null,
      extra: { employees: p.employeeCount ?? null, tagline: p.tagline ?? null },
    });
    await refreshAvatar(account, p.logo, p.name);
    return 1;
  }
  addAccountSnapshot(account.id, takenAt, {
    followers: p.followerCount ?? null,
    extra: { connections: p.connectionsCount ?? null, headline: p.headline ?? null },
  });
  const pic = p.profilePicture?.sizes?.find((s: any) => s.width === 400)?.url ?? p.profilePicture?.url ?? p.photo;
  await refreshAvatar(account, pic, [p.firstName, p.lastName].filter(Boolean).join(' '));
  return 1;
}

export function postsInput(account: Account) {
  const maxPosts = scrapeWindow(account.id);
  return {
    actor: isCompany(account) ? COMPANY_POSTS_ACTOR : POSTS_ACTOR,
    input: { targetUrls: [account.url.replace(/\/posts\/.*$/, '/')], maxPosts, postedLimit: 'month', includeReposts: false, includeQuotePosts: true },
    maxCharge: +(maxPosts * PER_POST_USD + 0.005).toFixed(4),
  };
}

export function parsePost(item: any): ScrapedPost | null {
  const id = item.entityId ?? item.id;
  const date = item.postedAt?.date;
  if (!id || !date) return null;
  const e = item.engagement ?? {};
  const media = [
    ...(item.postImages ?? []).map((i: any) => ({ type: 'image', url: i.url })),
    ...(item.postVideo?.thumbnailUrl ? [{ type: 'video', url: item.postVideo.thumbnailUrl }] : []),
  ];
  return {
    platformPostId: String(id),
    url: item.linkedinUrl ?? item.shareLinkedinUrl ?? null,
    postedAt: new Date(date).toISOString(),
    kind: item.repostedBy ? 'repost' : 'post',
    text: item.content ?? null,
    media: media.length ? media : undefined,
    metrics: {
      likes: Number(e.likes ?? 0),
      comments: Number(e.comments ?? 0),
      shares: Number(e.shares ?? 0),
      extra: e.reactions?.length ? { reactions: e.reactions } : undefined,
    },
  };
}

export function ingestPosts(account: Account, items: any[], takenAt: string) {
  let n = 0;
  tx(() => {
    for (const item of items) {
      // Keep only the account's own posts (a company feed names the company as author).
      const author = item.author?.publicIdentifier ?? item.author?.universalName;
      if (author && author !== account.handle) continue;
      const p = parsePost(item);
      if (!p) continue;
      recordPost(account.id, p, takenAt);
      n++;
    }
    expireOld(account.id, takenAt);
  });
  return n;
}
