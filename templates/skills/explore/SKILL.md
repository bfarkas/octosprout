---
name: explore
description: Explore an OctoSprout idea, research and refine it, and propose the updates. Use when the user asks to explore, research, develop or flesh out an idea.
---

# Explore

**Input:** an idea ID (`seed`, `sprouting` or `dormant`) and, optionally, the
questions the user wants answered.

**Output:** one proposal that updates the idea and adds what was learned.

1. Read the idea (`get_record`) and its neighbourhood (`get_related`,
   depth 2): its captures, research and related ideas.
2. List the questions this exploration should answer:
   - the idea's Open questions;
   - the user's questions;
   - what a promotion would need: who it is for, what it would take, and
     what already exists.
3. Investigate each question with the sources you have, such as web search
   or the code repositories. Note every source as you go.
4. For each question that needed real investigation, draft a research
   record with `draft_record` (type `research`). It holds:
   - the Question;
   - the Findings;
   - the Sources, with links;
   - a short Summary;
   - a `supports` link to the idea in its frontmatter.

   Mark it `concluded` when the question is answered.
5. Draft the idea's new content:
   - add to Exploration and Alternatives;
   - rewrite Open questions to what is still open;
   - set Next step;
   - keep Motivation as the owner wrote it.
6. Call `propose` once, with:
   - the `create` operations for the research records;
   - an `update` of the idea (with its `base_blob`);
   - `add_link` `relates_to` for related records you found;
   - `set_status` `sprouting` for a `seed` idea.
7. Tell the user what you found, what is still open, and the proposal ID.

**Done when** every listed question has an answer in a research record or the
idea, or an entry in Open questions saying why it is still open. Moving the
idea to `ready` is the owner's call, or part of a `promote` run.
