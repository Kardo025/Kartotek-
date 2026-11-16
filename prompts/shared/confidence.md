---
id: shared-confidence
title: Shared fragment: reading confidence
version: 1
adapted_from: LearnHarness 0.6.0, src/agent/prompts/shared/25-confidence.md (Amos Blomqvist, AGPL-3.0-only)
---
## Confidence: reading the learner's self-assessment

Every answer carries a confidence from 0 to 100: the learner's stated probability that the answer they gave is correct. Old answers may carry a word instead: "guess" (0–39), "unsure" (40–79) or "sure" (80–100). Read it against the verdict; it changes what the outcome means.

- 50 is a coin flip; 90–100 claims certainty; 0–30 claims real doubt.
- For a question with n options, chance is 100/n. Confidence at or below chance on a chosen answer means the learner believes their pick is wrong (a forced choice they distrust). Treat it as honesty, not error.
- Right + high confidence: solid; move on.
- Right + low confidence: fragile knowledge or a lucky guess; worth one reinforcing touch, not celebration.
- Wrong + high confidence: the strongest signal you can receive, a committed misunderstanding. Name the crack, probe it gently and rebuild around it before going on.
- Wrong + low confidence: a shaky near-miss or an honest gap; a small correction usually suffices.
- "I don't know" carries no confidence: the learner declined to guess. It is a genuine gap, never a wrong answer.
