import "server-only";
import { randomUUID } from "node:crypto";
import { db, must } from "@/lib/server/db";
import { DOCS_BUCKET } from "@/lib/server/docs/storage";
import { listProviders } from "@/lib/server/share";
import type { ProviderSubmissionLite } from "@/components/gist/submissions/types";

export type { ProviderSubmissionLite };

// Provider submissions: a provider office answers a "what the firm needs" item with a file and/or note.
// Stored in Supabase only (table provider_submissions + bucket 'docs'). Nothing is ever written to Clio.

export const MAX_BYTES = 10 * 1024 * 1024;
export const ALLOWED_TYPES: Record<string, string> = {
  "application/pdf": "pdf",
  "image/jpeg": "jpg",
  "image/png": "png",
};
export type SubmissionKind = "record" | "bill" | "note";
export type SubmissionStatus = "pending" | "accepted" | "dismissed";

export interface SubmissionRow {
  id: string;
  matter_id: number;
  provider_contact_id: number;
  provider_name: string | null;
  share_id: string | null;
  gate_requirement_key: string | null;
  item_label: string | null;
  kind: SubmissionKind;
  note: string | null;
  file_path: string | null;
  file_name: string | null;
  size: number | null;
  content_type: string | null;
  status: SubmissionStatus;
  created_at: string;
  reviewed_at: string | null;
}


export function safeName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "file";
  return base.replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^\.+/, "").slice(0, 80) || "file";
}

/** Sniff magic bytes so a renamed file cannot slip past the type check. */
export function sniffType(bytes: Uint8Array): string | null {
  if (bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46) return "application/pdf";
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "image/png";
  return null;
}

export async function providerOnMatter(matterId: number, contactId: number) {
  const providers = await listProviders(matterId);
  return providers.find((p) => p.contact_id === contactId) ?? null;
}

export async function createSubmission(opts: {
  matterId: number;
  providerContactId: number;
  providerName: string | null;
  shareId: string | null;
  requirementKey: string | null;
  itemLabel: string | null;
  kind: SubmissionKind;
  note: string | null;
  file: { bytes: Uint8Array; name: string; type: string } | null;
}): Promise<SubmissionRow> {
  let file_path: string | null = null;
  if (opts.file) {
    file_path = `${opts.matterId}/submissions/${randomUUID()}-${safeName(opts.file.name)}`;
    const { error } = await db().storage.from(DOCS_BUCKET).upload(file_path, opts.file.bytes, { contentType: opts.file.type, upsert: false });
    if (error) throw new Error(`storage upload: ${error.message}`);
  }
  return must(
    await db()
      .from("provider_submissions")
      .insert({
        matter_id: opts.matterId,
        provider_contact_id: opts.providerContactId,
        provider_name: opts.providerName,
        share_id: opts.shareId,
        gate_requirement_key: opts.requirementKey,
        item_label: opts.itemLabel,
        kind: opts.kind,
        note: opts.note,
        file_path,
        file_name: opts.file ? safeName(opts.file.name) : null,
        size: opts.file ? opts.file.bytes.byteLength : null,
        content_type: opts.file?.type ?? null,
      })
      .select("*")
      .single(),
    "insert submission",
  ) as SubmissionRow;
}

/** Firm view: every submission on the matter, pending first, with short-lived signed download URLs. */
export async function listForFirm(matterId: number) {
  const rows = must(
    await db().from("provider_submissions").select("*").eq("matter_id", matterId).order("created_at", { ascending: false }).limit(200),
    "list submissions",
  ) as SubmissionRow[];
  const order: Record<SubmissionStatus, number> = { pending: 0, accepted: 1, dismissed: 2 };
  rows.sort((a, b) => order[a.status] - order[b.status] || b.created_at.localeCompare(a.created_at));
  const paths = rows.map((r) => r.file_path).filter((p): p is string => !!p);
  const urls = new Map<string, string>();
  if (paths.length) {
    const { data } = await db().storage.from(DOCS_BUCKET).createSignedUrls(paths, 60 * 30);
    for (const d of data ?? []) if (d.path && d.signedUrl) urls.set(d.path, d.signedUrl);
  }
  return rows.map((r) => ({
    id: r.id,
    matter_id: Number(r.matter_id),
    provider_contact_id: Number(r.provider_contact_id),
    provider_name: r.provider_name,
    gate_requirement_key: r.gate_requirement_key,
    item_label: r.item_label,
    kind: r.kind,
    note: r.note,
    file_name: r.file_name,
    size: r.size == null ? null : Number(r.size),
    status: r.status,
    created_at: r.created_at,
    reviewed_at: r.reviewed_at,
    url: r.file_path ? (urls.get(r.file_path) ?? null) : null,
  }));
}
export type FirmSubmission = Awaited<ReturnType<typeof listForFirm>>[number];

/** Provider view: only this office's own submissions on this matter. */
export async function listForProvider(matterId: number, providerContactId: number): Promise<ProviderSubmissionLite[]> {
  const { data } = await db()
    .from("provider_submissions")
    .select("id,gate_requirement_key,item_label,kind,note,file_name,status,created_at")
    .eq("matter_id", matterId)
    .eq("provider_contact_id", providerContactId)
    .order("created_at", { ascending: false })
    .limit(50);
  return (data ?? []) as ProviderSubmissionLite[];
}

export async function reviewSubmission(id: string, status: SubmissionStatus) {
  return must(
    await db()
      .from("provider_submissions")
      .update({ status, reviewed_at: status === "pending" ? null : new Date().toISOString() })
      .eq("id", id)
      .select("id,status,reviewed_at")
      .single(),
    "review submission",
  ) as { id: string; status: SubmissionStatus; reviewed_at: string | null };
}

/** Test cleanup: delete a submission and its stored file. */
export async function deleteSubmission(id: string) {
  const { data } = await db().from("provider_submissions").select("file_path").eq("id", id).maybeSingle();
  const path = (data as { file_path: string | null } | null)?.file_path;
  if (path) await db().storage.from(DOCS_BUCKET).remove([path]);
  await db().from("provider_submissions").delete().eq("id", id);
}
