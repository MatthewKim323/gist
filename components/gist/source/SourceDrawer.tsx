"use client";

import Button from "@/components/gist/ui/Button";
import { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "motion/react";
import type { Citation } from "@/lib/types";
import { fmtDateAgo, refKindLabel } from "@/components/gist/dashboard/format";
import { loadSource } from "./load";
import { splitOnQuote } from "./highlight";
import type { SourcePayload } from "./types";

const PdfPage = dynamic(() => import("./PdfPage"), { ssr: false, loading: () => <div className="gs-skel gs-skel--page" /> });

function Highlighted({ text, quote }: { text: string; quote?: string }) {
  const mark = useRef<HTMLElement>(null);
  const parts = splitOnQuote(text, quote);
  useEffect(() => {
    mark.current?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [text, quote]);
  if (!parts) return <p className="gs-text">{text}</p>;
  return (
    <p className="gs-text">
      {parts.before}
      <mark ref={mark} className="gs-mark">{parts.match}</mark>
      {parts.after}
    </p>
  );
}

export default function SourceDrawer({
  cite,
  matterId,
  fixture,
  onClose,
}: {
  cite: Citation | null;
  matterId: number | null;
  fixture: boolean;
  onClose: () => void;
}) {
  const [data, setData] = useState<SourcePayload | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [page, setPage] = useState<number>(1);
  const [pages, setPages] = useState<number | null>(null);
  const [otherText, setOtherText] = useState<{ page: number; text: string | null } | null>(null);

  useEffect(() => {
    if (!cite) return;
    let live = true;
    setData(null);
    setErr(null);
    loadSource(cite.source_ref, matterId, fixture)
      .then((d) => {
        if (!live) return;
        setData(d);
        setPage(d.doc?.page ?? 1);
        setPages(d.doc?.pages_total ?? null);
      })
      .catch((e: Error) => live && setErr(e.message));
    return () => {
      live = false;
    };
  }, [cite, matterId, fixture]);

  useEffect(() => {
    if (!cite) return;
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [cite, onClose]);

  // Paging away from the cited page loads that page's transcript too.
  useEffect(() => {
    const d = data?.doc;
    if (!d || fixture || page === d.page) return setOtherText(null);
    let live = true;
    fetch(`/api/docs/${d.id}/page/${page}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { text?: string } | null) => live && setOtherText({ page, text: j?.text ?? null }))
      .catch(() => live && setOtherText({ page, text: null }));
    return () => {
      live = false;
    };
  }, [data, page, fixture]);

  const isDoc = !!data?.doc;
  const onCitedPage = isDoc && page === (data?.doc?.page ?? 1);

  return createPortal(
    <div className="gd-portal">
    <AnimatePresence>
      {cite ? (
        <>
          <motion.div
            key="scrim"
            className="gs-scrim"
            onClick={onClose}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.25 }}
          />
          <motion.aside
            key="drawer"
            className={`gs-drawer ${isDoc ? "gs-drawer--doc" : ""}`}
            role="dialog"
            aria-label="Source"
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ type: "spring", stiffness: 380, damping: 40 }}
          >
            <header className="gs-head">
              <div className="gs-head__meta">
                <span className="gs-kind">{refKindLabel(cite.source_ref)}</span>
                <span className="gs-ref">{cite.source_ref}</span>
              </div>
              <h3 className="gs-title">{data?.title ?? data?.doc?.name ?? cite.label ?? "Source"}</h3>
              {data?.occurred_at ? <div className="gs-date">{fmtDateAgo(data.occurred_at)}</div> : null}
              <div className="gs-head__actions">
                {data?.clio_url ? (
                  <Button size="sm" variant="border" href={data.clio_url} external arrow>
                    Open in Clio
                  </Button>
                ) : null}
                <Button size="sm" onClick={onClose} aria-label="Close">
                  Close
                </Button>
              </div>
            </header>

            {cite.quote ? (
              <div className="gs-quote">
                <span className="gs-quote__label">Cited</span>
                &ldquo;{cite.quote}&rdquo;
              </div>
            ) : null}

            <div className="gs-body">
              {err ? <div className="gs-empty">Could not load this source. {err}</div> : null}
              {!data && !err ? (
                <div className="gs-loading">
                  <div className="gs-skel" />
                  <div className="gs-skel gs-skel--short" />
                  <div className="gs-skel" />
                </div>
              ) : null}
              {data && !isDoc ? (
                data.body_text ? <Highlighted text={data.body_text} quote={cite.quote} /> : <div className="gs-empty">This item has no text body.</div>
              ) : null}
              {data?.doc ? (
                <div className="gs-split">
                  <div className="gs-split__pdf">
                    <div className="gs-pager">
                      <Button size="xs" variant="border" disabled={page <= 1} onClick={() => setPage((p) => p - 1)} aria-label="Previous page">
                        Prev
                      </Button>
                      <span className="gs-pager__n">
                        p.{page}
                        {pages ? <span className="gs-dim"> / {pages}</span> : null}
                      </span>
                      <Button size="xs" variant="border" disabled={pages != null && page >= pages} onClick={() => setPage((p) => p + 1)} aria-label="Next page">
                        Next
                      </Button>
                    </div>
                    {data.doc.pdf_url ? (
                      <PdfPage url={data.doc.pdf_url} page={page} onPages={setPages} />
                    ) : (
                      <div className="gs-fakepage">
                        <div className="gs-fakepage__name">{data.doc.name}</div>
                        <div className="gs-fakepage__p">Page {page}</div>
                        <div className="gs-dim">Fixture mode: no PDF</div>
                      </div>
                    )}
                  </div>
                  <div className="gs-split__ocr">
                    <div className="gs-split__label">Transcript · p.{onCitedPage ? data.doc.page : page}</div>
                    {!onCitedPage ? (
                      otherText?.page === page && otherText.text ? (
                        <p className="gs-text">{otherText.text}</p>
                      ) : (
                        <div className="gs-empty">{otherText?.page === page ? "No transcript for this page." : "Loading transcript"}</div>
                      )
                    ) : data.doc.page_text ? (
                      <Highlighted text={data.doc.page_text} quote={cite.quote} />
                    ) : (
                      <div className="gs-empty">No transcript for this page yet.</div>
                    )}
                    {!onCitedPage ? (
                      <div className="gs-split__note"><Button size="xs" onClick={() => setPage(data.doc!.page ?? 1)}>
                        Back to cited p.{data.doc.page}
                      </Button></div>
                    ) : null}
                  </div>
                </div>
              ) : null}
            </div>
          </motion.aside>
        </>
      ) : null}
    </AnimatePresence>
    </div>,
    document.body,
  );
}
