# Vendored ADR template

`adr-template.md` in this directory is vendored **unmodified** from Andrew
Harmel-Law's *Facilitating Software Architecture* repository:

- Source: https://github.com/andrewharmellaw/facilitating-software-architecture/blob/1775d49516784bee6824fcd02556926121a7e772/adr/adr-template.md
- Pinned commit: `1775d49516784bee6824fcd02556926121a7e772` (16 January 2025)
- License: Mozilla Public License 2.0, full text in `LICENSE-MPL-2.0`

Decision records created from this template carry
`template: harmel-law-adr@1775d49516784bee6824fcd02556926121a7e772` in their
frontmatter (spec §13.1). Updating the template is a deliberate change: replace
the file with a newer upstream revision, update the pin here and in
`@octosprout/core`, and record the change.

OctoSprout's only additions when instantiating the template are the YAML
frontmatter and replacing `ADR00X` in the heading with the record ID.
