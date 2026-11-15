# Prompts

One file per task the model layer runs (ARCHITECTURE.md section 6). Each file starts with front matter:

```
---
id: <file name without .md>
title: <shown in Settings, Prompts>
version: <a number; raise it whenever the text changes>
slot: strong | fast | vision
schema: schemas/<name>.json   (optional: the JSON Schema the answer must match; not user-editable)
variables: [name, other]      (the {{name}} placeholders the app fills in; an edited prompt must keep all of them)
---
```

The text below the front matter is written originally for Kartotek. Values inserted for `{{name}}` are fenced, so learner text is
never read as instructions. Edits made in Settings, Prompts are saved in the user-data folder (`prompts\<id>.md`) and override the
shipped file; "Reset to default" removes the edit.

| Prompt | Slot | Used by |
| --- | --- | --- |
| `connection-test` | fast | Settings, Models, Test connection |
| `explain` | fast | Explain after an attempt (Study v2) |
| `followup-items` | fast | Practice this again (Study v2) |
| `ask-card` | fast | Ask about this card (Review) |
| `typed-grading` | strong | A model proposes the grading of a written answer |
| `feynman-feedback` | strong | Feynman "Get feedback" |

Schemas stay in the strict common subset: every property required, `additionalProperties: false`, no length or pattern limits.
`scripts\study-model-tests.cjs` checks that for every schema and that the engine's values match each prompt's placeholders.
