import React from "react";
import { Img, staticFile } from "remotion";

/** Marco de navegador (barra con semáforo y URL). Los hijos ocupan el área de contenido. */
export const Browser: React.FC<{
  w: number;
  h: number;
  bar: number;
  url: string;
  /** Ícono de una extensión a la derecha de la barra (como la de Maru). */
  extensionIcon?: string;
  extensionBadge?: React.ReactNode;
  children: React.ReactNode;
  style?: React.CSSProperties;
}> = ({ w, h, bar, url, extensionIcon, extensionBadge, children, style }) => {
  const dot = (c: string) => (
    <span style={{ width: bar * 0.3, height: bar * 0.3, borderRadius: "50%", background: c, display: "inline-block" }} />
  );
  return (
    <div
      style={{
        position: "absolute",
        width: w,
        height: h,
        borderRadius: 16,
        overflow: "hidden",
        background: "#fff",
        boxShadow: "0 0 0 1px rgba(0,0,0,.08), 0 40px 80px -20px rgba(0,0,0,.45), 0 12px 30px -10px rgba(0,0,0,.3)",
        ...style,
      }}
    >
      <div
        style={{
          height: bar,
          background: "#eceef1",
          borderBottom: "1px solid #dcdfe4",
          display: "flex",
          alignItems: "center",
          padding: `0 ${bar * 0.45}px`,
          gap: bar * 0.2,
          position: "relative",
        }}
      >
        {dot("#ff5f57")}
        {dot("#febc2e")}
        {dot("#28c840")}
        <div
          style={{
            position: "absolute",
            left: "50%",
            transform: "translateX(-50%)",
            height: bar * 0.66,
            minWidth: w * 0.42,
            borderRadius: bar,
            background: "#fff",
            border: "1px solid #dfe2e7",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 8,
            fontFamily: "Inter, system-ui, sans-serif",
            fontSize: bar * 0.36,
            color: "#3c4049",
            padding: "0 18px",
          }}
        >
          <svg width={bar * 0.3} height={bar * 0.3} viewBox="0 0 24 24" fill="none" stroke="#6b7280" strokeWidth={2.4}>
            <rect x="5" y="11" width="14" height="10" rx="2" />
            <path d="M8 11V8a4 4 0 0 1 8 0v3" />
          </svg>
          {url}
        </div>
        {extensionIcon && (
          <div style={{ position: "absolute", right: bar * 0.95 - bar * 0.36, top: bar * 0.14, width: bar * 0.72, height: bar * 0.72, borderRadius: 8, display: "grid", placeItems: "center" }}>
            <Img src={staticFile(extensionIcon)} style={{ width: bar * 0.56, height: bar * 0.56, borderRadius: 5, position: "relative", zIndex: 1 }} />
            {extensionBadge}
          </div>
        )}
      </div>
      <div style={{ position: "relative", width: w, height: h - bar, overflow: "hidden" }}>{children}</div>
    </div>
  );
};
