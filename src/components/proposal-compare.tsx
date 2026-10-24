"use client";
import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { Maximize2, X } from "lucide-react";
import { Comparison } from "./comparison";
import { ORIGINAL_TITLE, PROPOSAL_TITLE } from "@/lib/disclosure";

export type CompareView = "pair" | "slider";
export type Side = "original" | "proposal";

/** Width of an element in CSS pixels, so labels scale with the photo. */
function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) =>
      setWidth(Math.round(entry.contentRect.width)),
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return [ref, width] as const;
}

/**
 * The disclosure over a staged photo. Sized from the photo's width, at least
 * 11 px, and anchored where the shared images carry the burned-in copy, so on
 * screen only this sharper one shows.
 */
export function Disclosed({
  text,
  children,
  className = "",
}: {
  text?: string | null;
  children: ReactNode;
  className?: string;
}) {
  const [ref, width] = useWidth<HTMLSpanElement>();
  return (
    <span
      ref={ref}
      className={`disclosed ${className}`}
      style={{ "--fw": `${width || 600}px` } as CSSProperties}
    >
      {children}
      {text && <span className="disclosure-pill">{text}</span>}
    </span>
  );
}

/**
 * The real photo and the proposal, always both on screen: side by side on
 * wide screens, stacked on phones. The slider is an alternative view.
 */
export function ProposalCompare({
  original,
  proposal,
  disclosure,
  proposalTitle = PROPOSAL_TITLE,
  view = "pair",
  ratio,
  onZoom,
  onImageError,
  className = "",
}: {
  original: string;
  proposal: string;
  disclosure?: string | null;
  proposalTitle?: string;
  view?: CompareView;
  ratio?: number;
  onZoom?: (side: Side) => void;
  onImageError?: () => void;
  className?: string;
}) {
  if (view === "slider")
    return (
      <div className={`pc pc-slider ${className}`}>
        <Comparison
          before={original}
          after={proposal}
          ratio={ratio}
          disclosure={disclosure}
          alt={proposalTitle}
        />
        {onZoom && (
          <button
            type="button"
            className="pc-zoom"
            onClick={() => onZoom("proposal")}
            aria-label="Ampliar la propuesta"
            title="Ampliar"
          >
            <Maximize2 size={16} />
          </button>
        )}
      </div>
    );
  const panel = (side: Side) => {
    const isProposal = side === "proposal";
    const image = (
      <img
        src={isProposal ? proposal : original}
        alt={
          isProposal
            ? `${proposalTitle}. Mobiliario agregado digitalmente.`
            : "Estado actual del ambiente: foto real"
        }
        draggable={false}
        onError={onImageError}
      />
    );
    return (
      <figure className={`pc-panel ${isProposal ? "is-proposal" : "is-original"}`}>
        <figcaption>
          <span className="pc-dot" aria-hidden="true" />
          {isProposal ? proposalTitle : ORIGINAL_TITLE}
        </figcaption>
        <button
          type="button"
          className="pc-frame"
          onClick={() => onZoom?.(side)}
          disabled={!onZoom}
          aria-label={`Ampliar ${isProposal ? "la propuesta" : "el estado actual"}`}
        >
          <Disclosed text={isProposal ? disclosure : null}>{image}</Disclosed>
          {onZoom && (
            <span className="pc-zoom" aria-hidden="true">
              <Maximize2 size={15} />
            </span>
          )}
        </button>
      </figure>
    );
  };
  return (
    <div className={`pc pc-pair ${className}`}>
      {panel("original")}
      {panel("proposal")}
    </div>
  );
}

/**
 * Full screen view. A proposal never shows alone: the real photo stays as a
 * thumbnail that opens with one tap, and the reverse.
 */
export function ProposalViewer({
  original,
  proposal,
  disclosure,
  proposalTitle = PROPOSAL_TITLE,
  initial = "proposal",
  onClose,
}: {
  original: string;
  proposal: string;
  disclosure?: string | null;
  proposalTitle?: string;
  initial?: Side;
  onClose: () => void;
}) {
  const [side, setSide] = useState<Side>(initial);
  const close = useRef<HTMLButtonElement>(null);
  // Parents pass a new function each render; the listeners stay put.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    const trigger = document.activeElement as HTMLElement | null;
    close.current?.focus();
    const keys = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCloseRef.current();
      if (e.key === "ArrowLeft") setSide("original");
      if (e.key === "ArrowRight") setSide("proposal");
    };
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", keys);
    return () => {
      document.removeEventListener("keydown", keys);
      document.body.style.overflow = overflow;
      trigger?.focus?.();
    };
  }, []);
  const other: Side = side === "proposal" ? "original" : "proposal";
  const title = (s: Side) => (s === "proposal" ? proposalTitle : ORIGINAL_TITLE);
  return (
    <div
      className="pv"
      role="dialog"
      aria-modal="true"
      aria-label={title(side)}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="pv-bar">
        <div className="pv-tabs" role="group" aria-label="Qué imagen ver">
          {(["original", "proposal"] as Side[]).map((s) => (
            <button
              key={s}
              type="button"
              className={side === s ? "selected" : ""}
              aria-pressed={side === s}
              onClick={() => setSide(s)}
            >
              {s === "proposal" ? "Propuesta" : ORIGINAL_TITLE}
            </button>
          ))}
        </div>
        <button
          ref={close}
          type="button"
          className="pv-close"
          aria-label="Cerrar"
          onClick={onClose}
        >
          <X size={22} />
        </button>
      </div>
      <div className="pv-stage">
        <Disclosed
          className="pv-main"
          text={side === "proposal" ? disclosure : null}
        >
          <img
            src={side === "proposal" ? proposal : original}
            alt={title(side)}
          />
        </Disclosed>
        <button
          type="button"
          className="pv-inset"
          onClick={() => setSide(other)}
          aria-label={`Ampliar ${other === "proposal" ? "la propuesta" : "el estado actual"}`}
        >
          <img src={other === "proposal" ? proposal : original} alt="" />
          <span>
            {other === "proposal" ? "Propuesta" : ORIGINAL_TITLE}
            <Maximize2 size={12} />
          </span>
        </button>
      </div>
      <p className="pv-caption">{title(side)}</p>
    </div>
  );
}
