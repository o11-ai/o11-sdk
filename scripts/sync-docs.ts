import { agentDocs } from '../packages/agent-kit/src/docs';
import { assertPublicText } from './public-artifacts';
for (const doc of agentDocs) {
  assertPublicText(doc.markdown, doc.id);
  const file = new URL('../docs/' + doc.id + '.md', import.meta.url);
  if (process.argv.includes('--check')) {
    if (await Bun.file(file).text() !== doc.markdown) throw new Error('Guides are out of date. Run bun run docs:sync.');
  } else await Bun.write(file, doc.markdown);
}
