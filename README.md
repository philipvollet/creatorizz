# creatorizz

A self-hosted dashboard for how people and companies do on social media and GitHub. It
collects once a day, keeps every reading in a local SQLite file, and shows it all as one
score and a retro 3D city: one tower per post, its look telling how the post did against
the account's usual.

Built to run on an always-on machine (a Mac mini, a small server) and be opened by
everyone on your private network in a browser.

## What it tracks

| Platform | Followers | Posts and engagement | Views | Cost |
|---|---|---|---|---|
| LinkedIn (person or company page) | ✓ | ✓ | via export or browser reader | Apify |
| X | ✓ | ✓ | ✓ | Apify |
| Instagram | ✓ | ✓ (latest 12) | videos | Apify |
| TikTok | ✓ | ✓ | ✓ | Apify |
| YouTube | ✓ (subscribers) | ✓ | ✓ | Apify |
| Reddit (a subreddit) | ✓ (members) | only posts by listed authors | ✓ | Apify |
| GitHub user | ✓ | contributions, PRs, reviews, issues | | free |
| GitHub repository | stars | stars per day, forks, issues, PRs, discussions | | free |

Apify prices are pay-per-result, around $0.002–0.004 per post or profile. A typical person
costs about $0.02–0.03 a day; a hard monthly cap stops spending (see `.env`).

## Requirements

- Node 24 or newer (the server runs TypeScript directly and uses the built-in `node:sqlite`)
- An [Apify](https://apify.com) token for the social platforms
- A GitHub token for GitHub (read access is enough)

## Quick start

```bash
git clone https://github.com/thomashacker/creatorizz.git
cd creatorizz
npm ci
cp .env.example .env           # fill in APIFY_TOKEN and GITHUB_TOKEN
# create config.json (next section)
npm run build                  # the dashboard
npm start                      # http://127.0.0.1:4410
npm run collect                # first collection now, instead of waiting for the daily run
```

## Who is tracked

`config.json` (not in git) lists who to track: people and companies, each with accounts, and
groups to view several together. Every person or company can also be viewed on their own.

```json
{
  "personas": [
    {
      "id": "acme",
      "name": "Acme",
      "kind": "company",
      "accounts": [
        { "platform": "linkedin", "handle": "acme", "url": "https://www.linkedin.com/company/acme/" },
        { "platform": "x", "handle": "acme", "url": "https://x.com/acme" },
        { "platform": "youtube", "handle": "acme", "url": "https://www.youtube.com/@acme" },
        { "platform": "github", "handle": "acme/widget", "url": "https://github.com/acme/widget" },
        { "platform": "reddit", "handle": "acme", "url": "https://www.reddit.com/r/acme/", "authors": ["acme_official"] }
      ]
    },
    {
      "id": "jane",
      "name": "Jane Doe",
      "kind": "person",
      "accounts": [
        { "platform": "linkedin", "handle": "janedoe", "url": "https://www.linkedin.com/in/janedoe/" },
        { "platform": "x", "handle": "janedoe", "url": "https://x.com/janedoe" },
        { "platform": "instagram", "handle": "janedoe", "url": "https://www.instagram.com/janedoe" },
        { "platform": "tiktok", "handle": "janedoe", "url": "https://www.tiktok.com/@janedoe" },
        { "platform": "github", "handle": "janedoe", "url": "https://github.com/janedoe" }
      ]
    }
  ],
  "groups": [
    { "id": "everyone", "name": "Everyone", "members": ["acme", "jane"] },
    { "id": "people", "name": "People", "members": ["jane"] }
  ]
}
```

Rules of thumb:

- `handle` is the account's name on the platform: the part after `/in/` or `/company/` on
  LinkedIn, without `@` elsewhere, `owner/name` for a GitHub repository, the subreddit name for Reddit.
- A LinkedIn `url` under `/company/` is read as a company page, under `/in/` as a person.
- For a subreddit, only posts by the usernames in `authors` are kept; everyone else's are never
  stored. Without `authors`, only the member count is tracked.
- The config is read when the server starts: restart it after editing. Accounts removed from
  the config stop being collected and disappear from the dashboard (and a person or company with none left disappears from the picker); their history is kept.

## Collection

- Once a day at `DAILY_AT`. A machine that slept through it catches up when it wakes, and it
  never runs twice a day.
- On demand: REFRESH in the dashboard (only whoever is on screen), or `npm run collect`
  (everyone; add job names such as `x.sweep` to run only those).
- Posts are re-read daily for a week, every third day while they keep growing, and not at all
  after 30 days. Each sweep reads at most 15 posts per account.
- Every reading is kept; nothing is overwritten. Raw responses are stored too, so parsing can
  be redone without paying again. After each daily run a copy of the database goes to
  `data/backups/` (the last 14 are kept).

## Reading the dashboard

The **?** button in the dashboard explains everything on screen. In short:

- **Score:** one bar per day of points. A like is 1, a comment 2, a share 3; a new follower or
  star 1; GitHub work is weighted into BUILD and MAINTAIN. **S** solos a series, **M** mutes it.
- **Followers, Activity:** followers over time, posts per day, and engagement per post.
- **The city:** one tower per post. Height is engagement; the look is the rating against the
  account's last 10 posts: HOT (on fire), GOOD, MEH (frozen), SHIT (grey, skulls). Ripples mark
  posts from the last 48 hours. The outer ring is a year of GitHub; a repository floats above as a star.
- **Cinema:** after 30 seconds without input (or the CINEMA button) the camera tours the stats.

## LinkedIn impressions

LinkedIn shows impressions only to the author. Two ways to bring them in:

- **Export (no risk):** in LinkedIn, Analytics → Content (or a single post) → Export, and drop
  the `.xlsx` in `data/imports/linkedin/<handle>/`. It is read on the next run, in any language.
- **Browser reader (opt-in):** `npm run linkedin:login` opens a Chrome window with its own
  profile; sign in yourself, then set `LINKEDIN_BROWSER=on`. Each daily run reads the analytics
  page of recent posts in a visible window, read-only, and stops at any login or security check.
  LinkedIn does not allow automated access, so this carries a small risk to the account.

## Running it on an always-on Mac

```bash
git clone https://github.com/thomashacker/creatorizz.git && cd creatorizz
npm ci && npm run build
cp .env.example .env            # tokens, and HOST set to the address to serve on
# add config.json
./deploy/install-macos.sh       # installs and starts the service (asks for sudo)
```

The service is a LaunchDaemon: it starts at boot without anyone logged in, runs as the user
who installed it, and restarts if it stops. Logs go to `data/creatorizz.log`.
`./deploy/uninstall-macos.sh` removes it.

Keep the Mac awake so the daily run happens, and have it start again after a power cut:

```bash
sudo pmset -a sleep 0 disksleep 0 autorestart 1
```

To update: `git pull && npm ci && npm run build && ./deploy/install-macos.sh`.

### Sharing it with your team

Set `HOST` to the machine's address on a private network, such as its NetBird or Tailscale IP,
and everyone on that network opens `http://<that address>:4410`. Access rules in the network
decide who can reach it; nothing is exposed to the internet.

## Development

```bash
npm run dev          # API on 4410, restarting on server changes
npm run dev:web      # dashboard with hot reload on 4411
npm run check        # lint (strict typecheck), tests, build
```

Code map: `server/` (collectors, scheduler, scoring, API), `web/src/` (React, three.js,
shaders), `test/` (node:test), `deploy/` (macOS service).
