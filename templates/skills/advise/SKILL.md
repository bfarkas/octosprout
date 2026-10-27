---
name: advise
description: Gather simulated expert advice on an OctoSprout decision (ADR) from expert profiles, and propose it as Advice and Supporting Material. Use when the user asks for advice, expert review, perspectives or a second opinion on a decision.
---

# Advise

**Input:** a decision with status `DRAFT` or `PROPOSED`, and optionally the
profiles or perspectives the user wants. Later statuses are frozen; a reversal
of one starts from a new decision.

**Output:** one proposal (`propose_advice`) that:
- adds an attributed `## Advice` bullet per perspective, marked
  `(simulated, AI-generated, <model>)`;
- links each profile with `consulted`;
- keeps long-form advice and the synthesis in research records, listed under
  Supporting Material.

The advice is simulated. Report it as AI-generated perspectives, never as
review or approval; agreement among profiles decides nothing.

1. Read the decision (`get_record`) and its neighbourhood (`get_related`):
   its project, the decisions it supersedes, and the research that supports
   it. Note the question the decision answers and the options it weighs.
2. Choose two to four perspectives whose disagreement would be informative,
   such as security, operations, cost or the end user.
   - Reuse active profiles: `search_records` with type `expert`.
   - Draft a missing one as a `new_experts` entry, with the expert template's
     sections: Focus, Scope and expertise, Questions to investigate,
     Assumptions and biases to watch for, Advice format, Limitations. It is
     created in the same proposal and kept for reuse.
3. Run each perspective **independently**, from the profile and the decision
   alone, without the other perspectives' conclusions. In Claude Code, run
   one sub-agent per profile. Each perspective:
   - answers the profile's Questions to investigate for this decision;
   - weighs each option;
   - names the evidence behind its view, with sources;
   - gives its advice in one or two sentences, in the profile's Advice
     format.
4. Synthesize: where the perspectives agree, where they disagree and why,
   what evidence is still missing, and what to do next.
5. Call `propose_advice` with:
   - the decision;
   - `model`: the model you are running as;
   - one `advice` entry per perspective, with `expert` (the profile ID, or
     the title of a `new_experts` entry), `role`, `advice`, and the
     `long_form` and `sources` from step 3;
   - the `new_experts`;
   - the `synthesis`;
   - a rationale naming the perspectives and why they were chosen.
6. Tell the user the proposal ID and summarize the synthesis, with each view
   attributed to its profile.

**Done when** every chosen perspective has its own advice entry with its
reasoning in `long_form`, the synthesis covers every disagreement, and the
proposal exists. The owner decides; moving the decision on is a separate,
approved step.
