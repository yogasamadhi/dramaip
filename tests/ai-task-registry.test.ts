import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { TASK_WRITE_POLICIES } from '../packages/core/src/constants'

function read(path: string): string {
  return readFileSync(new URL(path, import.meta.url), 'utf8')
}

function extractNovelTaskTypes(source: string): string[] {
  const match = source.match(/export type NovelTaskType =([\s\S]*?)\/\/ ---------------------------------------------------------------------------\n\/\/ v0\.8/)
  assert.ok(match, 'NovelTaskType union should be present')
  return [...match[1].matchAll(/\|\s+'([^']+)'/g)].map((m) => m[1])
}

function extractTaskDefinitionKeys(source: string): string[] {
  const match = source.match(/export const TASK_DEFINITIONS:[\s\S]*?= \{([\s\S]*?)\n\}/)
  assert.ok(match, 'TASK_DEFINITIONS should be present')
  return [...match[1].matchAll(/^\s{2}([a-z0-9_]+):/gm)].map((m) => m[1])
}

test('registers every NovelTaskType exactly once in TASK_DEFINITIONS', () => {
  const types = extractNovelTaskTypes(read('../packages/core/src/types/index.ts'))
  const definitions = extractTaskDefinitionKeys(read('../packages/ai/src/prompts/loader.ts'))

  assert.deepEqual([...definitions].sort(), [...new Set(definitions)].sort(), 'task definitions should be unique')
  assert.deepEqual(definitions.sort(), types.sort())
})

test('json task definitions declare schemas', () => {
  const loader = read('../packages/ai/src/prompts/loader.ts')
  const missingSchema = [...loader.matchAll(/^\s{2}([a-z0-9_]+): \{ prompt: .*?output: 'json'(?!.*schema:)/gm)].map((m) => m[1])
  assert.deepEqual(missingSchema, [])
})

test('declares write policy for every NovelTaskType', () => {
  const types = extractNovelTaskTypes(read('../packages/core/src/types/index.ts'))
  const policyKeys = Object.keys(TASK_WRITE_POLICIES)

  assert.deepEqual(policyKeys.sort(), types.sort())
  assert.equal(TASK_WRITE_POLICIES.rewrite_chapter.policy, 'preview_then_adopt')
  assert.equal(TASK_WRITE_POLICIES.enhance_author_style.policy, 'preview_then_adopt')
  assert.equal(TASK_WRITE_POLICIES.rewrite_ai_drama_script.policy, 'preview_then_adopt')
  assert.equal(TASK_WRITE_POLICIES.enhance_script_dialogue_voice.policy, 'preview_then_adopt')
  assert.equal(TASK_WRITE_POLICIES.rewrite_shot_prompt.policy, 'preview_then_adopt')
  assert.equal(TASK_WRITE_POLICIES.analyze_text_quality.policy, 'display_only')
  assert.equal(TASK_WRITE_POLICIES.generate_ai_drama_script.policy, 'conditional_preview')
  assert.equal(TASK_WRITE_POLICIES.split_script_to_scenes.policy, 'snapshot_then_auto_write')
  assert.equal(TASK_WRITE_POLICIES.split_scene_to_shots.policy, 'snapshot_then_auto_write')
  assert.equal(TASK_WRITE_POLICIES.evaluate_ai_drama_fit.policy, 'auto_write')
})

test('creative strategy tasks have labels and task group', () => {
  const constants = read('../packages/core/src/constants/index.ts')
  for (const task of [
    'analyze_trope_freshness',
    'generate_anti_trope_variants',
    'analyze_narrative_curve',
    'generate_revision_tasks',
    'run_quality_gate',
    'simulate_audience_reaction',
    'analyze_video_cost_risk',
    'analyze_text_quality',
    'extract_case_structure',
  ]) {
    assert.match(constants, new RegExp(`${task}:`), `${task} should have a label`)
    assert.match(constants, new RegExp(`'${task}'`), `${task} should be in a task group`)
  }
  assert.match(constants, /key: 'creative_strategy'/)
})
