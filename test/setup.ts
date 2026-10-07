// Runs before every test file: point the app at a throwaway data folder and an absent config,
// so tests never touch a real database or the tracked accounts.
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.CREATORIZZ_DATA = mkdtempSync(join(tmpdir(), 'creatorizz-test-'));
process.env.CREATORIZZ_CONFIG = join(process.env.CREATORIZZ_DATA, 'config.json');
