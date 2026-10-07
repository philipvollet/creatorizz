// 7 x 7 pixel icons in the bitmap font's style: 'X' is a lit pixel. One per kind of number,
// so a value reads at a glance: engagement, views, followers, stars, and the GitHub actions.
export const ICONS = {
  // Engagement: likes, comments and shares together.
  heart: ['.XX.XX.', 'XXXXXXX', 'XXXXXXX', 'XXXXXXX', '.XXXXX.', '..XXX..', '...X...'],
  // Views and reach.
  eye: ['.......', '.XXXXX.', 'X..X..X', 'X.XXX.X', 'X..X..X', '.XXXXX.', '.......'],
  followers: ['..XXX..', '..XXX..', '..XXX..', '.......', '.XXXXX.', 'XXXXXXX', 'XXXXXXX'],
  star: ['...X...', '...X...', 'XXXXXXX', '.XXXXX.', '..XXX..', '.XX.XX.', 'XX...XX'],
  comment: ['XXXXXXX', 'X.....X', 'X.X.X.X', 'X.....X', 'XXXXXXX', '.XX....', '.X.....'],
  share: ['....X..', 'XXXXXX.', 'X...X..', 'X.....X', '..X...X', '.XXXXXX', '..X....'],
  build: ['XXXX...', 'XXXXX..', 'XXXX...', '...X...', '....X..', '.....X.', '......X'],
  maintain: ['XX...XX', 'X.X.X.X', '.XX.XX.', '..XXX..', '...X...', '...X...', '...X...'],
  commit: ['...X...', '...X...', '..XXX..', '.XX.XX.', '..XXX..', '...X...', '...X...'],
  pr: ['X...X..', 'X..XXX.', 'X...X..', 'X...X..', 'X...X..', 'X......', 'X...X..'],
  fork: ['X...X..', 'X...X..', '.X.X...', '..X....', '..X....', '..X....', '..X....'],
  issue: ['.XXXXX.', 'X.....X', 'X..X..X', 'X.XXX.X', 'X..X..X', 'X.....X', '.XXXXX.'],
  check: ['.......', '......X', '.....X.', 'X...X..', '.X.X...', '..X....', '.......'],
  // A post or document.
  post: ['XXXXX..', 'X...XX.', 'X.....X', 'X.XXX.X', 'X.....X', 'X.XXX.X', 'XXXXXXX'],
  tag: ['XXXX...', 'X..XX..', 'X.X.XX.', 'X...XXX', '.XXXXX.', '..XXX..', '...X...'],
} as const;

export type IconName = keyof typeof ICONS;
