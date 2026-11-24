// docs/app.html devient docs/index.html ; .nojekyll évite le traitement Jekyll de GitHub Pages.
import { renameSync, writeFileSync } from 'node:fs';
renameSync('docs/app.html', 'docs/index.html');
writeFileSync('docs/.nojekyll', '');
