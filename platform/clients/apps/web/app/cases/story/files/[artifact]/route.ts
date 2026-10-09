import { createHash } from 'node:crypto'
import { STORY_CASE_ARTIFACTS, storyCaseArtifact } from '../../../../../lib/story-case'

// Public, fixed author-written display files. No account, model, DB or upload.
export const dynamic = 'force-static'
export const dynamicParams = false

export function generateStaticParams() {
  return STORY_CASE_ARTIFACTS.map(({ file }) => ({ artifact: file }))
}

export async function GET(_request: Request, context: { params: Promise<{ artifact: string }> }) {
  const { artifact: name } = await context.params
  const artifact = storyCaseArtifact(name)
  if (!artifact) return new Response('Example file not found', { status: 404, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'X-Content-Type-Options': 'nosniff' } })
  return new Response(artifact.body, {
    headers: {
      'Content-Type': artifact.mediaType,
      'Content-Disposition': `attachment; filename="${artifact.file}"`,
      'Cache-Control': 'public, max-age=0, must-revalidate',
      'X-Content-Type-Options': 'nosniff',
      'X-DramaIP-Example-Evidence': 'author-written-fictional',
      ETag: `"sha256-${createHash('sha256').update(artifact.body).digest('hex')}"`,
    },
  })
}
