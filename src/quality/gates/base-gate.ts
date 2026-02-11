import type { QualityGate, QualityContext, GateResult } from '../types.js';
import { getLogger } from '../../core/logger.js';
import { Timer } from '../../utils/timer.js';

export abstract class BaseGate implements QualityGate {
  abstract name: string;
  abstract description: string;

  protected logger = getLogger();

  async run(context: QualityContext): Promise<GateResult> {
    const timer = new Timer();
    this.logger.debug({ gate: this.name, files: context.filesChanged.length }, 'Running quality gate');

    try {
      const result = await this.execute(context);
      const duration = timer.stop();

      return {
        ...result,
        gate: this.name,
        duration,
      };
    } catch (err) {
      const duration = timer.stop();
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error({ gate: this.name, error: message }, 'Quality gate error');

      return {
        gate: this.name,
        passed: false,
        issues: [{
          severity: 'error',
          message: `Gate "${this.name}" crashed: ${message}`,
          autoFixable: false,
        }],
        duration,
      };
    }
  }

  protected abstract execute(context: QualityContext): Promise<Omit<GateResult, 'gate' | 'duration'>>;
}
