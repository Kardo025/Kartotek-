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
