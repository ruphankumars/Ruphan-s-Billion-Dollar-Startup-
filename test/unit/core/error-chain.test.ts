import { describe, it, expect } from 'vitest';
import { ChainableError, ErrorAggregator } from '../../../src/core/error-chain.js';

describe('ChainableError', () => {
  it('should create error with code and context', () => {
    const err = new ChainableError('test error', 'TEST_ERR', {
      stage: 'execute',
      component: 'agent',
    });
    expect(err.message).toBe('test error');
    expect(err.code).toBe('TEST_ERR');
    expect(err.context.stage).toBe('execute');
    expect(err.context.component).toBe('agent');
    expect(err.context.timestamp).toBeGreaterThan(0);
  });

  it('should wrap an existing error with additional context', () => {
    const original = new Error('network timeout');
    const wrapped = ChainableError.wrap(original, 'Provider failed', 'PROVIDER_ERR', {
      provider: 'anthropic',
    });
    expect(wrapped.message).toBe('Provider failed: network timeout');
    expect(wrapped.code).toBe('PROVIDER_ERR');
    expect(wrapped.context.provider).toBe('anthropic');
    expect(wrapped.causedBy).toBe(original);
  });

  it('should convert from plain Error', () => {
    const plain = new Error('plain error');
    const converted = ChainableError.from(plain, { stage: 'recall' });
    expect(converted.code).toBe('UNKNOWN_ERROR');
    expect(converted.context.stage).toBe('recall');
    expect(converted.causedBy).toBe(plain);
  });

  it('should return same instance if already ChainableError', () => {
    const original = new ChainableError('already chainable', 'TEST');
    const converted = ChainableError.from(original);
    expect(converted).toBe(original);
  });

  it('should build full causal chain', () => {
    const root = new Error('disk full');
    const mid = new ChainableError('write failed', 'WRITE_ERR', {}, root);
    const top = new ChainableError('store failed', 'STORE_ERR', {}, mid);

    const chain = top.getChain();
    expect(chain.length).toBe(3);
    expect(chain[0].code).toBe('STORE_ERR');
    expect(chain[1].code).toBe('WRITE_ERR');
    expect(chain[2].code).toBe('UNKNOWN'); // plain Error has no code
  });

  it('should get root cause', () => {
    const root = new Error('original cause');
    const mid = new ChainableError('mid', 'MID', {}, root);
    const top = new ChainableError('top', 'TOP', {}, mid);
    expect(top.getRootCause()).toBe(root);
  });

  it('should serialize for telemetry', () => {
    const err = new ChainableError('test', 'CODE', {
      stage: 'verify',
      taskId: 'task-1',
    });
    const serialized = err.serialize();
    expect(serialized.code).toBe('CODE');
    expect(serialized.context.stage).toBe('verify');
    expect(serialized.context.taskId).toBe('task-1');
    expect(serialized.chain.length).toBe(1);
    expect(typeof serialized.stack).toBe('string');
  });

  it('should serialize nested chain', () => {
    const inner = new ChainableError('inner', 'INNER');
    const outer = new ChainableError('outer', 'OUTER', {}, inner);
    const serialized = outer.serialize();
    expect(serialized.cause).toBeDefined();
    expect(serialized.cause!.code).toBe('INNER');
    expect(serialized.chain.length).toBe(2);
  });

  it('should produce human-readable debug string', () => {
    const inner = new Error('timeout');
    const outer = new ChainableError('API call failed', 'API_ERR', {
      stage: 'execute',
      component: 'provider',
      provider: 'openai',
    }, inner);

    const debug = outer.toDebugString();
    expect(debug).toContain('API call failed');
    expect(debug).toContain('API_ERR');
    expect(debug).toContain('execute');
    expect(debug).toContain('provider');
    expect(debug).toContain('openai');
    expect(debug).toContain('Caused by');
  });
});

describe('ErrorAggregator', () => {
  it('should collect multiple errors', () => {
    const agg = new ErrorAggregator();
    agg.add(new ChainableError('err1', 'CODE_A'));
    agg.add(new ChainableError('err2', 'CODE_B'));
    expect(agg.count).toBe(2);
    expect(agg.hasErrors).toBe(true);
  });

  it('should add from plain errors', () => {
    const agg = new ErrorAggregator();
    agg.addFromError(new Error('plain'), { stage: 'recall' });
    expect(agg.count).toBe(1);
    expect(agg.getAll()[0].context.stage).toBe('recall');
  });

  it('should group by code', () => {
    const agg = new ErrorAggregator();
    agg.add(new ChainableError('a', 'TIMEOUT'));
    agg.add(new ChainableError('b', 'TIMEOUT'));
    agg.add(new ChainableError('c', 'RATE_LIMIT'));

    const groups = agg.groupByCode();
    expect(groups.get('TIMEOUT')?.length).toBe(2);
    expect(groups.get('RATE_LIMIT')?.length).toBe(1);
  });

  it('should group by stage', () => {
    const agg = new ErrorAggregator();
    agg.add(new ChainableError('a', 'ERR', { stage: 'execute' }));
    agg.add(new ChainableError('b', 'ERR', { stage: 'execute' }));
    agg.add(new ChainableError('c', 'ERR', { stage: 'verify' }));

    const groups = agg.groupByStage();
    expect(groups.get('execute')?.length).toBe(2);
    expect(groups.get('verify')?.length).toBe(1);
  });

  it('should produce telemetry summary', () => {
    const agg = new ErrorAggregator();
    agg.add(new ChainableError('timeout', 'TIMEOUT', { stage: 'execute' }));
    agg.add(new ChainableError('rate limit', 'RATE_LIMIT', { stage: 'execute' }));

    const summary = agg.getSummary();
    expect(summary.total).toBe(2);
    expect(summary.byCode.TIMEOUT).toBe(1);
    expect(summary.byCode.RATE_LIMIT).toBe(1);
    expect(summary.byStage.execute).toBe(2);
    expect(summary.messages.length).toBe(2);
  });

  it('should clear errors', () => {
    const agg = new ErrorAggregator();
    agg.add(new ChainableError('err', 'ERR'));
    expect(agg.count).toBe(1);
    agg.clear();
    expect(agg.count).toBe(0);
    expect(agg.hasErrors).toBe(false);
  });

  it('should handle empty aggregator', () => {
    const agg = new ErrorAggregator();
    expect(agg.count).toBe(0);
    expect(agg.hasErrors).toBe(false);
    const summary = agg.getSummary();
    expect(summary.total).toBe(0);
  });
});
