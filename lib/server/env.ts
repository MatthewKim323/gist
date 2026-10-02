import "server-only";

function req(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env ${name}`);
  return v;
}

export const env = {
  supabaseUrl: () => req("NEXT_PUBLIC_SUPABASE_URL"),
  supabaseServiceKey: () => req("SUPABASE_SERVICE_ROLE_KEY"),
  openaiKey: () => req("OPENAI_API_KEY"),
  typesafeKey: () => process.env.TYPESAFE_API_KEY ?? null,
  clioBase: () => process.env.CLIO_BASE_URL ?? "https://app.clio.com",
  clioClientId: () => req("CLIO_CLIENT_ID"),
  clioClientSecret: () => req("CLIO_CLIENT_SECRET"),
  clioRedirectUri: () => process.env.CLIO_REDIRECT_URI ?? "http://127.0.0.1:3000/api/clio/callback",
  swarmModel: () => process.env.SWARM_MODEL ?? "gpt-5.4-mini",
  synthModel: () => process.env.SYNTH_MODEL ?? "gpt-5.5",
  embeddingModel: () => process.env.EMBEDDING_MODEL ?? "text-embedding-3-large",
  embeddingDims: () => Number(process.env.EMBEDDING_DIMS ?? 1536),
};
