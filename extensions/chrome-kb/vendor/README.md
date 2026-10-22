# Local Markdown parser

- Package: markdown-it 15.0.3 (MIT)
- Official source: https://github.com/markdown-it/markdown-it/tree/15.0.3
- Registry archive: https://registry.npmjs.org/markdown-it/-/markdown-it-15.0.3.tgz
- Input: package/dist/browser/markdown-it.esm.min.mjs
- Vendored unchanged as markdown-it-15.0.3.mjs
- SHA-256: d5432491790141da046b1197353705db03264f40b5727f3b4b591f5aba193e30

The extension imports this self-contained ESM file locally. It never downloads a
parser at runtime, evaluates Markdown source, or enables raw HTML. markdown.mjs
converts parser tokens into a fixed set of DOM elements using textContent and
createTextNode; source text never passes through innerHTML.

The package license is in markdown-it-LICENSE.txt. Bundled runtime dependency
notices (entities, linkify-it, mdurl, punycode.js and uc.micro) are included in
THIRD-PARTY-NOTICES.txt, with versions checked against the official 15.0.3 lockfile.
Do not package CLI-only argparse or the source map; neither is imported at runtime.

Update deliberately: verify the official release and package path, replace the
browser build and licenses, update its pinned filename and this hash, then run
Markdown unit tests, browser render/security checks and the extension package test.


# Local drag-and-drop library

- Package: SortableJS 1.15.7 (MIT), https://github.com/SortableJS/Sortable/tree/1.15.7
- Official registry: https://registry.npmjs.org/sortablejs/-/sortablejs-1.15.7.tgz
- Input: package/modular/sortable.esm.js, vendored as sortable-1.15.7.mjs with the local patch below
- SHA-256: 2f62946b81f5f6fe39e3bf8970ac8f83337f7e4e549fff59529e9f4af41515ae
- License: sortable-LICENSE.txt

The complete local ESM build includes AutoScroll; no CDN or runtime download.
Whole cards initiate dragging while editing controls are filtered. Persistence uses the extension's
revision-checked worker operations, not SortableJS localStorage adapters.

Local patch (0.9.1): reset `ignoreNextClick` on a fresh pointerdown. A spring-folder
drop may finish without generating a browser click; its pending suppression must
not swallow the next independent click. The current drop click remains blocked.
Reapply and verify this patch when upgrading SortableJS.
