import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import {
  FILE_IMPORT_POLICIES,
  assertAllowedExtension,
  assertAllowedSize,
  assertReadableImportFile,
  assertRemoteImportResource,
  truncateImportedText,
} from '../apps/desktop/electron/file-security'

test('project package import enforces extension and size limits', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'sdns-file-security-'))
  try {
    const ok = join(dir, 'project.sdnspkg')
    const bad = join(dir, 'project.zip')
    writeFileSync(ok, '{"meta":{"format":"sdns-project-package"}}')
    writeFileSync(bad, 'zip')

    await assert.doesNotReject(() => assertReadableImportFile('projectPackage', ok))
    await assert.rejects(() => assertReadableImportFile('projectPackage', bad), /项目包仅支持/)
    assert.throws(
      () => assertAllowedSize('projectPackage', FILE_IMPORT_POLICIES.projectPackage.maxBytes + 1, 'huge.sdnspkg'),
      /项目包过大/,
    )
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('case study import shares document extension checks and text truncation', () => {
  assert.equal(assertAllowedExtension('caseStudyDocument', 'notes.md'), '.md')
  assert.equal(assertAllowedExtension('caseStudyDocument', 'notes.DOCX'), '.docx')
  assert.throws(() => assertAllowedExtension('caseStudyDocument', 'notes.pdf'), /样本文档仅支持/)

  const limit = FILE_IMPORT_POLICIES.caseStudyDocument.maxTextChars ?? 0
  const truncated = truncateImportedText('caseStudyDocument', 'x'.repeat(limit + 5))
  assert.equal(truncated.text.length, limit)
  assert.equal(truncated.truncated, true)
})

test('video asset archive rejects unsafe remote extensions and oversized responses', () => {
  assert.equal(
    assertRemoteImportResource('videoAsset', {
      url: 'https://media.example.com/result.mp4',
      contentType: 'video/mp4',
      contentLength: 1024,
    }),
    '.mp4',
  )
  assert.throws(
    () => assertRemoteImportResource('videoAsset', { url: 'https://media.example.com/result.exe', ext: '.exe' }),
    /视频素材远程资源类型不支持/,
  )
  assert.throws(
    () =>
      assertRemoteImportResource('videoAsset', {
        url: 'https://media.example.com/result.mp4',
        ext: '.mp4',
        contentLength: FILE_IMPORT_POLICIES.videoAsset.maxBytes + 1,
      }),
    /视频素材过大/,
  )
})
