// Copied from content-visualizer/src/render/font.js (same author), plus a few glyphs.
// 5x7 bitmap font, uppercase only. Each glyph is 7 rows of 5 chars ('X' = pixel on).
const G: Record<string, string> = {
  A: '.XXX. X...X X...X XXXXX X...X X...X X...X',
  B: 'XXXX. X...X X...X XXXX. X...X X...X XXXX.',
  C: '.XXX. X...X X.... X.... X.... X...X .XXX.',
  D: 'XXXX. X...X X...X X...X X...X X...X XXXX.',
  E: 'XXXXX X.... X.... XXXX. X.... X.... XXXXX',
  F: 'XXXXX X.... X.... XXXX. X.... X.... X....',
  G: '.XXX. X...X X.... X.XXX X...X X...X .XXXX',
  H: 'X...X X...X X...X XXXXX X...X X...X X...X',
  I: 'XXXXX ..X.. ..X.. ..X.. ..X.. ..X.. XXXXX',
  J: '..XXX ...X. ...X. ...X. ...X. X..X. .XX..',
  K: 'X...X X..X. X.X.. XX... X.X.. X..X. X...X',
  L: 'X.... X.... X.... X.... X.... X.... XXXXX',
  M: 'X...X XX.XX X.X.X X.X.X X...X X...X X...X',
  N: 'X...X XX..X X.X.X X..XX X...X X...X X...X',
  O: '.XXX. X...X X...X X...X X...X X...X .XXX.',
  P: 'XXXX. X...X X...X XXXX. X.... X.... X....',
  Q: '.XXX. X...X X...X X...X X.X.X X..X. .XX.X',
  R: 'XXXX. X...X X...X XXXX. X.X.. X..X. X...X',
  S: '.XXXX X.... X.... .XXX. ....X ....X XXXX.',
  T: 'XXXXX ..X.. ..X.. ..X.. ..X.. ..X.. ..X..',
  U: 'X...X X...X X...X X...X X...X X...X .XXX.',
  V: 'X...X X...X X...X X...X X...X .X.X. ..X..',
  W: 'X...X X...X X...X X.X.X X.X.X X.X.X .X.X.',
  X: 'X...X X...X .X.X. ..X.. .X.X. X...X X...X',
  Y: 'X...X X...X .X.X. ..X.. ..X.. ..X.. ..X..',
  Z: 'XXXXX ....X ...X. ..X.. .X... X.... XXXXX',
  0: '.XXX. X...X X..XX X.X.X XX..X X...X .XXX.',
  1: '..X.. .XX.. ..X.. ..X.. ..X.. ..X.. .XXX.',
  2: '.XXX. X...X ....X ...X. ..X.. .X... XXXXX',
  3: 'XXXXX ...X. ..X.. ...X. ....X X...X .XXX.',
  4: '...X. ..XX. .X.X. X..X. XXXXX ...X. ...X.',
  5: 'XXXXX X.... XXXX. ....X ....X X...X .XXX.',
  6: '..XX. .X... X.... XXXX. X...X X...X .XXX.',
  7: 'XXXXX ....X ...X. ..X.. .X... .X... .X...',
  8: '.XXX. X...X X...X .XXX. X...X X...X .XXX.',
  9: '.XXX. X...X X...X .XXXX ....X ...X. .XX..',
  ' ': '..... ..... ..... ..... ..... ..... .....',
  '.': '..... ..... ..... ..... ..... .XX.. .XX..',
  ',': '..... ..... ..... ..... .XX.. ..X.. .X...',
  ':': '..... .XX.. .XX.. ..... .XX.. .XX.. .....',
  ';': '..... .XX.. .XX.. ..... .XX.. ..X.. .X...',
  '-': '..... ..... ..... XXXXX ..... ..... .....',
  '>': '.X... ..X.. ...X. ....X ...X. ..X.. .X...',
  '<': '...X. ..X.. .X... X.... .X... ..X.. ...X.',
  '/': '....X ....X ...X. ..X.. .X... X.... X....',
  '!': '..X.. ..X.. ..X.. ..X.. ..X.. ..... ..X..',
  '?': '.XXX. X...X ....X ...X. ..X.. ..... ..X..',
  "'": '..X.. ..X.. .X... ..... ..... ..... .....',
  '"': '.X.X. .X.X. ..... ..... ..... ..... .....',
  '(': '...X. ..X.. .X... .X... .X... ..X.. ...X.',
  ')': '.X... ..X.. ...X. ...X. ...X. ..X.. .X...',
  '[': '.XXX. .X... .X... .X... .X... .X... .XXX.',
  ']': '.XXX. ...X. ...X. ...X. ...X. ...X. .XXX.',
  '+': '..... ..X.. ..X.. XXXXX ..X.. ..X.. .....',
  '=': '..... ..... XXXXX ..... XXXXX ..... .....',
  '#': '.X.X. .X.X. XXXXX .X.X. XXXXX .X.X. .X.X.',
  '*': '..... X.X.X .XXX. XXXXX .XXX. X.X.X .....',
  '_': '..... ..... ..... ..... ..... ..... XXXXX',
  '&': '.XX.. X..X. X.X.. .X... X.X.X X..X. .XX.X',
  '%': 'XX..X XX..X ...X. ..X.. .X... X..XX X..XX',
  '@': '.XXX. X...X X.XXX X.X.X X.XXX X.... .XXX.',
  '|': '..X.. ..X.. ..X.. ..X.. ..X.. ..X.. ..X..',
  // Added for creatorizz: money and trend arrows.
  '$': '..X.. .XXXX X.X.. .XXX. ..X.X XXXX. ..X..',
  '↑': '..X.. .XXX. X.X.X ..X.. ..X.. ..X.. ..X..',
  '↓': '..X.. ..X.. ..X.. ..X.. X.X.X .XXX. ..X..',
  '×': '..... X...X .X.X. ..X.. .X.X. X...X .....',
};

const GLYPHS: Record<string, string[]> = {};
for (const [ch, rows] of Object.entries(G)) GLYPHS[ch] = rows.split(' ');

const ALIASES: Record<string, string> = { '→': '>', '←': '<', '…': '...', '’': "'", '‘': "'", '“': '"', '”': '"', '–': '-', '—': '-', '·': '.' };

export const GLYPH_W = 5;
export const GLYPH_H = 7;

export function normalize(text: unknown): string {
  let s = String(text ?? '').toUpperCase();
  for (const [a, b] of Object.entries(ALIASES)) s = s.split(a).join(b);
  return s;
}

// Width in logical pixels for a line at the given scale (sx = horizontal scale).
export function textWidth(text: string, sx = 1): number {
  const s = normalize(text);
  if (!s.length) return 0;
  return s.length * (GLYPH_W + 1) * sx - sx;
}

// Draws one line. `ctx` is a canvas 2D context at logical resolution.
export function drawText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, { color = '#fff', sx = 1, sy = 1, align = 'left', scan = false }: { color?: string; sx?: number; sy?: number; align?: 'left' | 'center' | 'right'; scan?: boolean } = {}): number {
  const s = normalize(text);
  const w = textWidth(s, sx);
  let cx = Math.round(align === 'center' ? x - w / 2 : align === 'right' ? x - w : x);
  y = Math.round(y);
  ctx.fillStyle = color;
  for (const ch of s) {
    const g = GLYPHS[ch] || GLYPHS['?'];
    for (let r = 0; r < GLYPH_H; r++) {
      for (let c = 0; c < GLYPH_W; c++) {
        if (g[r][c] !== 'X') continue;
        // `scan` leaves the bottom row of each scaled pixel dark, like the Apple II line look.
        const h = scan && sy > 1 ? sy - 1 : sy;
        ctx.fillRect(cx + c * sx, y + r * sy, sx, h);
      }
    }
    cx += (GLYPH_W + 1) * sx;
  }
  return w;
}

// Greedy word wrap to a max width in logical pixels.
export function wrap(text: string, maxW: number, sx = 1): string[] {
  const out: string[] = [];
  for (const para of normalize(text).split('\n')) {
    let line = '';
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const next = line ? line + ' ' + word : word;
      if (textWidth(next, sx) <= maxW || !line) line = next;
      else { out.push(line); line = word; }
    }
    out.push(line);
  }
  return out;
}
