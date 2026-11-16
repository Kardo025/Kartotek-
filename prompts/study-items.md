---
id: study-items
title: Study writing: practice items for one topic
version: 1
slot: strong
variables: [study, topic, outcomes, lesson, units, text]
---
Write the practice items for one topic of a Kartotek study. The learner answers them after the lesson, one at a time.

Study:
{{study}}

Topic:
{{topic}}

Outcomes and criteria (every criterion needs at least one item; list in "criteria" the ids each item assesses):
{{outcomes}}

What the lesson taught:
{{lesson}}

Units (ids for "units"):
{{units}}

Rules:
- Prefer the source's own exercises ("origin": "imported"; keep their wording and numbers; "source_ref" says where they are), then adapted ones ("adapted": reworded or new numbers), then new scenarios ("generated": fully specified, testing a rule the source gives, with no outside facts). If an item needs a value the source does not give, state it in the stem.
- Choose the format from the performance: "mcq_single" (identify, distinguish, choose: 2–6 options, exactly one key), "mcq_multi" (several true statements: at least 2 keys and at least one wrong option), "typed" (recall a term, explain, justify, compare: a rubric), "numeric" (calculate: "numeric" with "value", "tol" and "unit").
- Options: give each an id ("a", "b", …); use as many as there are plausible distractors, never filler, never "all of the above" or "none of the above". Alternatives are parallel in grammar, length and detail. The stem can be answered before reading the options and never contains the key.
- "option_notes": one note per option id that says why it is right or wrong, with the page or slide; the note of the correct option starts with "Correct". A note that says "this comes from using X instead of Y" must really give that option's value when you make that error.
- Check absolutes ("always", "only", "must") against the source. State the convention when several are valid (rounding, units, signs).
- Typed items: "rubric.criteria" are checkable meaning statements (each with an "id" from the criteria above, "text" and "required"), "accept" lists valid alternative phrasings, "contradictions" lists critical errors that fail the answer, "model" is a model answer.
- Help for practice mode: "hints" 1–3, from a nudge to the method, none giving the answer; "steps" as do/why pairs; "solution" the full worked answer with page or slide references. Never refer to options by their letter or position in the solution or the notes ("the second option"): name their content.
- "performance": identify, distinguish, explain, solve, transfer or recall; "difficulty": basic, medium or hard; "integrates": []. Fill the fields a format does not use with "", [] or 0.
- Solve every item yourself from the source before you fix its key.

Source pages:
{{text}}
