import "server-only";
import { db } from "../db";

export const DOCS_BUCKET = "docs";

export async function download(path: string): Promise<Uint8Array> {
  const { data, error } = await db().storage.from(DOCS_BUCKET).download(path);
  if (error || !data) throw new Error(`storage download ${path}: ${error?.message ?? "empty"}`);
  return new Uint8Array(await data.arrayBuffer());
}

export async function upload(path: string, body: Buffer | Uint8Array, contentType: string) {
  const { error } = await db().storage.from(DOCS_BUCKET).upload(path, body, { contentType, upsert: true });
  if (error) throw new Error(`storage upload ${path}: ${error.message}`);
}
