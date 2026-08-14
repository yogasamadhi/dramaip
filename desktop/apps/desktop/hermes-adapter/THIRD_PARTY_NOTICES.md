# Hermes Agent third-party notices

DramaIP Studio includes an unmodified source snapshot of Hermes Agent 0.20.1
and a platform-specific, lockfile-resolved Python runtime closure. Hermes Agent
is licensed under the MIT License; its upstream `LICENSE` is distributed beside
this notice.

The runtime dependency inventory is generated from the upstream `uv.lock` using
uv 0.9.28 and stored as `requirements.lock.txt` in the packaged Hermes runtime.
License metadata and license files supplied by Python wheels remain in their
corresponding `*.dist-info` directories. These components retain their original
copyright and license terms.

The embedded CPython 3.11.15 distribution is produced by Astral's
`python-build-standalone` release 20260807 and is subject to CPython's PSF
license and the build distribution's MPL-2.0 terms. Its platform archive and
SHA-256 digest are pinned in `vendor/hermes-agent.lock.json`.

Notable protocol/runtime dependencies include Agent Client Protocol 0.9.0,
Model Context Protocol 1.28.1, OpenAI Python SDK 2.24.0, Anthropic Python SDK
0.87.0, HTTPX 0.28.1, Pydantic 2.13.4, and PyYAML 6.0.3.
