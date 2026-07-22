# OpenAI TTS Provider Runbook

This adapter uses the documented synchronous `POST /v1/audio/speech` endpoint with a built-in voice only.
It never uploads a local voice sample, creates a custom voice, or exposes voice cloning.

## Preconditions

1. Store an authorized OpenAI API key in the Desktop Keychain integration; never place it in SQLite, a project package, a command line, test fixture, or log.
2. Enable the non-secret production feature switch only after a budget owner approves the test scope.
3. Use non-sensitive test dialogue and an OpenAI built-in voice such as `alloy`.
4. Confirm the output audio asset has a project rights record before it is adopted for delivery.

## Sandbox verification

1. Submit one short, non-sensitive line using `gpt-4o-mini-tts`, `alloy`, and `mp3`.
2. Archive the returned bytes as a new `dialogue_audio` or `narration_audio` asset; record model, voice, speed, instructions, estimated/actual cost and source fingerprint in generation lineage.
3. Confirm a second request creates a new candidate asset and does not replace an adopted manual recording.
4. Cancel only before dispatch with an `AbortSignal`; the synchronous endpoint has no documented remote cancel/poll operation, so the UI must say so.
5. Disable the feature switch after the test and preserve the archived task/cost/audit record.

## Current truth

The repository contains contract-tested provider code, but no user-authorized API key, Keychain settings connection, cost card, archive task wiring, or external sandbox evidence. Therefore OpenAI TTS is not production-enabled and LM5-14 remains partial. LM5-13 manual audio tracks remain the supported fallback.
