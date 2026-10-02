// Dev harness for the pipeline timeline. /pipeline-preview?runId=<uuid> watches a real run;
// without runId it replays a clearly simulated run from components/gist/pipeline/mock.ts.
import PipelinePreview from "@/components/gist/pipeline/PipelinePreview";

export const metadata = { title: "gist · pipeline preview", robots: { index: false } };

export default async function PipelinePreviewPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const runId = typeof sp.runId === "string" ? sp.runId : null;
  return (
    <main data-router-view="matter" role="main">
      <PipelinePreview runId={runId} />
    </main>
  );
}
