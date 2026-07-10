import test from 'node:test';
import assert from 'node:assert/strict';

import { ConfigService } from '../src/services/config.service.js';

function createQueryResult(value) {
  return {
    exec: async () => value,
  };
}

test('ConfigService returns defaults when config is not persisted', async () => {
  const configService = new ConfigService({
    configModel: {
      findOne() {
        return {
          lean() {
            return createQueryResult(null);
          },
        };
      },
    },
  });

  const config = await configService.getConfig();

  assert.equal(config.maxRetries, 3);
  assert.equal(config.backoffBase, 2);
  assert.equal(config.source, 'defaults');
});

test('ConfigService persists config updates into the default document', async () => {
  const calls = [];
  const configService = new ConfigService({
    configModel: {
      findOneAndUpdate(query, update, options) {
        calls.push({ query, update, options });

        return createQueryResult({
          configKey: 'default',
          maxRetries: update.$set.maxRetries,
          backoffBase: update.$set.backoffBase,
        });
      },
    },
  });

  const config = await configService.setConfig({
    maxRetries: '5',
    backoffBase: '3',
  });

  assert.equal(config.maxRetries, 5);
  assert.equal(config.backoffBase, 3);
  assert.equal(config.source, 'database');
  assert.deepEqual(calls[0].query, { configKey: 'default' });
  assert.equal(calls[0].options.upsert, true);
  assert.equal(calls[0].options.returnDocument, 'after');
});

test('ConfigService rejects invalid config updates', async () => {
  const configService = new ConfigService();

  await assert.rejects(() => configService.setConfig({}), /requires at least one field/);
  await assert.rejects(() => configService.setConfig({ maxRetries: '-1' }), /cannot be negative/);
  await assert.rejects(() => configService.setConfig({ backoffBase: '0' }), /at least 1/);
});
