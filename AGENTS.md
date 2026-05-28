# Mutoon Tarteel — agent workflow

## Engineering (pstack)

For **non-trivial** work on this repo, use the **pstack** plugin:

| Task type | Entry point |
|-----------|-------------|
| New behavior / UI | `/poteto-mode` → **feature** playbook |
| Bugs / regressions | `/poteto-mode` → **bug fix** playbook (runtime evidence) |
| Performance | `/poteto-mode` → **perf** playbook |
| Cross-module design | `/architect` before coding |
| TypeScript changes | `/typescript-best-practices` |

Principles: small diffs, prove it works (typecheck / benchmark / device), no word-tap hacks without product ask.

## Tracking (Linear)

**Project:** [Mutoon Tarteel](https://linear.app/raifar/project/mutoon-tarteel-05718fd89380) (team **Raifar**)

| Label | Use |
|-------|-----|
| `Feature` | User-facing capability |
| `Bug` | Defect |
| `roadmap` | Epics / milestones |
| `asr` | Speech & alignment |
| `ui` | Layout / RTL / design |

When starting work, link or create a Linear issue. When shipping, move status and note test evidence in the issue.
