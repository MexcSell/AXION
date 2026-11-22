import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderMappingMarkdown } from './mapping.ts';

// `npx tsx src/otel/write-mapping-doc.ts` regenerates web/docs/improve/phase2/otel-mapping.md from the mapping table (c60).
writeFileSync(join(import.meta.dirname, '../../../web/docs/improve/phase2/otel-mapping.md'), renderMappingMarkdown());
console.log('wrote web/docs/improve/phase2/otel-mapping.md');
