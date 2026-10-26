# Record schemas

Canonical JSON Schemas (draft 2020-12) for record frontmatter, versioned per
type as `<type>.v<N>.schema.json` (spec §6.5). Shared definitions live in
`common.v<N>.schema.json`.

| Schema | Status |
|---|---|
| `common.v1` | Shared definitions: IDs, timestamps, tags, links, refs, Git SHAs, actors, workspace paths |
| `capture.v1` | Phase 1 |
| `idea.v1`, `task.v1`, `project.v1`, `decision.v1`, `research.v1`, `expert.v1` | Phase 2 |
| `proposal.v1` | Phase 2. Operations `create`, `update`, `set_status`, `add_link`, `remove_link` and `delete` (§9.3); `update` and `delete` name either a record `id` or a workspace `path` |

Schemas validate frontmatter shape only. Cross-record rules (links, lifecycle,
approvals, capture immutability) are enforced by the validator in
`@octosprout/core` (spec §19).
