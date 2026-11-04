/**
 * Fail CI if a generated Wrangler config or the deployed Worker loses
 * persistent Logs / invocation logs / automatic Traces.
 *
 * Usage: node deploy/worker/assert-observability.mjs <config.toml> <production|staging> [--remote]
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const EXPECTED_TRACE_SAMPLE = Object.freeze({ production: 0.05, staging: 0.1 });
const sleep = ms => new Promise(resolveSleep => setTimeout(resolveSleep, ms));

export function parseObservabilityToml(text) {
  const settings = { root: {}, observability: {}, logs: {}, traces: {} };
  let section = 'root';
  const mapping = {
    observability: 'observability',
    'observability.logs': 'logs',
    'observability.traces': 'traces',
  };
  const visitedSections = new Set();
  for (const raw of text.split(/\r?\n/u)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const header = /^\[([\w.]+)\]$/u.exec(line);
    if (header) {
      if (mapping[header[1]]) {
        assert(!visitedSections.has(header[1]), `Duplicate ${header[1]} TOML section`);
        visitedSections.add(header[1]);
      }
      section = mapping[header[1]] ?? 'ignored';
      continue;
    }
    if (section === 'ignored') continue;
    const assignment = /^([a-z_]+)\s*=\s*(.+)$/u.exec(line);
    if (!assignment) continue;
    const [, key, rawValue] = assignment;
    const value = rawValue === 'true' ? true : rawValue === 'false' ? false
      : /^\d+(?:\.\d+)?$/u.test(rawValue) ? Number(rawValue)
        : /^"[^"]*"$/u.test(rawValue) ? rawValue.slice(1, -1) : undefined;
    if (value !== undefined) settings[section][key] = value;
  }
  return settings;
}

export function assertObservability(settings, environment) {
  assert(Object.hasOwn(EXPECTED_TRACE_SAMPLE, environment), 'Unknown environment');
  const opts = settings.observability ?? {};
  const logs = settings.logs ?? opts.logs ?? {};
  const traces = settings.traces ?? opts.traces ?? {};
  assert.equal(opts.enabled, true, 'Workers Observability must be enabled');
  assert.equal(opts.redact_query_string, true, 'OAuth query strings must be redacted');
  assert.equal(logs.enabled, true, 'Workers Logs must be enabled');
  assert.equal(logs.invocation_logs, true, 'Invocation Logs must be enabled');
  assert.equal(logs.persist, true, 'Workers Logs must be persisted');
  assert.equal(Number(logs.head_sampling_rate), 1, 'Must capture 100% of Worker invocation logs');
  assert.equal(traces.enabled, true, 'Automatic Traces must be enabled');
  assert.equal(traces.persist, true, 'Workers Traces must be persisted');
  assert.equal(Number(traces.head_sampling_rate), EXPECTED_TRACE_SAMPLE[environment], 'Trace sample rate is not as expected');
}

async function inspectRemote(workerName, environment) {
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  const token = process.env.CLOUDFLARE_API_TOKEN;
  assert(accountId && token, 'Cloudflare credentials are required to verify deployed settings');
  const url = `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/workers/scripts/${encodeURIComponent(workerName)}/script-settings`;
  let lastError;
  for (let attempt = 0; attempt < 6; attempt++) {
    try {
      const response = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(10000),
      });
      if (!response.ok) throw new Error(`Cloudflare settings API returned HTTP ${response.status}`);
      const body = await response.json();
      if (body.success !== true) throw new Error('Cloudflare settings API reported failure');
      const o = body.result?.observability;
      assert(o, 'Deployed Worker has no Observability settings');
      assertObservability({ observability: o }, environment);
      console.log(`PASS: Deployed ${workerName} has persisted Logs, invocation logs, masked query strings and Traces enabled`);
      return;
    } catch (error) {
      lastError = error;
      if (attempt < 5) await sleep(2000);
    }
  }
  throw new Error(`POST-DEPLOY OBSERVABILITY CHECK FAILED for ${workerName}: ${lastError?.message}`);
}

async function main() {
  const [filename, environment, option] = process.argv.slice(2);
  assert(filename && Object.hasOwn(EXPECTED_TRACE_SAMPLE, environment), 'Usage: assert-observability.mjs <config.toml> <production|staging> [--remote]');
  assert(option === undefined || option === '--remote', 'Unknown option');
  const settings = parseObservabilityToml(readFileSync(filename, 'utf8'));
  assertObservability(settings, environment);
  assert(typeof settings.root.name === 'string' && settings.root.name.length > 0, 'Worker name missing from generated config');
  console.log(`PASS: Generated ${environment} configuration keeps Workers Logs and Traces enabled`);
  if (option === '--remote') await inspectRemote(settings.root.name, environment);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    console.error(`::error::${error.message}`);
    process.exitCode = 1;
  });
}
