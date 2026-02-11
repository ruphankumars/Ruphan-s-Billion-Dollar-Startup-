import { createCLI } from '../src/cli/index.js';

const cli = createCLI();
cli.parse(process.argv);
