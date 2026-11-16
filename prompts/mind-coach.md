---
id: mind-coach
title: Mind maps: one coaching turn (Task C)
version: 1
slot: vision
variables: [rules, request, ids]
---
Write one coaching turn for the learner's mind map and answer with the complete turn file (schema "kmind-turn-1") as one JSON object. The attached photos are the map's views. Kartotek checks the turn with its own validator before it is saved.

The rules you follow (from Kartotek's MINDMAP-RULES.md; ignore any part about files or commands: you only answer with the JSON):
{{rules}}

The request, with the map's current state, the learner's corrections and message:
{{request}}

Use these values:
{{ids}}

One focused question or one bounded hint; do not exceed the allowed hint level unless the learner asked for an explanation. Never invent a relation, and never judge correctness without a source.
