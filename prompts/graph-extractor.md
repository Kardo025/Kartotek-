---
id: graph-extractor
title: Knowledge graph: propositions from a session (draft)
version: 2
slot: strong
status: draft
includes: [shared/accuracy]
adapted_from: LearnHarness 0.6.0, src/agent/subagents/extraction.ts (EXTRACTION_CORE, the session and notes extractor goals, the auditor's identity rules) and src/core/contracts/graph.ts (Amos Blomqvist, AGPL-3.0-only)
variables: [transcript, nearby]
---
# Extracting the knowledge graph

You turn a live session (or a notes file) into the learner's knowledge graph: the **core ideas** it taught and the **chains of reasoning** that derive them. The learner reviews every proposal and accepts, edits or rejects it; nothing is saved without their decision.

The source: the session's teaching, each passage labelled with its turn id (or a notes file, verbatim):
{{transcript}}

Existing graph records that may be the same ideas (Kartotek found them by text similarity; id, short name, statement, other phrasings):
{{nearby}}

## What goes in

- **The goal:** uncover the source's core ideas and show how they derive from the foundations. Extract the load-bearing ideas, what a reference on the subject would teach, not the full run of the conversation. Examples, notation glosses and restatements that no argument needs are not core ideas. For notes: keep the meaningful definitions, formulas, claims and explanations, including ideas with no derivation; record a stated idea as a proposition rather than inventing an argument for it.
- **Chains:** each chain is premises that **jointly entail** a conclusion. Entailment is the only link that earns a chain; a historical or narrative connection (who argued what, how the explanation unfolded) is not one. The graph points upward: foundational ideas at the bottom, derived ideas above them. Premises within one chain are used together; independent arguments for the same conclusion are separate chains. A conclusion may reappear as a premise of later chains.
- **Only true ideas about the world:** never anything about the learner, the teacher or the session ("the learner understands X" is not knowledge; X is). A misunderstanding that came up enters as its true correction. Each statement is one self-contained idea at full precision.
- **Standalone:** every idea must make sense to a reader who never saw this source; names and statements may not lean on the session's scaffolding (step numbers, plan node names).

## Identity

For each new idea, decide whether one of the existing records above already states the same knowledge point (a paraphrase, a compression or a different explanation of the same thing counts; shared subject matter alone does not). If it does, link to it instead of creating a new one; the existing name and statement stay, and your wording is kept as another phrasing. A practical judgement is enough, not a proof of logical equivalence.

## What to answer

Answer with JSON only:
- "propositions": every new core idea with a short "name" (a compact handle like a glossary headword), a precise "statement", the "turn" it comes from, "link_to" (an existing id when it is the same idea, else null) and "confidence" ("clear", or "tentative" when the session left it unclear or the learner did not get its check right);
- "chains": "premises" (existing ids or indexes of your new propositions), "conclusion", and a one-sentence "text" stating the reasoning.
Use [] where there is nothing.
