"""Restricted Hermes ACP entrypoint owned by DramaIP.

The vendored Hermes source remains untouched. This adapter deliberately exposes
only the per-session DramaIP MCP server and disables Hermes local persistence.
"""

from __future__ import annotations

import asyncio
import logging
import os
import sys
from pathlib import Path


logging.basicConfig(
    level=logging.WARNING,
    stream=sys.stderr,
    format="%(levelname)s %(name)s: %(message)s",
)

project_root = os.environ.get("PYTHONPATH", "").split(os.pathsep)[0]
if project_root and project_root not in sys.path:
    sys.path.insert(0, project_root)

import acp  # noqa: E402
from acp_adapter.server import HermesACPAgent  # noqa: E402
from acp_adapter.session import SessionManager, _acp_stderr_print  # noqa: E402


class DramaIpSessionManager(SessionManager):
    def _get_db(self):
        return None

    def _persist(self, state):
        return None

    def _make_agent(
        self,
        *,
        session_id: str,
        cwd: str,
        model: str | None = None,
        requested_provider: str | None = None,
        base_url: str | None = None,
        api_mode: str | None = None,
    ):
        from run_agent import AIAgent

        provider_kind = os.environ.get("DRAMAIP_HERMES_PROVIDER", "openai")
        provider_map = {
            "openai": ("openai", "chat_completions"),
            "anthropic": ("anthropic", "anthropic_messages"),
            "google": ("gemini", "chat_completions"),
        }
        provider, selected_api_mode = provider_map.get(
            provider_kind, provider_map["openai"]
        )
        agent = AIAgent(
            platform="acp",
            enabled_toolsets=["dramaip-runtime"],
            disabled_toolsets=[
                "hermes-acp",
                "terminal",
                "browser",
                "web",
                "skills",
                "memory",
                "delegation",
            ],
            quiet_mode=True,
            session_id=session_id,
            session_db=None,
            model=model or os.environ["DRAMAIP_HERMES_MODEL"],
            provider=provider,
            api_mode=api_mode or selected_api_mode,
            base_url=base_url or os.environ.get("DRAMAIP_HERMES_BASE_URL") or None,
            api_key=os.environ["DRAMAIP_HERMES_API_KEY"],
            skip_context_files=True,
            load_soul_identity=False,
            skip_memory=True,
            skip_background_review=True,
            save_trajectories=False,
            checkpoints_enabled=False,
        )
        agent.session_cwd = cwd
        agent._print_fn = _acp_stderr_print
        agent._persist_disabled = True
        return agent


class DramaIpHermesAgent(HermesACPAgent):
    async def _register_session_mcp_servers(self, state, mcp_servers):
        expected_url = os.environ["DRAMAIP_MCP_URL"]
        expected_token = os.environ["DRAMAIP_MCP_TOKEN"]
        if not mcp_servers or len(mcp_servers) != 1:
            raise RuntimeError("DramaIP MCP server is required")
        server = mcp_servers[0]
        if getattr(server, "name", None) != "dramaip":
            raise RuntimeError("Unexpected MCP server")
        if getattr(server, "url", None) != expected_url:
            raise RuntimeError("Unexpected MCP endpoint")

        from tools.mcp_tool import register_mcp_servers
        from model_tools import get_tool_definitions

        await asyncio.to_thread(
            register_mcp_servers,
            {
                "dramaip": {
                    "url": expected_url,
                    "headers": {"Authorization": f"Bearer {expected_token}"},
                }
            },
        )
        state.agent.enabled_toolsets = ["dramaip-runtime", "mcp-dramaip"]
        state.agent.tools = get_tool_definitions(
            enabled_toolsets=state.agent.enabled_toolsets,
            disabled_toolsets=state.agent.disabled_toolsets,
            quiet_mode=True,
        )
        state.agent.valid_tool_names = {
            tool["function"]["name"] for tool in state.agent.tools or []
        }
        invalidate = getattr(state.agent, "_invalidate_system_prompt", None)
        if callable(invalidate):
            invalidate()


def main() -> None:
    os.environ["HERMES_ACP_SKIP_CONFIGURED_MCP"] = "1"
    Path(os.environ["HERMES_HOME"]).mkdir(parents=True, exist_ok=True)
    manager = DramaIpSessionManager()
    agent = DramaIpHermesAgent(session_manager=manager)
    asyncio.run(acp.run_agent(agent, use_unstable_protocol=True))


if __name__ == "__main__":
    main()
