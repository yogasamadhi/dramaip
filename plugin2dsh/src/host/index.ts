/**
 * Host face of the DramaIP DSH plugin: registers the `dramaip_text_stats`
 * Agent tool. Registration is an effect of this plugin's fiber, so disabling
 * or removing the plugin unregisters the tool.
 */
import { defineTool, type ToolDefinition } from '@deepseek-ai/dsh-tools'
import { textStats, type TextStats } from '../shared/stats.ts'

/** The Host services this plugin waits for; `inject` names them. */
interface HostContext {
  readonly tools: { register(definition: ToolDefinition): unknown }
}

export const name = 'dramaip-dsh-plugin'
export const inject = ['tools']

export const TOOL_NAME = 'dramaip_text_stats'

export function apply(ctx: HostContext): void {
  ctx.tools.register(defineTool({
    name: TOOL_NAME,
    description: 'Count characters, CJK characters, Latin words, paragraphs and dialogue lines in a chapter, scene or screenplay excerpt, and estimate its reading time. Pass the text itself; the tool reads no files.',
    parameters: {
      text: { type: 'string', required: true, description: 'The chapter, scene or excerpt to measure' },
    },
    output: {
      schema: {
        type: 'object',
        properties: {
          characters: { type: 'integer', required: true },
          cjkCharacters: { type: 'integer', required: true },
          latinWords: { type: 'integer', required: true },
          paragraphs: { type: 'integer', required: true },
          dialogueLines: { type: 'integer', required: true },
          readingMinutes: { type: 'integer', required: true },
        },
        additionalProperties: false,
      },
      render: (_args, value: TextStats) => [{ type: 'text', text: describe(value) }],
    },
    async execute(args, exec) {
      exec.signal.throwIfAborted()
      return textStats(args.text)
    },
  }))
}

function describe(stats: TextStats): string {
  return [
    `characters: ${stats.characters}`,
    `CJK characters: ${stats.cjkCharacters}`,
    `Latin words: ${stats.latinWords}`,
    `paragraphs: ${stats.paragraphs}`,
    `dialogue lines: ${stats.dialogueLines}`,
    `reading time: about ${stats.readingMinutes} min`,
  ].join('\n')
}
