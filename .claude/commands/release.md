---
description: Cut and publish a new ccws release (analyze commits → suggest version → CHANGELOG → tag → push)
argument-hint: "[--dry-run]"
---

Use the **release** skill to cut and publish a new ccws release now.

Arguments: $ARGUMENTS

If `--dry-run` is present in the arguments, run the skill in dry-run mode: perform the analysis and draft the CHANGELOG, then stop — do not bump `package.json`, commit, tag, or push.
