import type { PostView } from './data.ts';

/** People reached by a post: views where the platform reports them, otherwise those who engaged. */
export function peopleOf(p: PostView) {
  const engaged = p.likes + p.comments + p.shares;
  return { viewers: Math.max((p.views ?? 0) - engaged, 0), engaged };
}

export function reachOf(posts: PostView[]): number {
  return posts.reduce((s, p) => {
    const x = peopleOf(p);
    return s + x.viewers + x.engaged;
  }, 0);
}
