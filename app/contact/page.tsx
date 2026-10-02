import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Contact - Matthew Kim",
};

// Contact body (reference/site/css/markup/contact.html). Same homeContact view as "/"; the camera path
// and the persistent .js-contact-content template carry the page.
export default function ContactPage() {
  return (
    <main {...{ asscroll: "" }} data-router-view="homeContact" role="main" itemScope itemProp="mainContentOfPage">
      <h1>Contact</h1>
    </main>
  );
}
