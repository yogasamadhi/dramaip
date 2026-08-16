# Pi third-party notices

DramaIP Studio includes a bundled runtime built from the frozen Pi 0.84.2 source snapshot under `desktop/vendor/pi`. Pi and its bundled dependencies retain their original licenses. The runtime is built from the lockfile and does not download dependencies when the packaged application starts.

The DramaIP adapter only exposes authenticated, run-scoped, read-only MCP tools. It does not expose shell, filesystem, browser, skills, subagents, workflows, or independent persistence.
