# Mutoon content package (MUL)

Versioned Arabic matn text for the memorization app. Inspired by [QUL](https://qul.tarteel.ai/) patterns: canonical edition metadata, word-level structure, optional line audio timestamps.

## Layout

```
content/
  schema/matn.schema.json   # JSON Schema
  mutoon/*.json             # One file per matn
  manifest.json             # Index of bundled matns
```

## Adding a matn

1. Pick one print edition and record it in `edition` and `source_url`.
2. Author UTF-8 with one bayt/sentence per line.
3. Run `npm run content:build` from `app/` to validate and regenerate word tokens if needed.
4. Bump `version` when wording or tokenization changes.

## Edition notes

| Matn | Edition |
|------|---------|
| `tuhfat_al_atfal` | [Wikisource](https://ar.wikisource.org/wiki/تحفة_الأطفال) (oldid 594187) |
| `thalathat_al_usool` | Common matn wording (verify against your mushaf) |
| `qawaid_al_arba` | Opening section sample for MVP |
