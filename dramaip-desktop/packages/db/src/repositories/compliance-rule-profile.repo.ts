import { desc, eq } from 'drizzle-orm'
import type { BuiltInComplianceRuleProfile, ComplianceRuleProfile } from '@sdns/core'
import type { DB } from '../client'
import { complianceRuleProfiles } from '../schema'
import { verifyBuiltInComplianceRuleProfile } from '../compliance-profile-integrity'
import { genId, insertRow, now, parseJsonArray, stringifyArray, updateRows } from './util'

type Row = typeof complianceRuleProfiles.$inferSelect

function fromRow(row: Row): ComplianceRuleProfile {
  return {
    id: row.id,
    version: row.version,
    title: row.title,
    sourceUrl: row.sourceUrl,
    sourceStatus: row.sourceStatus as ComplianceRuleProfile['sourceStatus'],
    publishedAt: row.publishedAt,
    effectiveAt: row.effectiveAt ?? undefined,
    regions: parseJsonArray(row.regions),
    platforms: parseJsonArray(row.platforms),
    requiredVisibleLabel: row.requiredVisibleLabel,
    requiredMetadataKeys: parseJsonArray(row.requiredMetadataKeys),
    contentChecksum: row.contentChecksum,
    signature: row.signature,
    integrityStatus: row.integrityStatus as ComplianceRuleProfile['integrityStatus'],
    active: row.active,
    builtIn: row.builtIn,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

export function listComplianceRuleProfiles(db: DB): ComplianceRuleProfile[] {
  return db.select().from(complianceRuleProfiles).orderBy(desc(complianceRuleProfiles.active), desc(complianceRuleProfiles.publishedAt)).all().map((row) => fromRow(row as Row))
}

export function getComplianceRuleProfile(db: DB, id: string): ComplianceRuleProfile | undefined {
  const row = db.select().from(complianceRuleProfiles).where(eq(complianceRuleProfiles.id, id)).get()
  return row ? fromRow(row as Row) : undefined
}

export function getActiveComplianceRuleProfile(db: DB): ComplianceRuleProfile | undefined {
  const row = db.select().from(complianceRuleProfiles).where(eq(complianceRuleProfiles.active, true)).orderBy(desc(complianceRuleProfiles.updatedAt)).get()
  return row ? fromRow(row as Row) : undefined
}

/** Re-check persisted data at use time; a manually altered SQLite row cannot inherit trusted status. */
export function isVerifiedComplianceRuleProfile(profile: ComplianceRuleProfile): boolean {
  return profile.builtIn && profile.integrityStatus === 'verified' && verifyBuiltInComplianceRuleProfile(profile)
}

/** Only a checksum-verified official profile can become the global offline enforcement default. */
export function activateComplianceRuleProfile(db: DB, id: string): ComplianceRuleProfile | undefined {
  const profile = getComplianceRuleProfile(db, id)
  if (!profile || !isVerifiedComplianceRuleProfile(profile) || profile.sourceStatus !== 'official') return undefined
  const ts = now()
  db.transaction((tx) => {
    updateRows(tx as DB, complianceRuleProfiles, { active: false, updatedAt: ts }).run()
    updateRows(tx as DB, complianceRuleProfiles, { active: true, updatedAt: ts }).where(eq(complianceRuleProfiles.id, id)).run()
  })
  return getComplianceRuleProfile(db, id)
}

/** Built-in rule packages are release-pinned trust anchors; user data is never overwritten. */
export function upsertBuiltInComplianceRuleProfiles(db: DB, profiles: BuiltInComplianceRuleProfile[]): ComplianceRuleProfile[] {
  const result: ComplianceRuleProfile[] = []
  const ts = now()
  for (const profile of profiles) {
    const existing = db.select().from(complianceRuleProfiles).where(eq(complianceRuleProfiles.version, profile.version)).get() as Row | undefined
    if (existing && !existing.builtIn) {
      result.push(fromRow(existing))
      continue
    }
    const integrityStatus: ComplianceRuleProfile['integrityStatus'] = profile.integrityStatus === 'verified' && verifyBuiltInComplianceRuleProfile(profile)
      ? 'verified'
      : 'invalid'
    const fields = {
      version: profile.version, title: profile.title, sourceUrl: profile.sourceUrl, sourceStatus: profile.sourceStatus,
      publishedAt: profile.publishedAt, effectiveAt: profile.effectiveAt ?? null,
      regions: stringifyArray(profile.regions), platforms: stringifyArray(profile.platforms),
      requiredVisibleLabel: profile.requiredVisibleLabel, requiredMetadataKeys: stringifyArray(profile.requiredMetadataKeys),
      contentChecksum: profile.contentChecksum, signature: profile.signature, integrityStatus, builtIn: true, updatedAt: ts,
    }
    if (existing) {
      const [updated] = updateRows(db, complianceRuleProfiles, fields).where(eq(complianceRuleProfiles.id, existing.id)).returning().all()
      result.push(fromRow(updated as Row))
    } else {
      const [created] = insertRow(db, complianceRuleProfiles, { id: profile.id || genId(), ...fields, active: false, createdAt: ts })
      result.push(fromRow(created as Row))
    }
  }
  if (getActiveComplianceRuleProfile(db)) return result
  const defaultProfile = profiles.find((profile) => profile.active && profile.integrityStatus === 'verified' && profile.sourceStatus === 'official')
  if (defaultProfile) {
    const active = activateComplianceRuleProfile(db, defaultProfile.id)
    return active ? [active, ...result.filter((profile) => profile.id !== active.id)] : result
  }
  return result
}
