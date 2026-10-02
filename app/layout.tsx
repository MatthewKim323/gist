import type { Metadata } from "next";
import { Hanken_Grotesk, Inter } from "next/font/google";
import "./globals.css";
import "./styles/cursor.css";
import Shell, { ShellPost } from "@/components/Shell";
import EngineRoot from "@/components/EngineRoot";

// App UI type system (dashboard, cases, share pages): Hanken Grotesk for text, Inter for small uppercase
// labels and numbers. The landing keeps its own faces.
const hanken = Hanken_Grotesk({ variable: "--font-hanken", subsets: ["latin"], display: "swap" });
const inter = Inter({ variable: "--font-inter", subsets: ["latin"], display: "swap" });

export const metadata: Metadata = {
  title: "gist.",
  description:
    "gist: every personal-injury case digested in ninety seconds, for the firm and the providers treating on a lien.",
};

// Body classes per route, as served by the source per template. Applied before first paint;
// on client navigation the router swaps them (NAVIGATE_IN copies the next page's body class).
const BODY_CLASS_SCRIPT = `(function(){var p=location.pathname.replace(/\\/+$/,"")||"/";var c;
if(p==="/")c="home page-template-home-contact";
else if(p==="/contact")c="page-template-home-contact";
else if(p==="/matter")c="page-template-matter";
else if(p==="/projects")c="archive post-type-archive post-type-archive-project";
else if(p==="/about")c="dark page-template-world";
else if(/^\\/projects\\/[^/]+$/.test(p))c="project-template-default";
else c="error404 dark";
document.body.className=c;})();`;

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en-GB" className={`asscroll-disabled theme-dark ${hanken.variable} ${inter.variable}`} suppressHydrationWarning>
      <body className="home page-template-home-contact" suppressHydrationWarning>
        <script dangerouslySetInnerHTML={{ __html: BODY_CLASS_SCRIPT }} />
        <Shell />
        <div asscroll-container="" data-router-wrapper="">
          {children}
        </div>
        <ShellPost />
        <EngineRoot />
      </body>
    </html>
  );
}
