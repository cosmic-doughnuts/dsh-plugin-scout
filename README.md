# dsh-plugin-scout

[![dsh plugin](https://awesome-dsh-plugin.com/badge.svg)](https://awesome-dsh-plugin.com)

**Find DeepSeek Harness plugins — and know, before installing, whether each
one is compatible with the running `dsh` runtime.**

Tell your agent what you want ("notify me on WeChat when a task finishes"),
and it searches the DSH plugin ecosystem on GitHub for you: top results by
stars, each with a compatibility verdict checked against your runtime
version and a ready-to-run install command.

## Install

```sh
# from GitHub
dsh plugin --profile web add github:cosmic-doughnuts/dsh-plugin-scout

# or from npm (once published)
dsh plugin --profile web add dsh-plugin-scout
```

Peer ranges: `@deepseek-ai/cordis ^4.0.1`, `@deepseek-ai/dsh-tools
^0.2.0-rc.2`. The dsh runtime enforces these at install time — this plugin
installs cleanly (no version exemption) on runtimes matching those ranges.

## Usage

Restart `dsh web` after installing, then just talk to the agent — it calls
`find_dsh_plugin` whenever plugin discovery helps:

- "What theme plugins work with my dsh version?"
- "Find me something for reviewing git diffs inside DSH — check it's compatible first."

Each result is marked:

- ✅ **compatible** — every declared DSH peer range is satisfied by the running runtime
- ❌ **incompatible** — at least one range is not satisfied; the unsatisfied ranges are listed
- ❓ **unknown** — no DSH peers declared, unsupported range syntax, or metadata unreachable

Installing a marked plugin is one step for the agent: the built-in
`plugin_manager` tool (`install_bundle` action) or the printed
`dsh plugin --profile <name> add <spec>` command. Repos on the topic without
a `dsh.bundle` manifest are demoted to a footnote — they are not installable
DSH plugin bundles.

## How it works

- Live GitHub repository search scoped to the public `dsh-plugin` topic,
  re-ranked by stars (5-minute per-query cache).
- Each candidate's `package.json` is read from the repo (for the
  `dsh.bundle` manifest) and from the npm registry (for the published
  version and peer ranges); peers are evaluated with a vendored semver-range
  matcher covering the syntax real DSH plugins use (`^` ranges with 0.x
  semantics, prereleases, `||` unions). Anything else reports ❓, never a
  guess.
- The runtime version is resolved from the running dsh installation
  (`@deepseek-ai/dsh-app-boot` when resolvable, else the runtime packages'
  own `package.json` files).
- When GitHub search is rate limited or unreachable, the tool degrades to
  keyword matches from the curated
  [awesome-dsh-plugin](https://awesome-dsh-plugin.com) list (cached under
  `$DSH_HOME/cache/dsh-plugin-scout/`) and says so in the note. Configure
  the DSH `GITHUB_TOKEN` credential for authenticated search (30 req/min).

## Development

```sh
npm install
npm test        # build + offline unit tests (node --test)
npm run test:live  # live GitHub/npm smoke test (skips on rate limit)
npm run check   # typecheck + build
```

No runtime dependencies; peers only. TypeScript sources in `src/`, built
output in `lib/`.

## Security

This plugin only makes outbound HTTPS requests to `api.github.com`,
`raw.githubusercontent.com`, `registry.npmjs.org`, and
`awesome-dsh-plugin.com`. It reads no files outside its cache directory and
executes nothing. Installing *other* plugins runs third-party code on your
machine with your own permissions — review the source and pin a commit
before installing anything this tool finds.

## License

[MIT](LICENSE)
