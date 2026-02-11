import { describe, it, expect } from 'vitest';
import { QualityVerifier } from '../../../src/quality/verifier.js';

describe('QualityVerifier', () => {
  const verifier = new QualityVerifier();

  it('should pass with no changes', async () => {
    const report = await verifier.verify({
      filesChanged: [],
      workingDir: '/tmp/test',
      executionId: 'test-001',
    });

    expect(report.passed).toBe(true);
  });

  it('should verify file changes', async () => {
    const report = await verifier.verify({
      filesChanged: ['src/test.ts'],
      workingDir: '/tmp/test',
      executionId: 'test-002',
    });

    // Should have run gates and produced results
    expect(report.gates).toBeDefined();
    expect(report.gates!.length).toBeGreaterThan(0);
  });
});
