import assert from 'node:assert/strict';
import { describe, it } from 'mocha';
import { assertObservability, parseObservabilityToml } from '../deploy/worker/assert-observability.mjs';

const configuration = (rate = 0.1) => `
name = "cloudflare-imgbed-staging"
[observability]
enabled = true
redact_query_string = true
[observability.logs]
enabled = true
invocation_logs = true
persist = true
head_sampling_rate = 1
[observability.traces]
enabled = true
persist = true
head_sampling_rate = ${rate}
[assets]
directory = "../../frontend-dist"
`;

describe('deployment observability fail-closed guard', () => {
  it('accepts the complete protected staging config', () => {
    const parsed = parseObservabilityToml(configuration());
    assert.equal(parsed.root.name, 'cloudflare-imgbed-staging');
    assertObservability(parsed, 'staging');
  });
  it('accepts the expected production trace sample', () => {
    assertObservability(parseObservabilityToml(configuration(0.05)), 'production');
  });
  it('rejects configs with disabled or missing logs/traces', () => {
    const oldConfig = 'name = "old-worker"\n[assets]\ndirectory = "dist"';
    assert.throws(() => assertObservability(parseObservabilityToml(oldConfig), 'staging'), /Observability/);
    for (const changed of [
      configuration().replace('invocation_logs = true', 'invocation_logs = false'),
      configuration().replace('persist = true', 'persist = false'),
      configuration().replace('redact_query_string = true', 'redact_query_string = false'),
      configuration().replace('head_sampling_rate = 0.1', 'head_sampling_rate = 0.01'),
      configuration().replace('[observability.traces]\nenabled = true', '[observability.traces]\nenabled = false'),
    ]) {
      assert.throws(() => assertObservability(parseObservabilityToml(changed), 'staging'));
    }
  });
  it('rejects duplicate Observability TOML sections', () => {
    assert.throws(() => parseObservabilityToml(configuration() + '\n[observability]\nenabled = false\n'), /Duplicate/);
  });
  it('checks the actual Cloudflare API shape, not only the local file shape', () => {
    const parsed = parseObservabilityToml(configuration());
    const remoteShape = {
      enabled: parsed.observability.enabled,
      redact_query_string: parsed.observability.redact_query_string,
      logs: parsed.logs,
      traces: parsed.traces,
    };
    assertObservability({ observability: remoteShape }, 'staging');
    assert.throws(() => assertObservability({ observability: { ...remoteShape, logs: null } }, 'staging'));
  });
});
