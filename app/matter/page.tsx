// Matter view: plain DOM over the case menu backdrop. The pipeline timeline plays first when a run is
// in flight, then a seam-wipe swaps in the dashboard (see components/gist/pipeline/README.md).
import "@/app/styles/gist-dashboard.css";
import MatterView from "./MatterView";

export default function MatterPage() {
  return (
    <main data-router-view="matter" role="main">
      <MatterView />
    </main>
  );
}
