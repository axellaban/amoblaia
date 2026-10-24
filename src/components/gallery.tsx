"use client";
import Link from "next/link";
import { useState } from "react";
import { ArrowUpRight } from "lucide-react";
import {
  rooms,
  demoRooms,
  demoStyles,
  styles,
  beforeImage,
  afterImage,
  type RoomId,
  type StyleId,
} from "@/lib/catalog";
import { Comparison } from "./comparison";
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
            Estado actual y
            <br />
            propuestas de ambientación
          </h1>
          <p>
            Explorá ambientes y estilos. Elegí Original para ver el estado
            actual del que parte cada propuesta.
          </p>
        </div>
        <div
          className="gallery-filters"
          role="group"
          aria-label="Tipo de ambiente"
        >
          {demoRooms.map((id) => (
            <button
              key={id}
              className={id === room ? "selected" : ""}
              onClick={() => setRoom(id)}
            >
              {rooms.find((r) => r.id === id)?.name}
            </button>
          ))}
        </div>
        <div className="gallery-showcase">
          <div className="gallery-main-image">
            {compare && style !== "original" ? (
              <Comparison
                before={beforeImage(room)}
                after={afterImage(room, style)}
                disclosure="Ambientación virtual · Mobiliario agregado digitalmente"
              />
            ) : (
              <img
                src={
                  style === "original"
                    ? beforeImage(room)
                    : afterImage(room, style)
                }
                alt={`${rooms.find((r) => r.id === room)?.name}, ${style === "original" ? "foto original" : styles.find((s) => s.id === style)?.name}`}
              />
            )}
            <div
              className="gallery-style-tabs"
              role="group"
              aria-label="Estilo de la galería"
            >
              {(["original", ...demoStyles] as const).map((id) => (
                <button
                  key={id}
                  className={style === id ? "selected" : ""}
                  onClick={() => setStyle(id)}
                >
                  {id === "original"
                    ? "Original"
                    : styles.find((s) => s.id === id)?.name}
                </button>
              ))}
            </div>
          </div>
          <div className="gallery-thumbnails" aria-label="Escenas disponibles">
            {demoRooms.flatMap((r) =>
              demoStyles.map((s) => (
                <button
                  key={`${r}-${s}`}
                  className={r === room && s === style ? "selected" : ""}
                  onClick={() => {
                    setRoom(r);
                    setStyle(s);
                  }}
                  aria-label={`${rooms.find((v) => v.id === r)?.name}, ${styles.find((v) => v.id === s)?.name}`}
                >
                  <img src={afterImage(r, s)} alt="" />
                </button>
              )),
            )}
          </div>
        </div>
        <div className="gallery-toolbar">
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={compare}
              onChange={(e) => setCompare(e.target.checked)}
            />
            Comparar estado actual y propuesta con deslizador
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
