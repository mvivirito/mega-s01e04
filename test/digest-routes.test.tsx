import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';

let runsDir: string;
let config: { adapter: string; installed: string; beatEverySeconds: number; runsDir: string };

const GOOD_NIGHT = '2026-10-28';
const EMPTY_NIGHT = '2026-10-27';
const BAD_NIGHT = '2026-10-26';
const MISSING_NIGHT = '2026-01-01';

beforeAll(() => {
  runsDir = mkdtempSync(join(tmpdir(), 'digest-routes-'));
  config = { adapter: 'shim', installed: '2026-10-29T14:06:00+01:00', beatEverySeconds: 60, runsDir };

  writeFileSync(
    join(runsDir, `${GOOD_NIGHT}.jsonl`),
    [
      '{"at":"2026-10-28T01:00:00+01:00","job":"backup","owner":"ops","status":"ok"}',
      '{"at":"2026-10-28T02:00:00+01:00","job":"backup","owner":"ops","status":"retry","error":"timeout"}',
      '{"at":"2026-10-28T03:00:00+01:00","job":"sync","owner":null,"status":"fail","error":"boom"}',
      '',
    ].join('\n'),
  );
  writeFileSync(join(runsDir, `${EMPTY_NIGHT}.jsonl`), '');
  writeFileSync(
    join(runsDir, `${BAD_NIGHT}.jsonl`),
    [
      '{"at":"2026-10-26T01:00:00+01:00","job":"cleanup","owner":"ops","status":"ok"}',
      'this is not json',
      '',
    ].join('\n'),
  );
});

afterAll(() => {
  rmSync(runsDir, { recursive: true, force: true });
});

describe('GET /digest/:night', () => {
  it('renders the digest table for a real night', async () => {
    const res = await createApp(config).request(`/digest/${GOOD_NIGHT}`);
    const html = await res.text();
    expect(res.status).toBe(200);
    expect(html).toContain(`digest · ${GOOD_NIGHT}`);
    expect(html).toContain('backup');
    expect(html).toContain('sync');
    expect(html).toContain('timeout');
    expect(html).toContain('boom');
  });

  it('answers 404 for a night with no file', async () => {
    const res = await createApp(config).request(`/digest/${MISSING_NIGHT}`);
    expect(res.status).toBe(404);
    expect(await res.text()).toContain('no run log for that night');
  });

  it('says "nothing ran" for an empty night', async () => {
    const res = await createApp(config).request(`/digest/${EMPTY_NIGHT}`);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('nothing ran');
  });

  it('counts a bad line and still shows the good ones', async () => {
    const res = await createApp(config).request(`/digest/${BAD_NIGHT}`);
    const html = await res.text();
    expect(res.status).toBe(200);
    expect(html).toContain("1 line didn&#39;t parse");
    expect(html).toContain('cleanup');
  });
});

describe('GET /api/digest/:night', () => {
  it('returns the rows for a real night', async () => {
    const res = await createApp(config).request(`/api/digest/${GOOD_NIGHT}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { night: string; rows: { job: string; runs: number; retries: number }[]; badLines: number };
    expect(body.night).toBe(GOOD_NIGHT);
    expect(body.badLines).toBe(0);
    expect(body.rows.map((r) => r.job)).toEqual(['backup', 'sync']);
    expect(body.rows[0]).toMatchObject({ job: 'backup', runs: 2, retries: 1 });
  });

  it('answers 404 for a night with no file', async () => {
    const res = await createApp(config).request(`/api/digest/${MISSING_NIGHT}`);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: `no run log for ${MISSING_NIGHT}` });
  });

  it('returns empty rows for an empty night', async () => {
    const res = await createApp(config).request(`/api/digest/${EMPTY_NIGHT}`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ night: EMPTY_NIGHT, rows: [], badLines: 0 });
  });

  it('counts the bad line and keeps the good rows', async () => {
    const res = await createApp(config).request(`/api/digest/${BAD_NIGHT}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { rows: { job: string }[]; badLines: number };
    expect(body.badLines).toBe(1);
    expect(body.rows.map((r) => r.job)).toEqual(['cleanup']);
  });
});
