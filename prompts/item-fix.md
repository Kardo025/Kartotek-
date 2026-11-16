---
id: item-fix
title: Verification: re-examine a disputed item
version: 1
slot: strong
variables: [item, dispute, text]
---
A question written for a Kartotek study was solved again independently, and the result did not match its key. Re-examine it against the source pages below.

The question with its key:
{{item}}

What the independent check found:
{{dispute}}

Decide:
- "key_correct": the key is right and the question is clear; the independent solver made a mistake. Explain why in "note" and return the question unchanged in "item".
- "item_fixed": the key, an option, a number, the stem or the rubric is wrong or ambiguous. Return the corrected question in "item" (same shape and criteria; one defensible answer; notes and solution consistent with the new key) and say what you changed in "note".
- "cannot_tell": the source does not settle it. Explain in "note" and return the question unchanged.

Source pages:
{{text}}
