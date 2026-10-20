"use client";
import Link from "next/link";
import { useState } from "react";
import { ArrowUpRight, SlidersHorizontal, ArrowRight } from "lucide-react";
import {
  rooms,
  demoRooms,
  styles,
  beforeImage,
  afterImage,
  type RoomId,
  type StyleId,
} from "@/lib/catalog";
import { Comparison } from "./comparison";
const examples: { room: RoomId; style: StyleId }[] = [
  { room: "living", style: "modern" },
  { room: "living", style: "eclectic" },
  { room: "bedroom", style: "modern" },
  { room: "bedroom", style: "eclectic" },
];
export function Gallery() {
  const [filter, setFilter] = useState("all");
  return (
    <div className="gallery-page">
      <div className="container">
        <div className="page-intro">
          <span className="eyebrow">IMAGINAR ES EL PRIMER PASO</span>
          <h1>
            Mucho más que
            <br />
            <span>cuatro paredes.</span>
          </h1>
          <p>
            Explorá lo que puede pasar cuando le das vida a un espacio.
            <br />
            Deslizá cada imagen y descubrí el antes y el después.
          </p>
        </div>
        <div className="gallery-filters">
          <SlidersHorizontal size={17} />
          <button
            className={filter === "all" ? "selected" : ""}
            onClick={() => setFilter("all")}
          >
            Todos los ambientes
          </button>
          {rooms
            .filter((r) => (demoRooms as readonly string[]).includes(r.id))
            .map((r) => (
              <button
                key={r.id}
                className={filter === r.id ? "selected" : ""}
                onClick={() => setFilter(r.id)}
              >
                {r.name}
              </button>
            ))}
        </div>
        <div className="gallery-grid full-gallery">
          {examples
            .filter((e) => filter === "all" || filter === e.room)
            .map((e, i) => (
              <article className="gallery-card" key={`${e.room}-${e.style}`}>
                <Comparison
                  before={beforeImage(e.room)}
                  after={afterImage(e.room, e.style)}
                  compact
                />
                <div className="gallery-card-caption">
                  <div>
                    <span>0{i + 1} /</span>
                    <h2>{rooms.find((r) => r.id === e.room)?.name}</h2>
                  </div>
                  <span>{styles.find((s) => s.id === e.style)?.name}</span>
                </div>
              </article>
            ))}
        </div>
        <p className="gallery-disclaimer">
          Escenas originales creadas con IA para ilustrar estilos. Son espacios
          ficticios; no son fotos de clientes ni una garantía de resultado.
        </p>
        <div className="gallery-invite">
          <div>
            <span className="eyebrow">AHORA TE TOCA A VOS</span>
            <h2>Tu espacio también puede sorprender.</h2>
          </div>
          <Link className="button button-lime" href="/estudio">
            Probar con mi foto <ArrowUpRight size={19} />
          </Link>
        </div>
        <Link href="/#como-funciona" className="text-link">
          Conocé cómo funciona <ArrowRight size={16} />
        </Link>
      </div>
    </div>
  );
}
