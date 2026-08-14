import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { TextDiffPreviewPayload } from '../packages/core/src/types'
import { applyGeneratedArtifact } from '../packages/ai/src/persistence'
import { createSaveResultNode } from '../packages/ai/src/nodes/save-result.node'

function createPreviewDeps() {
  const calls: string[] = []
  return {
    calls,
    deps: {
      repos: {
        db: {},
        chapter: {
          updateChapterContent: (_db: unknown, id: string, content: string) => {
            calls.push(`chapter:${id}:${content}`)
            return { id, content }
          },
        },
        script: {
          upsertScriptByEpisode: (_db: unknown, data: { episodeId: string; content: string }) => {
            calls.push(`script:${data.episodeId}:${data.content}`)
            return { id: 'script-1', ...data }
          },
        },
        shot: {
          updateShot: (_db: unknown, id: string, patch: Record<string, unknown>) => {
            calls.push(`shot:${id}:${JSON.stringify(patch)}`)
            return { id, ...patch }
          },
          appendPromptVersion: (_db: unknown, data: { shotId: string; videoPrompt?: string }) => {
            calls.push(`prompt-version:${data.shotId}:${data.videoPrompt ?? ''}`)
            return { id: 'pv-1', ...data }
          },
        },
        creative: {
          createContentVersion: (_db: unknown, data: { targetKind: string; targetId: string; content: string }) => {
            calls.push(`version:${data.targetKind}:${data.targetId}:${data.content}`)
            return { id: 'cv-1', ...data }
          },
        },
      },
    } as never,
  }
}

test('returns chapter text preview without writing content', async () => {
  const { deps, calls } = createPreviewDeps()
  const save = createSaveResultNode(deps)

  const out = await save({
    projectId: 'p1',
    chapterId: 'c1',
    taskType: 'rewrite_chapter',
    currentChapter: { id: 'c1', title: '第一章', content: '旧正文' },
    parsedOutput: '新正文',
  } as never)

  assert.deepEqual(calls, [])
  assert.equal(out.result?.kind, 'text_preview')
  assert.deepEqual((out.result?.data as TextDiffPreviewPayload).currentContent, '旧正文')
  assert.deepEqual((out.result?.data as TextDiffPreviewPayload).nextContent, '新正文')

  const styleOut = await save({
    projectId: 'p1',
    chapterId: 'c1',
    taskType: 'enhance_author_style',
    currentChapter: { id: 'c1', title: '第一章', content: '旧正文' },
    parsedOutput: '作者风格强化正文',
  } as never)

  assert.deepEqual(calls, [])
  assert.equal(styleOut.result?.kind, 'text_preview')
  assert.deepEqual((styleOut.result?.data as TextDiffPreviewPayload).nextContent, '作者风格强化正文')
})

test('returns script and shot text previews without overwriting records', async () => {
  const { deps, calls } = createPreviewDeps()
  const save = createSaveResultNode(deps)

  const scriptOut = await save({
    projectId: 'p1',
    adaptationProjectId: 'a1',
    episodeId: 'e1',
    taskType: 'rewrite_ai_drama_script',
    currentEpisode: { id: 'e1', episodeNumber: 1, title: '第一集' },
    currentScript: { id: 's1', content: '旧剧本' },
    parsedOutput: { content: '新剧本', hook: '新钩子' },
  } as never)
  const dialogueOut = await save({
    projectId: 'p1',
    adaptationProjectId: 'a1',
    episodeId: 'e1',
    taskType: 'enhance_script_dialogue_voice',
    currentEpisode: { id: 'e1', episodeNumber: 1, title: '第一集' },
    currentScript: { id: 's1', content: '旧剧本' },
    parsedOutput: { content: '对白风格强化剧本', hook: '新钩子' },
  } as never)
  const shotOut = await save({
    projectId: 'p1',
    adaptationProjectId: 'a1',
    episodeId: 'e1',
    sceneId: 'scene1',
    shotId: 'shot1',
    taskType: 'rewrite_shot_prompt',
    currentShot: { id: 'shot1', shotNumber: 1, videoPrompt: '旧 prompt' },
    parsedOutput: { videoPrompt: '新 prompt' },
  } as never)

  assert.deepEqual(calls, [])
  assert.equal(scriptOut.result?.kind, 'text_preview')
  assert.equal((scriptOut.result?.data as TextDiffPreviewPayload).nextContent, '新剧本')
  assert.equal(dialogueOut.result?.kind, 'text_preview')
  assert.equal((dialogueOut.result?.data as TextDiffPreviewPayload).nextContent, '对白风格强化剧本')
  assert.equal(shotOut.result?.kind, 'text_preview')
  assert.match((shotOut.result?.data as TextDiffPreviewPayload).nextContent, /新 prompt/)
})

test('applies text preview only after explicit adoption', async () => {
  const { deps, calls } = createPreviewDeps()
  const preview: TextDiffPreviewPayload = {
    projectId: 'p1',
    targetKind: 'chapter',
    targetId: 'c1',
    taskType: 'polish_chapter',
    currentContent: '旧正文',
    nextContent: '润色正文',
  }

  const out = await applyGeneratedArtifact(deps, {
    projectId: 'p1',
    taskType: 'polish_chapter',
    data: preview,
  })

  assert.equal(out.kind, 'polish_chapter')
  assert.deepEqual(calls, ['chapter:c1:润色正文', 'version:chapter:c1:润色正文'])
})
