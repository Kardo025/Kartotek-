---
id: mind-read
title: Mind maps: read the photos (Task A/B)
version: 1
slot: vision
variables: [rules, request, views, ids]
---
Read the learner's handwritten mind map in the attached photos and answer with the complete map.json (schema "kmind-map-1") as one JSON object. Kartotek checks it with its own validator before anything is saved.

The rules you follow (from Kartotek's MINDMAP-RULES.md; where they mention files, crops or commands, ignore that part: you only answer with the JSON):
{{rules}}

The learner's request:
{{request}}

The photos, in the order attached:
{{views}}

Use these values:
{{ids}}

Regions are normalized boxes [x, y, w, h] on the upright image. Every label and line you report points to regions. Never complete writing you cannot read: keep "raw", up to 3 "candidates", and mark it unresolved. Put the reading report (at most 250 words) in "report".
