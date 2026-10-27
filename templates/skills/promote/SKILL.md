---
name: promote
description: Prepare the promotion of a ready OctoSprout idea to a project, with its brief and initial tasks. Use when the user asks to promote an idea or turn it into a project.
---

# Promote

**Input:** an idea with status `ready`. For any other status, offer the
`explore` skill first.

**Output:** one consequential promotion proposal. Once the owner approves it
with their passkey, it:
- creates the project with its brief;
- creates the initial tasks, each `belongs_to` the project and
  `derived_from` the idea;
- links the idea `promoted_to` the project;
- moves the idea to `transplanted`.

1. Read the idea and everything it rests on: `get_related` at depth 2 gives
   its captures, the research that `supports` it, and related records.
2. Assess readiness. List what is settled and what is still open, and ask the
   user about any gap that would change the project's scope before drafting.
3. Draft the brief in the project template's sections:
   - Problem and users;
   - Goals;
   - Non-goals;
   - Scope;
   - Requirements;
   - Constraints and decisions;
   - Success criteria;
   - Risks, assumptions and open questions;
   - Related;
   - Repositories.

   Reference the idea and research by ID under Related rather than copying
   them. Goals, Non-goals, Scope and Success criteria become approval-guarded
   once the project is active, so make them precise.
4. Draft initial tasks as short, concrete titles: the first steps, not the
   whole plan. Leave them out if the user prefers.
5. Call `propose_promotion` with:
   - the idea;
   - `project_title`;
   - the brief;
   - the tasks;
   - `project_status` `proposed`, or `active` if the user says so;
   - a rationale holding the readiness assessment and the open questions.
6. Tell the user the proposal ID. They approve it in the browser under
   Proposals, with their passkey.

**Done when** the proposal exists, and every gap from step 2 is either answered
in the brief or listed under its open questions.
