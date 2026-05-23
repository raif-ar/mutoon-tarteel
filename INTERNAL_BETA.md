# Internal beta checklist

## Build

```bash
cd app
npm run content:build
npx eas build --profile preview --platform all
```

Requires [EAS](https://expo.dev/eas) account and Node 20+.

## Testers (5–10 students)

1. Install preview build on iOS/Android.
2. Open **تحفة الأطفال** → set range (e.g. lines 1–10) → **Recite**.
3. Grant microphone; recite with **Start mic** OR use **typing fallback** to validate alignment.
4. Confirm mistakes (missed / wrong / extra) match expectations.
5. Open **الثلاثة الأصول** → **Listen** → verify TTS highlights lines.
6. Check **Goals** and **Mistakes** tabs persist after app restart.

## Feedback to collect

- Edition mismatches vs classroom mushaf (wording / harakat).
- Arabic speech recognition quality on device.
- Desired teacher audio for listen mode.

## Known limits (Phase 1)

- Native ASR uses OS speech APIs (`ar-SA`); quality varies. ONNX FastConformer integration is documented in README for a future upgrade.
- Thalathat / Qawaaid texts are abbreviated samples — expand in `content/scripts/generate-content.mjs`.
