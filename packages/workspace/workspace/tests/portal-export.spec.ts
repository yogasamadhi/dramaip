import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'
import { projectPackageSchema } from '../handlers/workspace/maintenance.ts'

describe('Portal Java export / Desktop package compatibility', () => {
  test('accepts the actual Java golden output and retains versions/volumes/read-only source identity', () => {
    const raw = JSON.parse(readFileSync(new URL('../../../../tests/fixtures/project-packages/studio-v5.json', import.meta.url), 'utf8'))
    const parsed = projectPackageSchema.parse(raw)
    expect(parsed.schemaVersion).toBe(5)
    expect(parsed.chapters[0]?.version).toBe(2)
    expect(parsed.chapters[0]?.volumeId).toBe('44444444-4444-4444-8444-444444444444')
    expect(parsed.lineage?.sourceProject.version).toBe(4)
    expect(parsed.lineage?.workflows.state).toBe('unavailable')
    expect(parsed.structure?.creatorContent).toHaveLength(1)
  })
})
