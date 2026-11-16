---
id: study-topic
title: Study writing: lesson for one topic
version: 1
slot: strong
variables: [study, part, topic, outcomes, units, conventions, others, text]
---
Write the lesson material for one topic of a Kartotek study. The learner sees this topic alone, so it must stand on its own, and it teaches only this topic (the other topics are listed so you leave their content to them).

Study:
{{study}}

Part:
{{part}}

Topic:
{{topic}}

Outcomes and criteria of this topic:
{{outcomes}}

Units of this topic (cite their ids in "refs"):
{{units}}

Standing conventions of the source:
{{conventions}}

Other topics of the study (do not teach them here):
{{others}}

Write:
1. "priming": a preview shown before the lesson. "summary_md": 2–4 sentences with the key terms in **bold** and the page or slide in brackets, for example "(p. 4)". It must not give away the answer to the recall prompt. "keywords": 1–4 terms, each with a one-line "definition" from the source and "ref" (the page or slide). "purpose": one line on why this topic matters. "prereq": what the learner should already know, or "".
2. "blocks": the lesson, in a sensible teaching order. Every claim comes from the source; cite the units in "refs" and the page or slide numbers in "slides" (integers). Use the block that fits the content:
   - "text": an explanation in "md".
   - "keypoints": a short list in "items", with an optional "title".
   - "steps": an ordered procedure in "items".
   - "compare": a table with "columns" and "rows" (each row has one cell per column), for contrasts the source supports.
   - "worked": a worked example with "problem", "steps" (each with "do" and "why") and "answer"; use the source's own example where there is one, or the source's rule applied to new numbers.
   - "example" or "analogy": in "md"; they add no new facts.
   - "callout": "tone" "dikkat" for a warning (a common confusion, or a visible misprint in the source: quote it, give the correction and why) or "ipucu" for a tip.
   Fill the fields a block does not use with "" or []; use "none" as the tone of blocks that are not callouts. Every unit of this topic must be cited by at least one block. Do not refer to "the slide" or "the lecturer"; teach the content.
3. "recall": the topic's free-recall card, asked without notes. "prompt" asks for production, not recognition; for a "problem" topic it is a problem to solve (asking for the result and the rule used). "model_answer": 1–3 sentences. "key_points": 2–4 checkable points. "origin": "imported" if it is the source's own exercise, "adapted" if changed from one, else "generated"; "source_ref": where the exercise is, or "".
4. "feynman": "prompt" asks the learner to explain this topic to a friend in a concrete situation ("Explain … to a friend who …"); "criteria": the criterion ids of this topic the explanation should cover.

Source pages for this topic:
{{text}}
