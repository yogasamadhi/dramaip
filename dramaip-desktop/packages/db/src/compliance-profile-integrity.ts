import { createHash, verify } from 'node:crypto'
import type { BuiltInComplianceRuleProfile } from '@sdns/core'

/** Public key for release-pinned offline compliance rule packs. Private signing keys never ship in the app. */
const COMPLIANCE_RULE_PROFILE_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAf42j9xIHU6yPqmdiRIEQwnepyjhIdM8/m8wRmO5I3rA=
-----END PUBLIC KEY-----
`

function unsignedPayload(profile: BuiltInComplianceRuleProfile): Record<string, unknown> {
  return {
    id: profile.id,
    version: profile.version,
    title: profile.title,
    sourceUrl: profile.sourceUrl,
    sourceStatus: profile.sourceStatus,
    publishedAt: profile.publishedAt,
    effectiveAt: profile.effectiveAt ?? null,
    regions: profile.regions,
    platforms: profile.platforms,
    requiredVisibleLabel: profile.requiredVisibleLabel,
    requiredMetadataKeys: profile.requiredMetadataKeys,
    builtIn: profile.builtIn,
  }
}

/** A malformed, tampered, or unknown offline pack fails closed before it can become active. */
export function verifyBuiltInComplianceRuleProfile(profile: BuiltInComplianceRuleProfile): boolean {
  const payload = unsignedPayload(profile)
  const expectedChecksum = `sha256:${createHash('sha256').update(JSON.stringify(payload)).digest('hex')}`
  if (profile.contentChecksum !== expectedChecksum) return false
  const signed = Buffer.from(JSON.stringify({ ...payload, contentChecksum: profile.contentChecksum }))
  try {
    return verify(null, signed, COMPLIANCE_RULE_PROFILE_PUBLIC_KEY, Buffer.from(profile.signature, 'base64'))
  } catch {
    return false
  }
}
