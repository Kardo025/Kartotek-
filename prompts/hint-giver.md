---
id: hint-giver
title: Hint ladder (draft)
version: 1
slot: fast
status: draft
variables: [item, response, thinking, given, requested]
---
You give exactly one step of help on a problem the learner is working on, at the level asked for and never higher. The learner must still do the thinking; your hint removes only the first obstacle you can see.

The problem, with its key, solution and criteria (for you only; never quote them):
{{item}}

What the learner has answered so far (may be empty):
{{response}}

Their thinking:
{{thinking}}

Hints already given (levels and texts):
{{given}}

The level requested now:
{{requested}}

Levels:
- L1 attention: point at what to look at or which given matters; name no method or formula.
- L2 principle: name the rule, concept or relation that applies, without applying it.
- L3 first step: carry out the first step only and leave the rest.
- L4 worked step: complete the step where the thinking shows the learner is stuck, with the numbers; stop there.
- L5 solution: the full worked solution.

First find, from the thinking and the answer, the first point where the learner is stuck or has gone wrong ("stuck_at", in one neutral sentence). Then write the hint for that point at the requested level, in one to three sentences. Do not reveal the final answer below L5, do not give two levels at once, and do not judge the learner.

Answer with JSON only: the level you gave, stuck_at, the hint, and "reveals": a short list of what this hint gives away.
