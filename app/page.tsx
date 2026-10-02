// Home body (reference/site/css/markup/home.html). The route's visible content is WebGL (HomeContact
// scene); the persistent home/contact templates (.js-view-projects-btn, .js-contact-content) live in
// the shell because the scene holds them across every route.
export default function HomePage() {
  return (
    <main {...{ asscroll: "" }} data-router-view="homeContact" role="main" itemScope itemProp="mainContentOfPage">
      <h1 className="sr">gist</h1>
    </main>
  );
}
