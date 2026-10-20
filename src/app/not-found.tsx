import Link from "next/link";
export default function NotFound() {
  return (
    <div className="not-found container">
      <span className="eyebrow">404 · ESPACIO POR ENCONTRAR</span>
      <h1>
        Esta puerta no lleva
        <br />a ningún ambiente.
      </h1>
      <p>Volvamos al inicio para imaginar nuevas posibilidades.</p>
      <Link href="/" className="button button-lime">
        Volver al inicio ↗
      </Link>
    </div>
  );
}
