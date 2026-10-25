import React from "react";
import { AbsoluteFill, Audio, Img, Sequence, staticFile, useCurrentFrame } from "remotion";
import { TransitionSeries, linearTiming } from "@remotion/transitions";
import { fade } from "@remotion/transitions/fade";
import { Background } from "../engine/Background";
import { Music } from "../engine/Music";
import { StepCaption, WordsIn } from "../engine/Captions";
import { inOut, inOutWindow, out, prog } from "../engine/ease";
import { useFormat } from "../engine/layout";
import { Walkthrough } from "../engine/Walkthrough";
import { Dropdown, DragFile, Glow, TypeIn, keyFrames } from "../engine/widgets";
import { CPS, NOTES, STYLES, STYLE_PICK, buildWalk } from "./script";
import { Logo } from "./Logo";
import { C, theme } from "./theme";

const img = (name: string) => staticFile(`amoblaia/img/${name}.webp`);
const tl = buildWalk();
const m = tl.marks;

export const HOOK = 108;
export const WALK = m.end + 6;
export const BA = 168;
export const GRID = 138;
export const OUTRO = 140;
const T = 14; // transiciones
export const TOTAL = HOOK + WALK + BA + GRID + OUTRO - 4 * T;

// ---------- 1. Gancho: vacío → amoblado ----------
const Hook: React.FC = () => {
  const f = useCurrentFrame();
  const fmt = useFormat();
  const p = prog(f, 50, 82, inOut);
  const zoom = 1.04 + 0.06 * (f / HOOK);
  const t1 = 1 - prog(f, 44, 54);
  const big = fmt === "landscape" ? 96 : 104;
  const textBox: React.CSSProperties =
    fmt === "landscape"
      ? { position: "absolute", left: 110, bottom: 110, width: 1300 }
      : { position: "absolute", left: 70, right: 70, top: 230 };
  return (
    <AbsoluteFill style={{ background: C.navy, overflow: "hidden" }}>
      <AbsoluteFill style={{ transform: `scale(${zoom})` }}>
        <Img src={img("living-before")} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
        <AbsoluteFill style={{ clipPath: `inset(0 ${100 - p * 100}% 0 0)` }}>
          <Img src={img("living-scandinavian")} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
        </AbsoluteFill>
      </AbsoluteFill>
      {p > 0 && p < 1 && (
        <div
          style={{
            position: "absolute",
            top: 0,
            bottom: 0,
            left: `${p * 100}%`,
            width: 6,
            marginLeft: -3,
            background: C.lime,
            boxShadow: `0 0 40px 10px ${C.lime}aa`,
          }}
        />
      )}
      <AbsoluteFill
        style={{
          background:
            fmt === "landscape"
              ? "linear-gradient(0deg, rgba(10,13,28,.85) 0%, rgba(10,13,28,.25) 45%, transparent 70%)"
              : "linear-gradient(180deg, rgba(10,13,28,.85) 0%, rgba(10,13,28,.2) 40%, transparent 60%)",
        }}
      />
      <div style={{ ...textBox, fontFamily: theme.display, color: "#fff", fontWeight: 700, fontSize: big, lineHeight: 1.02, letterSpacing: "-0.02em" }}>
        {f < 56 ? (
          <div style={{ opacity: t1, filter: `blur(${(1 - t1) * 10}px)` }}>
            <WordsIn text="Un ambiente vacío" from={4} />
            <br />
            <WordsIn text="no enamora a nadie." from={12} />
          </div>
        ) : (
          <div>
            <WordsIn text="Amoblalo con IA" from={58} highlight={["IA"]} accent={C.lime} />
            <br />
            <WordsIn text="en minutos." from={68} />
          </div>
        )}
      </div>
      <Sequence from={50} durationInFrames={30} layout="none">
        <Audio src={staticFile("sfx/whoosh.wav")} volume={0.5} />
      </Sequence>
    </AbsoluteFill>
  );
};

// ---------- 2. Recorrido por la web ----------
const ddHover = (f: number) => (f < m.ddOpen + 16 ? 0 : f < m.ddOpen + 26 ? Math.min(STYLE_PICK, 1) : STYLE_PICK);

const Walk: React.FC = () => {
  const f = useCurrentFrame();
  const fmt = useFormat();
  const enter = prog(f, 0, 22, out);
  const up = tl.box("studio-uploaded.photo");
  const drop = tl.box("studio-empty.dropzone");
  return (
    <AbsoluteFill>
      <Background theme={theme} glow={C.blue} glow2={C.lime} />
      <Walkthrough
        tl={tl}
        enter={enter}
        accent={C.blue}
        url={(id) => (id === "home" ? "amoblaia.vercel.app" : "amoblaia.vercel.app/estudio")}
        overlays={[
          // Arrastrar la foto hasta la zona de carga
          (f) => <Glow f={f} box={drop} from={m.hover - 8} to={m.drop + 2} color={C.blue} radius={18} pad={-2} />,
          (f, t) => {
            if (f < m.dragStart || f > m.drop + 8) return null;
            const c = t.cursorAt(f)!;
            const k = prog(f, m.drop, m.drop + 8);
            return <DragFile x={c.x + 14} y={c.y + 14} src="amoblaia/img/living-before.webp" name="depto-palermo.jpg" font={theme.font} scale={1 - k * 0.4} opacity={1 - k} />;
          },
          // Menú de estilos
          (f) => (
            <Dropdown f={f} box={tl.box("studio-uploaded.style")} options={STYLES} open={m.ddOpen} close={m.ddClose} hover={ddHover} font={theme.font} accent={C.blue} />
          ),
          // Tipeo del toque personal
          (f) => (
            <TypeIn f={f} box={tl.box("studio-style.notes")} text={NOTES} from={m.typeStart} until={m.typeEnd} cps={CPS} font={theme.font} size={15} bg="#ffffff" pad={{ x: 13, y: 11 }} />
          ),
          // Generando: una línea pinta los muebles sobre la foto
          (f) => <Generating f={f} box={up} from={m.gen + 4} to={m.genDone + 10} />,
        ]}
      />
      <StepCaption theme={theme} n={1} text="Subí la foto del ambiente" from={18} to={m.options + 4} />
      <StepCaption theme={theme} n={2} text="Elegí ambiente y estilo" sub="10 estilos" from={m.options + 8} to={m.gen} />
      <StepCaption theme={theme} n={3} text="La IA lo amobla" sub="y respeta paredes, aberturas y luz" from={m.gen + 4} to={m.end + 6} />
      {keyFrames(NOTES, m.typeStart, CPS).map((k) => (
        <Sequence key={k} from={k} durationInFrames={4} layout="none">
          <Audio src={staticFile("sfx/key.wav")} volume={0.25} />
        </Sequence>
      ))}
      <Sequence from={m.genDone} durationInFrames={30} layout="none">
        <Audio src={staticFile("sfx/chime.wav")} volume={0.35} />
      </Sequence>
      {fmt === "portrait" && <BrandFooter />}
    </AbsoluteFill>
  );
};

const Generating: React.FC<{ f: number; box: { x: number; y: number; w: number; h: number }; from: number; to: number }> = ({ f, box, from, to }) => {
  if (f < from || f > to) return null;
  const v = inOutWindow(f, from, to, 10);
  const p = prog(f, from + 14, to - 18, inOut);
  const done = f > to - 22;
  return (
    <div style={{ position: "absolute", left: box.x, top: box.y, width: box.w, height: box.h, borderRadius: 14, overflow: "hidden" }}>
      <div style={{ position: "absolute", inset: 0, clipPath: `inset(0 ${100 - p * 100}% 0 0)`, opacity: Math.min(1, v * 1.4) }}>
        <Img src={img("living-scandinavian")} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
      </div>
      <div style={{ position: "absolute", inset: 0, background: `rgba(15,20,38,${0.28 * v * (1 - p * 0.8)})` }} />
      {p > 0 && p < 1 && (
        <div style={{ position: "absolute", top: 0, bottom: 0, left: `${p * 100}%`, width: 4, marginLeft: -2, background: C.lime, boxShadow: `0 0 28px 8px ${C.lime}99` }} />
      )}
      <div
        style={{
          position: "absolute",
          left: "50%",
          top: 22,
          transform: `translateX(-50%) translateY(${(1 - v) * -10}px)`,
          opacity: v,
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "10px 18px",
          borderRadius: 999,
          background: "rgba(15,20,38,.82)",
          color: "#fff",
          fontFamily: theme.font,
          fontSize: 17,
          fontWeight: 600,
          backdropFilter: "blur(6px)",
        }}
      >
        <span style={{ color: C.lime }}>✦</span>
        {done ? "¡Listo! 3 propuestas" : "Amoblando tu living…"}
        {!done && (
          <span style={{ width: 90, height: 6, borderRadius: 3, background: "rgba(255,255,255,.2)", overflow: "hidden" }}>
            <span style={{ display: "block", height: "100%", width: `${p * 100}%`, background: C.lime }} />
          </span>
        )}
      </div>
    </div>
  );
};

const BrandFooter: React.FC = () => (
  <div style={{ position: "absolute", left: 0, right: 0, bottom: 120, display: "flex", justifyContent: "center", opacity: 0.9 }}>
    <Logo size={64} />
  </div>
);

// ---------- 3. Antes / después ----------
const Chip: React.FC<{ label: string; side: "left" | "right"; show: number; size?: number }> = ({ label, side, show, size = 26 }) => (
  <div
    style={{
      position: "absolute",
      top: 24,
      [side]: 24,
      padding: "10px 20px",
      borderRadius: 999,
      background: side === "left" ? "rgba(15,20,38,.78)" : C.lime,
      color: side === "left" ? "#fff" : C.ink,
      fontFamily: theme.font,
      fontWeight: 700,
      fontSize: size,
      opacity: show,
    }}
  >
    {label}
  </div>
);

const BeforeAfter: React.FC = () => {
  const fmt = useFormat();
  return (
    <AbsoluteFill>
      <Background theme={theme} glow={C.blue} glow2={C.lime} />
      {fmt === "landscape" ? <SliderCompare /> : <StackedCompare />}
      {fmt === "landscape" ? (
        <StepCaption theme={theme} text="Antes y después, listo para publicar" from={10} to={BA + 10} />
      ) : (
        <StepCaption theme={theme} text={<>Antes y después,<br />listo para publicar</>} from={10} to={BA + 10} />
      )}
    </AbsoluteFill>
  );
};

/** Horizontal: comparador con divisor que recorre la foto. */
const SliderCompare: React.FC = () => {
  const f = useCurrentFrame();
  const k1 = prog(f, 14, 50);
  const k2 = prog(f, 62, 104);
  const k3 = prog(f, 116, 146);
  const pos = 0.5 + 0.38 * k1 - 0.76 * k2 + 0.38 * k3;
  const W = 1600;
  const H = W / 1.5;
  const cardH = 900;
  const cropTop = (H - cardH) / 2;
  return (
    <div style={{ position: "absolute", left: 160, top: 50, width: W, height: cardH, borderRadius: 24, overflow: "hidden", boxShadow: "0 50px 100px -30px rgba(0,0,0,.6)" }}>
      <Img src={img("living-scandinavian")} style={{ position: "absolute", left: 0, top: -cropTop, width: W, height: H }} />
      <div style={{ position: "absolute", inset: 0, clipPath: `inset(0 ${100 - pos * 100}% 0 0)` }}>
        <Img src={img("living-before")} style={{ position: "absolute", left: 0, top: -cropTop, width: W, height: H }} />
      </div>
      <div style={{ position: "absolute", top: 0, bottom: 0, left: `${pos * 100}%`, width: 4, marginLeft: -2, background: "#fff" }} />
      <div
        style={{
          position: "absolute",
          top: "50%",
          left: `${pos * 100}%`,
          width: 64,
          height: 64,
          margin: "-32px 0 0 -32px",
          borderRadius: "50%",
          background: "#fff",
          boxShadow: "0 8px 24px rgba(0,0,0,.35)",
          display: "grid",
          placeItems: "center",
          color: C.ink,
          fontSize: 26,
          fontWeight: 700,
          fontFamily: theme.font,
        }}
      >
        ⟷
      </div>
      <Chip label="Antes" side="left" show={prog(f, 6, 18)} />
      <Chip label="Después" side="right" show={prog(f, 6, 18)} />
    </div>
  );
};

/** Vertical: antes arriba y después abajo, que se pinta con una línea. */
const StackedCompare: React.FC = () => {
  const f = useCurrentFrame();
  const a = prog(f, 4, 22, out);
  const b = prog(f, 26, 44, out);
  const p = prog(f, 44, 92, inOut);
  const card = (top: number, t: number, children: React.ReactNode) => (
    <div
      style={{
        position: "absolute",
        left: 40,
        top,
        width: 1000,
        height: 667,
        borderRadius: 24,
        overflow: "hidden",
        opacity: t,
        transform: `translateY(${(1 - t) * 40}px)`,
        boxShadow: "0 40px 80px -30px rgba(0,0,0,.6)",
      }}
    >
      {children}
    </div>
  );
  return (
    <>
      {card(
        470,
        a,
        <>
          <Img src={img("living-before")} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
          <Chip label="Antes" side="left" show={1} size={30} />
        </>,
      )}
      {card(
        1170,
        b,
        <>
          <Img src={img("living-before")} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
          <div style={{ position: "absolute", inset: 0, clipPath: `inset(0 ${100 - p * 100}% 0 0)` }}>
            <Img src={img("living-scandinavian")} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
          </div>
          {p > 0 && p < 1 && (
            <div style={{ position: "absolute", top: 0, bottom: 0, left: `${p * 100}%`, width: 5, marginLeft: -2, background: C.lime, boxShadow: `0 0 30px 8px ${C.lime}99` }} />
          )}
          <Chip label="Después" side="right" show={1} size={30} />
        </>,
      )}
    </>
  );
};

// ---------- 4. Ambientes y estilos ----------
const GRID_ITEMS = [
  ["quincho-farmhouse", "Quincho · Rústico"],
  ["outdoor-coastal", "Balcón · Costero"],
  ["kitchen-modern", "Cocina · Moderno"],
  ["dining-industrial", "Comedor · Industrial"],
  ["office-minimalist", "Home office · Minimalista"],
  ["bedroom-midcentury", "Dormitorio · Mid-century"],
];

const Grid: React.FC = () => {
  const f = useCurrentFrame();
  const fmt = useFormat();
  const cols = fmt === "landscape" ? 3 : 2;
  const w = fmt === "landscape" ? 540 : 470;
  const h = w / 1.5;
  const gap = fmt === "landscape" ? 26 : 24;
  const top = fmt === "landscape" ? 250 : 560;
  const left = (fmt === "landscape" ? 1920 : 1080) / 2 - (cols * w + (cols - 1) * gap) / 2;
  return (
    <AbsoluteFill>
      <Background theme={theme} glow={C.lime} glow2={C.blue} />
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          top: fmt === "landscape" ? 90 : 220,
          textAlign: "center",
          fontFamily: theme.display,
          color: "#fff",
          fontWeight: 700,
          fontSize: fmt === "landscape" ? 84 : 92,
          letterSpacing: "-0.02em",
          lineHeight: 1.05,
        }}
      >
        <WordsIn text="8 ambientes · 10 estilos" from={4} highlight={["8", "10"]} accent={C.lime} />
      </div>
      {GRID_ITEMS.map(([file, label], i) => {
        const col = i % cols;
        const r = Math.floor(i / cols);
        const t = prog(f, 12 + i * 5, 32 + i * 5, out);
        return (
          <div
            key={file}
            style={{
              position: "absolute",
              left: left + col * (w + gap),
              top: top + r * (h + gap),
              width: w,
              height: h,
              borderRadius: 18,
              overflow: "hidden",
              opacity: t,
              transform: `translateY(${(1 - t) * 40}px) scale(${0.94 + 0.06 * t})`,
              boxShadow: "0 30px 60px -25px rgba(0,0,0,.6)",
            }}
          >
            <Img src={img(file)} style={{ width: "100%", height: "100%", objectFit: "cover", transform: `scale(${1.06 - 0.06 * prog(f, 0, GRID)})` }} />
            <div
              style={{
                position: "absolute",
                left: 14,
                bottom: 14,
                padding: "8px 14px",
                borderRadius: 999,
                background: "rgba(255,255,255,.94)",
                fontFamily: theme.font,
                fontSize: 21,
                fontWeight: 600,
                color: C.ink,
              }}
            >
              {label}
            </div>
          </div>
        );
      })}
      {fmt === "portrait" && <BrandFooter />}
    </AbsoluteFill>
  );
};

// ---------- 5. Cierre ----------
const Outro: React.FC = () => {
  const f = useCurrentFrame();
  const fmt = useFormat();
  const t = prog(f, 0, 20, out);
  const b = prog(f, 26, 44, out);
  return (
    <AbsoluteFill style={{ background: `radial-gradient(circle at 50% 40%, ${C.navy2} 0%, ${C.navy} 60%, #0b0f1e 100%)` }}>
      <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", flexDirection: "column", gap: fmt === "landscape" ? 34 : 46, padding: 60, textAlign: "center" }}>
        <div style={{ opacity: t, transform: `scale(${0.9 + 0.1 * t})` }}>
          <Logo size={fmt === "landscape" ? 96 : 110} />
        </div>
        <div style={{ fontFamily: theme.display, color: "#fff", fontSize: fmt === "landscape" ? 70 : 78, fontWeight: 700, letterSpacing: "-0.02em", lineHeight: 1.08 }}>
          <WordsIn text="Amoblamiento virtual" from={10} />
          {fmt === "portrait" && <br />}
          <WordsIn text="con un clic" from={18} highlight={["clic"]} accent={C.lime} />
        </div>
        <div
          style={{
            opacity: b,
            transform: `translateY(${(1 - b) * 20}px)`,
            padding: fmt === "landscape" ? "22px 44px" : "26px 46px",
            borderRadius: 16,
            background: C.blue,
            color: "#fff",
            fontFamily: theme.font,
            fontSize: fmt === "landscape" ? 38 : 40,
            fontWeight: 600,
            boxShadow: `0 20px 50px -10px ${C.blue}aa`,
          }}
        >
          Probalo gratis en <b>amoblaia.vercel.app</b>
        </div>
        <div style={{ opacity: b, fontFamily: theme.font, color: "rgba(255,255,255,.75)", fontSize: 28 }}>Sin registro · Sin tarjeta de crédito</div>
      </AbsoluteFill>
      <div
        style={{
          position: "absolute",
          left: 40,
          right: 40,
          bottom: fmt === "landscape" ? 28 : 70,
          textAlign: "center",
          fontFamily: theme.font,
          fontSize: 18,
          color: "rgba(255,255,255,.45)",
          opacity: b,
        }}
      >
        Imágenes ilustrativas generadas con amoblaIA. La prueba gratis incluye marca de agua.
      </div>
    </AbsoluteFill>
  );
};

export const AmoblaiaVideo: React.FC = () => {
  const ft = () => fade();
  const tm = linearTiming({ durationInFrames: T });
  return (
    <AbsoluteFill style={{ background: C.navy }}>
      <TransitionSeries>
        <TransitionSeries.Sequence durationInFrames={HOOK}>
          <Hook />
        </TransitionSeries.Sequence>
        <TransitionSeries.Transition presentation={ft()} timing={tm} />
        <TransitionSeries.Sequence durationInFrames={WALK}>
          <Walk />
        </TransitionSeries.Sequence>
        <TransitionSeries.Transition presentation={ft()} timing={tm} />
        <TransitionSeries.Sequence durationInFrames={BA}>
          <BeforeAfter />
        </TransitionSeries.Sequence>
        <TransitionSeries.Transition presentation={ft()} timing={tm} />
        <TransitionSeries.Sequence durationInFrames={GRID}>
          <Grid />
        </TransitionSeries.Sequence>
        <TransitionSeries.Transition presentation={ft()} timing={tm} />
        <TransitionSeries.Sequence durationInFrames={OUTRO}>
          <Outro />
        </TransitionSeries.Sequence>
      </TransitionSeries>
      <Music file="amoblaia.mp3" />
    </AbsoluteFill>
  );
};
