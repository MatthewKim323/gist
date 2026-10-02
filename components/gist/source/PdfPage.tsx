"use client";

// Loaded only through next/dynamic with ssr:false (pdfjs touches DOMMatrix at import time).
import { useEffect, useRef, useState } from "react";
import { Document, Page, pdfjs } from "react-pdf";

pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();

export default function PdfPage({ url, page, onPages }: { url: string; page: number; onPages?: (n: number) => void }) {
  const wrap = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(420);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setW(Math.max(240, el.clientWidth)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return (
    <div ref={wrap} className="gs-pdf">
      {err ? (
        <div className="gs-empty">PDF unavailable ({err}). The transcript is on the right.</div>
      ) : (
        <Document
          file={url}
          onLoadSuccess={(d) => onPages?.(d.numPages)}
          onLoadError={(e) => setErr(e.message.slice(0, 60))}
          loading={<div className="gs-skel gs-skel--page" />}
        >
          <Page pageNumber={page} width={w} renderTextLayer={false} renderAnnotationLayer={false} loading={<div className="gs-skel gs-skel--page" />} />
        </Document>
      )}
    </div>
  );
}
