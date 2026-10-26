"use client";
import Link from "next/link";
import { useState } from "react";
import { ArrowUpRight } from "lucide-react";
import { rooms, styles, type RoomId, type StyleId } from "@/lib/catalog";
import { examplePath } from "@/lib/examples";
import { Comparison } from "./comparison";
// Every room has an empty photo and one scene per style in public/ejemplos.
const roomName = (id: RoomId) => rooms.find((r) => r.id === id)?.name || id;
const styleName = (id: StyleId | "original") =>
  id === "original" ? "Original" : styles.find((s) => s.id === id)?.name || id;
export function Gallery() {
  const [room, setRoom] = useState<RoomId>("living"),
    [style, setStyle] = useState<StyleId | "original">("modern"),
    [compare, setCompare] = useState(false);
  return (
    <div className="gallery-page">
      <div className="container">
        <div className="page-intro">
          <span className="eyebrow">GALERÍA</span>
          <h1>
            Mirá la transformación:
            <br />
            antes y después
          </h1>
          <p>
            Explorá ambientes y estilos. Elegí Original para ver el punto de
            partida.
          </p>
        </div>
        <div
          className="gallery-filters"
          role="group"
          aria-label="Tipo de ambiente"
        >
          {rooms.map(({ id }) => (
            <button
              key={id}
              className={id === room ? "selected" : ""}
              aria-pressed={id === room}
              onClick={() => setRoom(id)}
            >
              {roomName(id)}
            </button>
          ))}
        </div>
        <div className="gallery-showcase">
          <div className="gallery-main-image">
            {compare && style !== "original" ? (
              <Comparison
                before={examplePath(room, "original")}
                after={examplePath(room, style)}
              />
            ) : (
              <img
                key={`${room}-${style}`}
                src={examplePath(room, style)}
                alt={`${roomName(room)}, ${style === "original" ? "foto original" : styleName(style)}`}
              />
            )}
          </div>
          <div
            className="gallery-thumbnails"
            role="group"
            aria-label="Estilo de la galería"
          >
            {(["original", ...styles.map((s) => s.id)] as const).map((s) => (
              <button
                key={s}
                className={s === style ? "selected" : ""}
                aria-pressed={s === style}
                onClick={() => setStyle(s)}
              >
                <img src={examplePath(room, s)} alt="" loading="lazy" />
                <span>{styleName(s)}</span>
              </button>
            ))}
          </div>
        </div>
        <div className="gallery-toolbar">
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={compare}
              disabled={style === "original"}
              onChange={(e) => setCompare(e.target.checked)}
            />
            Comparar antes y después con deslizador
          </label>
          <Link href="/estudio" className="button button-primary">
            Subir mi foto <ArrowUpRight size={18} />
          </Link>
        </div>
        <p className="gallery-disclaimer">
          Escenas ilustrativas originales creadas con IA. Con tu foto podés
          elegir entre 8 ambientes y 10 estilos. Los ejemplos no son propiedades
          de clientes.
        </p>
      </div>
    </div>
  );
}
