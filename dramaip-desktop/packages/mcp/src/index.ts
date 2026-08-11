export const DRAMAIP_MCP_TOOLS = [
  "dramaip_get_project",
  "dramaip_get_chapter",
  "dramaip_list_chapters",
  "dramaip_list_characters",
  "dramaip_search_story_bible",
  "dramaip_analyze_continuity",
  "dramaip_search_project",
  "dramaip_get_adaptation",
  "dramaip_list_episodes",
  "dramaip_get_script",
  "dramaip_list_scenes",
  "dramaip_list_shots",
  "dramaip_list_asset_metadata",
] as const;

export type DramaIpMcpTool = (typeof DRAMAIP_MCP_TOOLS)[number];

export interface McpAccessClaims {
  readonly tokenId: string;
  readonly userId: string;
  readonly projectId: string;
  readonly sessionId: string;
  readonly runId: string;
  readonly contextSnapshotId: string;
  readonly tools: readonly DramaIpMcpTool[];
  readonly expiresAt: number;
  readonly maxResultBytes: number;
}

export type McpAuthorizationResult =
  | { readonly allowed: true; readonly claims: McpAccessClaims }
  | {
      readonly allowed: false;
      readonly code:
        "TOKEN_EXPIRED" | "TOOL_DENIED" | "PROJECT_DENIED" | "RESULT_TOO_LARGE";
      readonly message: string;
    };

export function authorizeMcpTool(input: {
  claims: McpAccessClaims;
  tool: DramaIpMcpTool;
  projectId: string;
  now?: number;
}): McpAuthorizationResult {
  const now = input.now ?? Date.now();
  if (input.claims.expiresAt <= now)
    return {
      allowed: false,
      code: "TOKEN_EXPIRED",
      message: "智能引擎读取令牌已过期",
    };
  if (input.claims.projectId !== input.projectId)
    return {
      allowed: false,
      code: "PROJECT_DENIED",
      message: "智能引擎无权读取其他项目",
    };
  if (!input.claims.tools.includes(input.tool))
    return {
      allowed: false,
      code: "TOOL_DENIED",
      message: "当前任务未获准使用此读取工具",
    };
  return { allowed: true, claims: input.claims };
}

export function enforceMcpResultLimit(
  claims: McpAccessClaims,
  utf8Bytes: number,
): McpAuthorizationResult {
  if (utf8Bytes > claims.maxResultBytes)
    return {
      allowed: false,
      code: "RESULT_TOO_LARGE",
      message: "读取结果超过当前任务允许的大小",
    };
  return { allowed: true, claims };
}
