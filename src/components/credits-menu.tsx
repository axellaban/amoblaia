"use client";
// The balance in the panel's top bar: one click shows the balance, buying
// more, the movements and how credits work. Same balance as everywhere
// (the agency owner's, from /api/panel), no second count.
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { CircleHelp, History, Layers, Tag } from "lucide-react";
import { openCreditsPurchase } from "./credits-purchase";

export function CreditsMenu({ credits, canBuy, source }: { credits: number; canBuy: boolean; source: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  const label = `${credits} ${credits === 1 ? "crédito" : "créditos"}`;
  return (
    <div className="hb-balance" ref={ref} data-tour="credits-balance">
      <button
        type="button"
        className={`hb-balance-chip${credits <= 0 ? " empty" : ""}`}
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen((v) => !v)}
      >
        <Layers size={16} aria-hidden="true" /> {label}
      </button>
      {open && (
        <div className="hb-balance-pop" role="dialog" aria-label="Tus créditos">
          <small>Tus créditos</small>
          <strong>{label}</strong>
          {canBuy ? (
            <button
              type="button"
              className="button button-primary"
              onClick={() => {
                setOpen(false);
                openCreditsPurchase({ source });
              }}
            >
              Comprar más créditos
            </button>
          ) : (
            <p>Los créditos de la inmobiliaria los compra la cuenta dueña.</p>
          )}
          <Link href="/panel/creditos#precios" onClick={() => setOpen(false)}>
            <Tag size={17} aria-hidden="true" /> Ver precios
          </Link>
          <Link href="/panel/creditos#movimientos" onClick={() => setOpen(false)}>
            <History size={17} aria-hidden="true" /> Ver historial
          </Link>
          <Link href="/panel/creditos#como-funcionan-los-creditos" onClick={() => setOpen(false)}>
            <CircleHelp size={17} aria-hidden="true" /> Cómo funcionan los créditos
          </Link>
        </div>
      )}
    </div>
  );
}
