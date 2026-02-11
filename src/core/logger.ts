import pino from 'pino';
import { existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

const LOG_DIR = join(homedir(), '.cortexos', 'logs');

function ensureLogDir(): void {
  if (!existsSync(LOG_DIR)) {
    mkdirSync(LOG_DIR, { recursive: true });
  }
}

export function createLogger(name: string = 'cortexos', verbose: boolean = false): pino.Logger {
  ensureLogDir();

  if (verbose) {
    return pino({
      name,
      level: 'debug',
      transport: {
        target: 'pino-pretty',
        options: { colorize: true },
      },
    });
  }

  return pino({
    name,
    level: 'debug',
    transport: {
      target: 'pino/file',
      options: { destination: join(LOG_DIR, 'cortexos.log'), mkdir: true },
    },
  });
}

let _logger: pino.Logger | null = null;

export function getLogger(): pino.Logger {
  if (!_logger) {
    _logger = createLogger();
  }
  return _logger;
}

export function setLogger(logger: pino.Logger): void {
  _logger = logger;
}
