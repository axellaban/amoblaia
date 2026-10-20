"use client";
import { useState } from "react";
import { ChevronsLeftRight } from "lucide-react";
export function Comparison({
  before,
  after,
  alt = "Ambiente con virtual staging",
  initial = 45,
  compact = false,
}: {
  before: string;
  after: string;
  alt?: string;
  initial?: number;
  compact?: boolean;
}) {
  const [position, setPosition] = useState(initial);
  return (
    <div className={`comparison ${compact ? "comparison-compact" : ""}`}>
      <img src={after} alt={alt} draggable={false} />
      <div
        className="comparison-before"
        style={{ clipPath: `inset(0 ${100 - position}% 0 0)` }}
      >
        <img
          src={before}
          alt="Ambiente original antes del diseño"
          draggable={false}
        />
      </div>
      <div className="comparison-label before-label">Antes</div>
      <div className="comparison-label after-label">
        Después <span>con IA</span>
      </div>
      <div className="comparison-line" style={{ left: `${position}%` }}>
        <span>
          <ChevronsLeftRight size={21} />
        </span>
      </div>
      <input
        type="range"
        min="0"
        max="100"
        value={position}
        onChange={(e) => setPosition(Number(e.target.value))}
        aria-label="Comparar antes y después"
        className="comparison-range"
      />
    </div>
  );
}
