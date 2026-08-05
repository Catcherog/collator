#!/usr/bin/env node
/**
 * Read-only diagnostic: compare the audited legacy-module source hashes with
 * the hashes of the files actually on disk, and report whether a mismatch is
 * explained by line-ending drift (CRLF checkout on Windows) or by real content
 * divergence.
 *
 * Makes no writes of any kind.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const LEGACY_ROOT = path.join(REPO_ROOT, 'src', 'data-cleaning');
const REPORT_PATH = path.join(REPO_ROOT, 'reports', 'phase2', 'legacy-module-profiles.json');

const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

const { profiles } = JSON.parse(fs.readFileSync(REPORT_PATH, 'utf-8'));

let match = 0;
const lfExplained = [];
const realDrift = [];
const missing = [];

for (const p of profiles) {
  if (!p.sourceHash) continue;
  const abs = path.resolve(LEGACY_ROOT, p.modulePath);
  if (!fs.existsSync(abs)) {
    missing.push(p.modulePath);
    continue;
  }
  const raw = fs.readFileSync(abs, 'utf-8');
  const asIs = sha(raw);
  if (asIs === p.sourceHash) {
    match += 1;
    continue;
  }
  const lf = sha(raw.replace(/\r\n/g, '\n'));
  const crlf = sha(raw.replace(/\r\n/g, '\n').replace(/\n/g, '\r\n'));
  if (lf === p.sourceHash) {
    lfExplained.push({ modulePath: p.modulePath, direction: 'disk=CRLF, audited=LF' });
  } else if (crlf === p.sourceHash) {
    lfExplained.push({ modulePath: p.modulePath, direction: 'disk=LF, audited=CRLF' });
  } else {
    realDrift.push({
      modulePath: p.modulePath,
      auditedHash: p.sourceHash.slice(0, 12),
      onDiskHash: asIs.slice(0, 12),
      lfNormalisedHash: lf.slice(0, 12),
      bytes: fs.statSync(abs).size,
    });
  }
}

const summary = {
  profiles_with_hash: profiles.filter((p) => p.sourceHash).length,
  exact_match: match,
  explained_by_line_endings: lfExplained.length,
  real_content_drift: realDrift.length,
  missing_on_disk: missing.length,
};

console.log(JSON.stringify({ summary, lfExplained, realDrift, missing }, null, 2));
