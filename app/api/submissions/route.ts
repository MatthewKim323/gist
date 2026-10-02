import { NextResponse, type NextRequest } from "next/server";
import { getSession } from "@/lib/server/auth/session";
import { lookupShare } from "@/lib/server/share";
import {
  ALLOWED_TYPES,
  MAX_BYTES,
  createSubmission,
  deleteSubmission,
  listForFirm,
  providerOnMatter,
  reviewSubmission,
  sniffType,
  type SubmissionKind,
} from "@/lib/server/submissions";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function bad(msg: string, status = 400) {
  return NextResponse.json({ error: msg }, { status });
}
const str = (v: FormDataEntryValue | null, max: number) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);

/**
 * POST /api/submissions (multipart: file?, note?, gate_requirement_key?, item_label?, kind?, token? | matterId?)
 * Authorized by a live share token (x-share-token header or token field; the share fixes matter + office)
 * or by a signed-in provider whose office is on the matter. Stored with gist only; nothing goes to Clio.
 */
export async function POST(req: NextRequest) {
  const form = await req.formData().catch(() => null);
  if (!form) return bad("multipart form required");
  const token = req.headers.get("x-share-token") ?? str(form.get("token"), 200);

  let matterId: number;
  let contactId: number;
  let providerName: string | null;
  let shareId: string | null = null;
  if (token) {
    const found = await lookupShare(token);
    if (!found.ok) return bad(found.reason === "not_found" ? "Link not valid" : `Link ${found.reason}`, found.reason === "not_found" ? 401 : 403);
    matterId = Number(found.share.matter_id);
    contactId = Number(found.share.provider_contact_id);
    providerName = found.share.provider_name;
    shareId = found.share.id;
  } else {
    const session = await getSession();
    if (session?.role !== "provider") return bad("Sign in as a provider or use your share link", 401);
    matterId = Number(form.get("matterId"));
    contactId = Number(session.providerContactId);
    if (!matterId) return bad("matterId required");
    const office = await providerOnMatter(matterId, contactId).catch(() => null);
    if (!office) return bad("Your office is not on this case", 403);
    providerName = office.name;
  }

  const kindRaw = str(form.get("kind"), 10);
  const kind: SubmissionKind = kindRaw === "bill" || kindRaw === "note" ? kindRaw : "record";
  const note = str(form.get("note"), 2000);
  const entry = form.get("file");
  let file: { bytes: Uint8Array; name: string; type: string } | null = null;
  if (entry && typeof entry !== "string" && entry.size > 0) {
    if (entry.size > MAX_BYTES) return bad("File is over 10 MB", 413);
    const bytes = new Uint8Array(await entry.arrayBuffer());
    const type = sniffType(bytes);
    if (!type || !ALLOWED_TYPES[type]) return bad("Only PDF, JPG or PNG files", 415);
    file = { bytes, name: entry.name || `upload.${ALLOWED_TYPES[type]}`, type };
  }
  if (!file && !note) return bad("Attach a file or write a note");

  try {
    const row = await createSubmission({
      matterId,
      providerContactId: contactId,
      providerName,
      shareId,
      requirementKey: str(form.get("gate_requirement_key"), 200),
      itemLabel: str(form.get("item_label"), 300),
      kind: file ? kind : "note",
      note,
      file,
    });
    return NextResponse.json({
      submission: {
        id: row.id,
        gate_requirement_key: row.gate_requirement_key,
        item_label: row.item_label,
        kind: row.kind,
        note: row.note,
        file_name: row.file_name,
        status: row.status,
        created_at: row.created_at,
      },
    });
  } catch (e) {
    return bad((e as Error).message, 500);
  }
}

async function firmOnly() {
  const s = await getSession();
  return s?.role === "provider" ? bad("Forbidden: provider accounts cannot access firm data", 403) : null;
}

/** GET /api/submissions?matterId=  ->  firm inbox, pending first, with signed download URLs. */
export async function GET(req: NextRequest) {
  const denied = await firmOnly();
  if (denied) return denied;
  const matterId = Number(req.nextUrl.searchParams.get("matterId"));
  if (!matterId) return bad("matterId required");
  try {
    return NextResponse.json({ submissions: await listForFirm(matterId) });
  } catch (e) {
    return bad((e as Error).message, 500);
  }
}

/** PATCH /api/submissions {id, status: accepted|dismissed|pending}. Marks review state only; Clio is untouched. */
export async function PATCH(req: NextRequest) {
  const denied = await firmOnly();
  if (denied) return denied;
  const body = (await req.json().catch(() => null)) as { id?: unknown; status?: unknown } | null;
  const id = typeof body?.id === "string" ? body.id : null;
  const status = body?.status;
  if (!id || (status !== "accepted" && status !== "dismissed" && status !== "pending")) return bad("id and status required");
  try {
    return NextResponse.json({ ok: true, ...(await reviewSubmission(id, status)) });
  } catch (e) {
    return bad((e as Error).message, 500);
  }
}

/** DELETE /api/submissions?id=  ->  remove a submission and its file (firm only). */
export async function DELETE(req: NextRequest) {
  const denied = await firmOnly();
  if (denied) return denied;
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return bad("id required");
  await deleteSubmission(id);
  return NextResponse.json({ ok: true });
}
