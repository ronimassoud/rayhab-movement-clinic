// Copies the browser's Beirut-time module into the server, so both sides
// compute days, offsets and daylight saving the same way. test/shared.test.ts
// fails if the two copies drift apart.
import { copyFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const from = fileURLToPath(new URL('../../site/assets/js/api/time.js', import.meta.url));
const to = fileURLToPath(new URL('../shared/time.cjs', import.meta.url));
copyFileSync(from, to);
console.log('shared/time.cjs updated from site/assets/js/api/time.js');
