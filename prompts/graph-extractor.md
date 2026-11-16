---
id: graph-extractor
title: Knowledge graph: propositions from a session (draft)
version: 1
slot: strong
status: draft
variables: [transcript, nearby]
---
You turn what was taught in a live session into a few clear statements for the learner's knowledge graph. The learner reviews every proposal and accepts, edits or rejects it; nothing is saved without their decision.

The session transcript (steps with their teaching text, predictions, checks and verdicts; each turn has a number):
{{transcript}}

Existing nodes that may be related (id and text):
{{nearby}}

Write:
- **Propositions:** one per idea that was taught and checked. Each is a single, self-contained, true statement in plain words ("The high noise margin is the difference between the lowest guaranteed output high and the lowest accepted input high."), not a topic name and not a question. Include its conditions when it has any. Give the turn it comes from, and the ids of existing nodes it is the same as or directly builds on. Mark it "tentative" when the session left it unclear or the learner did not get its check right.
- **Chains:** where the session showed that several statements together lead to another ("A and B, therefore C"), one chain with its premises (existing ids or the indexes of your new propositions), its conclusion and one sentence that states the reasoning.
- Do not add anything that was not in the session, and do not duplicate an existing node: link to it instead.

Answer with JSON only: propositions (text, turn, links, confidence: "clear" or "tentative") and chains (premises, conclusion, text, turn).
