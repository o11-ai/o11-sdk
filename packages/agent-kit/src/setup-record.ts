import { z } from 'zod';

const version = z.string().regex(/^[0-9][0-9A-Za-z.+-]{0,99}$/);
const commit = z.string().regex(/^[a-f0-9]{7,64}$/);
const link = z.url().max(2000).refine(value => { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash; }, 'Use an HTTPS evidence link without credentials, query strings or fragments.');
export const setupRecordSchema = z.object({
  formatVersion: z.literal(1), checkedAt: z.iso.datetime(), environment: z.enum(['test', 'production']),
  releaseId: z.string().regex(/^[a-zA-Z0-9_.-]{1,100}$/), instructionsVersion: version, docsVersion: version,
  cliVersion: version, installedSdkVersion: version.nullable(), previousSdkVersion: version.nullable(),
  runningSdkVersions: z.array(version).max(20), targetSdkVersion: version,
  applicationCommit: commit.optional(), serverBuildId: z.string().regex(/^[a-zA-Z0-9_.:-]{1,160}$/).nullable(),
  outcome: z.enum(['current', 'upgraded', 'kept_newer', 'deferred', 'incomplete']),
  changes: z.array(z.string().trim().min(1).max(500)).max(20),
  checks: z.object({ code: z.boolean(), deployed: z.boolean(), received: z.boolean(), matching: z.boolean(), excluded: z.boolean() }).strict(),
  evidenceUrls: z.array(link).max(10),
  exception: z.object({ reason: z.string().trim().min(1).max(1000), owner: z.string().trim().min(1).max(160),
    nextStep: z.string().trim().min(1).max(1000), reviewAt: z.iso.datetime() }).strict().optional(),
}).strict().superRefine((record, ctx) => {
  if (record.outcome === 'deferred' && !record.exception) ctx.addIssue({ code: 'custom', path: ['exception'], message: 'A deferred upgrade needs a reason, owner, next action and review date.' });
  if (record.exception && (Date.parse(record.exception.reviewAt) <= Date.parse(record.checkedAt)
    || Date.parse(record.exception.reviewAt) - Date.parse(record.checkedAt) > 30 * 86400000)) ctx.addIssue({ code: 'custom', path: ['exception', 'reviewAt'], message: 'Review the exception within 30 days of this check.' });
  if (record.outcome === 'upgraded' && (!record.checks.code || !record.checks.deployed || !record.checks.received
    || record.installedSdkVersion !== record.targetSdkVersion || !record.runningSdkVersions.includes(record.targetSdkVersion)))
    ctx.addIssue({ code: 'custom', path: ['outcome'], message: 'An upgrade is complete only after code, deployment and received activity confirm the target version.' });
});
export type SetupRecord = z.infer<typeof setupRecordSchema>;
