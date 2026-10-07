import { addAccountSnapshot, tx, type Account } from '../db.ts';
import { expireOld, recordPost, scrapeWindow, type ScrapedPost } from '../posts.ts';
import { refreshAvatar } from '../avatars.ts';

// $0.0004 per returned tweet, read off the public actor object on 2026-10-06. Every tweet
// carries its author object, so the follower count comes free with the timeline.
export const ACTOR = 'apidojo~tweet-scraper';
const PER_ITEM_USD = 0.0004;

export function sweepInput(account: Account) {
  // Retweets take slots in the timeline too, so read a few more than the window.
  const maxItems = Math.max(15, scrapeWindow(account.id, 8));
  return {
    input: { twitterHandles: [account.handle], maxItems, sort: 'Latest' },
    maxCharge: +(maxItems * PER_ITEM_USD + 0.01).toFixed(4),
  };
}

export function parseTweet(t: any): ScrapedPost | null {
  if (!t.id || !t.createdAt || t.isRetweet) return null;
  const media = (t.extendedEntities?.media ?? t.media ?? [])
    .map((m: any) => (typeof m === 'string' ? { type: 'image', url: m } : { type: m.type, url: m.media_url_https }))
    .filter((m: any) => m.url);
  return {
    platformPostId: String(t.id),
    url: t.url ?? t.twitterUrl ?? null,
    postedAt: new Date(t.createdAt).toISOString(),
    kind: t.isReply ? 'reply' : t.isQuote ? 'quote' : 'post',
    text: t.fullText ?? t.text ?? null,
    media: media.length ? media : undefined,
    metrics: {
      likes: t.likeCount ?? 0,
      comments: t.replyCount ?? 0,
      shares: (t.retweetCount ?? 0) + (t.quoteCount ?? 0),
      views: t.viewCount ?? null,
      bookmarks: t.bookmarkCount ?? null,
    },
  };
}

export async function ingestSweep(account: Account, items: any[], takenAt: string) {
  const own = items.filter((t) => t.author?.userName?.toLowerCase() === account.handle.toLowerCase());
  const author = own[0]?.author;
  let n = 0;
  tx(() => {
    if (author) {
      addAccountSnapshot(account.id, takenAt, {
        followers: author.followers ?? null,
        following: author.following ?? null,
        postsCount: author.statusesCount ?? null,
        extra: { media: author.mediaCount ?? null, likesGiven: author.favouritesCount ?? null },
      });
    }
    for (const t of own) {
      const p = parseTweet(t);
      if (!p) continue;
      recordPost(account.id, p, takenAt);
      n++;
    }
    expireOld(account.id, takenAt);
  });
  if (author) await refreshAvatar(account, author.profilePicture?.replace('_normal', '_400x400'), author.name);
  return n;
}
