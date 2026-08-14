# OpenAI TTS Provider Runbook

This adapter uses the documented synchronous `POST /v1/audio/speech` endpoint with a built-in voice only.
It never uploads a local voice sample, creates a custom voice, or exposes voice cloning.

## Preconditions

1. In **设置 → TTS 配音设置**, store an authorized OpenAI API key in the Desktop Keychain integration; never place it in SQLite, a project package, a command line, test fixture, or log.
2. Enable the non-secret production feature switch only after a budget owner approves the test scope.
3. Use non-sensitive test dialogue and an OpenAI built-in voice such as `alloy`.
4. Confirm the output audio asset has a project rights record before it is adopted for delivery.

## Sandbox verification

1. Submit one short, non-sensitive line using `gpt-4o-mini-tts`, `alloy`, and `mp3`.
2. Archive the returned bytes as a new `dialogue_audio` or `narration_audio` asset; record model, voice, speed, instructions and source fingerprint in generation lineage. Keep cost as `unknown` until it is reconciled with the Provider billing record—do not invent an amount.
3. Confirm a second request creates a new candidate asset and does not replace an adopted manual recording.
4. Cancel only by stopping local waiting with an `AbortSignal`; the synchronous endpoint has no documented remote cancel/poll operation, so inspect the Provider billing record before treating the cost as settled.
5. Disable the feature switch after the test and preserve the archived task/cost/audit record.

## Current truth

The repository now includes a local encrypted credential-vault settings boundary, persisted/cancelable TTS task runtime, candidate-audio archiver, credential-free lineage and unknown-cost ledger, plus contract, migration, E2E and UI coverage. It still has no account-owner-authorized API key, billing/region confirmation, authorized sandbox dialogue/voice material, or external sandbox evidence. Therefore OpenAI TTS remains disabled by default and LM5-14 remains `partial`; LM5-13 manual audio tracks remain the supported fallback.
