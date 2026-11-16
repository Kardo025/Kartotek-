---
id: lesson-items
title: End-of-lesson test: items for one part
version: 1
slot: strong
variables: [lesson, part, objectives, text]
---
Write the items of one part of an end-of-lesson test. The test does not teach; solutions are shown only at the end.

Lesson:
{{lesson}}

Part:
{{part}}

Objectives (give one entry per objective, with its id as "ref"):
{{objectives}}

For every objective:
- "recall": a write-from-memory item asked before the multiple-choice items. "prompt" asks for production, not recognition; "model_answer" is 1–3 sentences; "key_points" are 2–4 checkable points.
- "items": multiple-choice items with exactly 4 options and one correct option ("correct" is its index, 0–3).
  - role "test": a fact objective gets 1, a concept objective 2 (understand and transfer), a problem objective 2–3 (apply or calculate, possibly transfer).
  - role "retest": 2–3 more items that are new tasks (not reworded or reshuffled test items), used later for re-tests.
  - "level": understand, apply, transfer or calculate.
  - Distractors come from real confusions in the lesson; never filler, never "all of the above" or "none of the above". If three plausible wrong options cannot be written, test the idea through the recall item instead. Options are parallel in grammar and length, and the key is not in the stem.
  - "solution" explains the answer with references; "distractor_notes" has 4 entries in option order, and the entry at the correct index starts with "Correct". Never refer to options by letter or position ("option B"): name their content, because Kartotek may reorder the options.
  - Numbers in new situations are allowed when they apply the lesson's own formulas; new facts are not. Solve every item yourself before you fix its key.

Lesson sources:
{{text}}
