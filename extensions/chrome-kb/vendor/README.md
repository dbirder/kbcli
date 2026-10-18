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
