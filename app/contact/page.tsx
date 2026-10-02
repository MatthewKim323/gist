import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Sign in · gist.",
};

// /contact is the sign-in scene: same homeContact view as "/", the camera turns to the contact set and the
// persistent .js-contact-content (SceneSignIn) carries the page.
export default function ContactPage() {
  return (
    <main {...{ asscroll: "" }} data-router-view="homeContact" role="main" itemScope itemProp="mainContentOfPage">
      <h1 className="sr">Sign in to gist.</h1>
    </main>
  );
}
