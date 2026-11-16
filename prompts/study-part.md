---
id: study-part
title: Study writing: part overview
version: 1
slot: strong
variables: [study, part, position, topics, outcomes, units, several]
---
Write the overview of one part of a Kartotek study. It is shown with every topic's Priming and at the end of the part.

Study:
{{study}}

Part:
{{part}}
{{position}}

Topics of this part (with their previews):
{{topics}}

Outcomes and criteria of this part:
{{outcomes}}

Units of this part:
{{units}}

Write:
- "orientation": "place" (where this part sits in the study), "purpose" (what the learner will be able to do), "prereq" (what it builds on, or "").
- "summary": "md" with 5–10 sentences from the source, the key terms in **bold**; "keywords": 5–9 terms, each with a short "definition" from the source and "ref" (page or slide).
- "connect_blocks": does this part have several topics? {{several}} If yes, write one or two blocks titled "Putting part … together" (usually "keypoints" with "items", or "text" with "md") that show how the topics fit together, as the source supports, with "refs" (unit ids). If no, answer []. Fill unused block fields with "" or [], and tone "none".
- "feynman": an overview prompt ("Explain … to a classmate who missed this part") and the criterion ids it should cover.
