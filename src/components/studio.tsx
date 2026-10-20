"use client";
import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  ArrowRight,
  ArrowUpRight,
  Upload,
  ImagePlus,
  Sparkles,
  Check,
  LoaderCircle,
  Download,
  X,
  FolderOpen,
  Trash2,
  ShieldCheck,
  LockKeyhole,
  ChevronRight,
  Images,
  RotateCcw,
  LogOut,
  Info,
  Eye,
  SplitSquareHorizontal,
} from "lucide-react";
import Link from "next/link";
import {
  beforeImage,
  demoRooms,
  demoStyles,
  afterImage,
  rooms,
  styles,
  modes,
  freeRooms,
  type RoomId,
  type StyleId,
  type ModeId,
} from "@/lib/catalog";
import {
  listProjects,
  saveProject,
  deleteProject,
  type Project,
} from "@/lib/history";
import { optimizePhoto, blobToDataURL, downloadDesign } from "@/lib/images";
import { Comparison } from "./comparison";
import { clearDraft, loadDraft, saveDraft } from "@/lib/studio-draft";
import { FREE_RESULT_LIMIT, freeBatchSize } from "@/lib/free-tier";
export function Studio({
  embedded = false,
  onClose,
}: {
  embedded?: boolean;
  onClose?: () => void;
}) {
  const searchParams = useSearchParams();
  const [openingProject, setOpeningProject] = useState(false);
  const [view, setView] = useState<"create" | "projects">("create");
  const [room, setRoom] = useState<RoomId>("living");
  const [style, setStyle] = useState<StyleId>("modern");
  const [mode, setMode] = useState<ModeId>("furnish");
  const [source, setSource] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [filename, setFilename] = useState("");
  const [demo, setDemo] = useState(false);
  const [result, setResult] = useState("");
  const [busy, setBusy] = useState(false);
  const [reading, setReading] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [dragging, setDragging] = useState(false);
  const [notes, setNotes] = useState("");
  const [projects, setProjects] = useState<Project[]>([]);
  const [status, setStatus] = useState<{
    mode?: "cloud";
    configured: boolean;
    authenticated: boolean;
  } | null>(null);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [variants, setVariants] = useState<Project["variants"]>([]);
  const [credits, setCredits] = useState<number | null>(null);
  const [free, setFree] = useState(false);
  const [freeRemaining, setFreeRemaining] = useState(0);
  const [draftReady, setDraftReady] = useState(false);
  const [roundTotal, setRoundTotal] = useState(3);
  const [round, setRound] = useState(0);
  const requestKey = useRef<string | null>(null);
  const [showLogin, setShowLogin] = useState(false);
  const [password, setPassword] = useState("");
  const [loginBusy, setLoginBusy] = useState(false);
  const [loginError, setLoginError] = useState("");
  const [consent, setConsent] = useState(false);
  const [label, setLabel] = useState(true);
  const [comparison, setComparison] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const resultRef = useRef<HTMLDivElement>(null);
  const loginInput = useRef<HTMLInputElement>(null);
  const loginTrigger = useRef<HTMLButtonElement>(null);
  const generateLock = useRef(false);
  useEffect(() => {
    let active = true;
    void loadDraft()
      .then(async (draft) => {
        if (!active || !draft) return;
        const restored = new File([draft.file], draft.filename, {
          type: draft.file.type || "image/jpeg",
        });
        const url = await blobToDataURL(restored);
        if (!active) return;
        setFile(restored);
        setSource(url);
        setFilename(draft.filename);
        setRoom(draft.room);
        setStyle(draft.style);
        setMode(draft.mode);
        setNotes(draft.notes);
        setConsent(draft.consent);
        setProjectId(draft.projectId);
        setNotice("Recuperamos tu foto. Podés continuar donde estabas.");
      })
      .catch(() => {})
      .finally(() => {
        if (active) setDraftReady(true);
      });
    fetch("/api/session")
      .then((r) => r.json())
      .then(async (state) => {
        if (!active) return;
        setStatus(state);
        const local = await listProjects().catch(() => [] as Project[]);
        if (state.mode === "cloud") {
          setProjects(local.filter((p) => p.demo));
          if (state.authenticated) {
            const [remote, account] = await Promise.all([
              fetch("/api/projects", { cache: "no-store" }).then((r) =>
                r.json(),
              ),
              fetch("/api/account", { cache: "no-store" }).then((r) =>
                r.json(),
              ),
            ]);
            if (!active) return;
            if (remote.error) setNotice(remote.error);
            else
              setProjects([
                ...(remote.projects || []),
                ...local.filter((p) => p.demo),
              ]);
            if (typeof account.credits === "number")
              setCredits(account.credits);
            setFree(account.free === true);
            setFreeRemaining(account.freeRemaining ?? 0);
          }
        } else setProjects(local);
      })
      .catch(() => {
        if (active)
          setNotice(
            "No pudimos cargar tu cuenta. Actualizá la página para volver a intentar.",
          );
      });
    return () => {
      active = false;
    };
  }, []);
  useEffect(() => {
    if (!draftReady || !file || demo) return;
    void saveDraft({
      file,
      filename,
      room,
      style,
      mode,
      notes,
      consent,
      projectId,
      savedAt: Date.now(),
    }).catch(() => {});
  }, [
    draftReady,
    file,
    filename,
    room,
    style,
    mode,
    notes,
    consent,
    projectId,
    demo,
  ]);
  useEffect(() => {
    if (searchParams.get("view") === "projects")
      window.location.replace("/proyectos");
    else setView("create");
  }, [searchParams]);
  useEffect(() => {
    if (!busy) return;
    const start = Date.now();
    const timer = setInterval(
      () => setElapsed(Math.floor((Date.now() - start) / 1000)),
      1000,
    );
    return () => clearInterval(timer);
  }, [busy]);
  useEffect(() => {
    if (showLogin) {
      loginInput.current?.focus();
      const listener = (e: KeyboardEvent) => {
        if (e.key === "Escape") {
          setShowLogin(false);
          loginTrigger.current?.focus();
        }
        if (e.key === "Tab") {
          const items = Array.from(
            document.querySelectorAll<HTMLElement>(
              ".modal button,.modal input,.modal a",
            ),
          );
          const first = items[0],
            last = items[items.length - 1];
          if (e.shiftKey && document.activeElement === first) {
            e.preventDefault();
            last?.focus();
          } else if (!e.shiftKey && document.activeElement === last) {
            e.preventDefault();
            first?.focus();
          }
        }
      };
      document.addEventListener("keydown", listener);
      return () => document.removeEventListener("keydown", listener);
    }
  }, [showLogin]);
  function reset() {
    void clearDraft().catch(() => {});
    setSource("");
    setProjectId(null);
    setVariants([]);
    requestKey.current = null;
    setFile(null);
    setResult("");
    setFilename("");
    setDemo(false);
    setError("");
    setNotice("");
    setConsent(false);
    setView("create");
  }
  async function acceptFile(selected?: File) {
    if (!selected || busy || reading) return;
    setReading(true);
    setError("");
    setNotice("");
    try {
      const photo = await optimizePhoto(selected);
      await saveDraft({
        file: photo.file,
        filename: selected.name,
        room,
        style,
        mode,
        notes,
        consent: false,
        projectId: null,
        savedAt: Date.now(),
      });
      setProjectId(null);
      setVariants([]);
      requestKey.current = null;
      setSource(photo.url);
      setFile(photo.file);
      setFilename(selected.name);
      setResult("");
      setDemo(false);
      setConsent(false);
      setView("create");
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "No pudimos abrir esta imagen.",
      );
    } finally {
      setReading(false);
      if (input.current) input.current.value = "";
    }
  }
  function useExample(r: RoomId) {
    void clearDraft().catch(() => {});
    setProjectId(null);
    setVariants([]);
    requestKey.current = null;
    setRoom(r);
    setStyle("modern");
    setMode("furnish");
    setDemo(true);
    setSource(beforeImage(r));
    setFile(null);
    setFilename(`${rooms.find((x) => x.id === r)?.name} de ejemplo`);
    setResult("");
    setError("");
    setNotice("");
    setView("create");
  }
  function chooseRoom(r: RoomId) {
    setRoom(r);
    setResult("");
    if (demo) {
      setSource(mode === "furnish" ? beforeImage(r) : afterImage(r));
    }
  }
  function chooseMode(m: ModeId) {
    setMode(m);
    setResult("");
    if (demo) setSource(m === "furnish" ? beforeImage(room) : afterImage(room));
  }
  async function persist(image: string) {
    const p: Project = {
      id: crypto.randomUUID(),
      name: filename.replace(/\.[^.]+$/, "") || "Mi espacio",
      original: source,
      result: image,
      createdAt: Date.now(),
      room,
      style,
      mode,
      demo,
    };
    try {
      await saveProject(p);
      if (status?.mode === "cloud") await refreshCloud();
      else setProjects(await listProjects());
      setNotice("Diseño guardado en este navegador.");
    } catch {
      setNotice(
        "El diseño está listo. No pudimos guardarlo en este navegador; descargalo para conservarlo.",
      );
    }
  }
  async function refreshCloud() {
    const [remote, account] = await Promise.all([
      fetch("/api/projects", { cache: "no-store" }).then((r) => r.json()),
      fetch("/api/account", { cache: "no-store" }).then((r) => r.json()),
    ]);
    if (remote.error) throw new Error(remote.error);
    const local = await listProjects().catch(() => [] as Project[]);
    setProjects([...(remote.projects || []), ...local.filter((p) => p.demo)]);
    if (typeof account.credits === "number") setCredits(account.credits);
    setFree(account.free === true);
    setFreeRemaining(account.freeRemaining ?? 0);
    return remote.projects as Project[];
  }
  async function watchJob(id: string) {
    for (let i = 0; i < 85; i++) {
      const response = await fetch(`/api/jobs/${encodeURIComponent(id)}`, {
        cache: "no-store",
      });
      const job = await response.json();
      if (!response.ok) throw new Error(job.error);
      if (job.status === "succeeded") {
        const complete = await refreshCloud();
        const project = complete.find((p) => p.id === job.projectId);
        if (project) await openProject(project);
        setResult(
          project?.variants?.find((v) => v.id === id)?.result || job.result,
        );
        setProjectId(job.projectId);
        setVariants(project?.variants || []);
        setNotice("Diseño guardado en tu cuenta.");
        requestKey.current = null;
        return job.projectId as string;
      }
      if (job.status === "failed" || job.status === "needs_review") {
        requestKey.current = null;
        await refreshCloud();
        throw new Error(job.error);
      }
      await new Promise((resolve) => setTimeout(resolve, 4000));
    }
    setNotice(
      "Tu diseño sigue en proceso. Podés consultar su estado desde Mi cuenta.",
    );
    return null;
  }
  useEffect(() => {
    const id = searchParams.get("job");
    if (
      !id ||
      !status?.authenticated ||
      status.mode !== "cloud" ||
      generateLock.current
    )
      return;
    generateLock.current = true;
    setBusy(true);
    void watchJob(id)
      .catch((e) => setError(e.message))
      .finally(() => {
        generateLock.current = false;
        setBusy(false);
      });
    // A job is resumed once per navigation; its work is persisted on the server.
  }, [searchParams, status?.authenticated, status?.mode]);
  useEffect(() => {
    const id = searchParams.get("project");
    if (!id || openingProject || !projects.length) return;
    const project = projects.find((p) => p.id === id);
    if (!project) return;
    setOpeningProject(true);
    void openProject(project);
  }, [searchParams, projects, openingProject]);
  const freeTier =
    status?.mode === "cloud" &&
    status.authenticated &&
    free &&
    !demo &&
    !(projectId && variants?.some((v) => v.free === false));
  async function generate() {
    if (generateLock.current || !source) return;
    setError("");
    setNotice("");
    if (demo) {
      const image =
        mode === "remove" ? beforeImage(room) : afterImage(room, style);
      setResult(image);
      await persist(image);
      setTimeout(
        () =>
          resultRef.current?.scrollIntoView({
            behavior: "smooth",
            block: "nearest",
          }),
        50,
      );
      return;
    }
    if (!status?.configured) {
      setError(
        "La generación con tus fotos todavía no está habilitada en este piloto. Mientras tanto, podés explorar todos los ejemplos precargados.",
      );
      return;
    }
    if (!status.authenticated) {
      if (status.mode === "cloud") {
        try {
          if (file)
            await saveDraft({
              file,
              filename,
              room,
              style,
              mode,
              notes,
              consent,
              projectId,
              savedAt: Date.now(),
            });
          window.location.assign("/acceso?next=%2Festudio");
        } catch {
          setError(
            "No pudimos conservar la foto en este navegador. Habilitá su almacenamiento antes de ingresar.",
          );
        }
      } else setShowLogin(true);
      return;
    }
    if (freeTier && freeRemaining <= 0) {
      window.location.assign("/precios");
      return;
    }
    if (!consent) {
      setError(
        "Confirmá que podés usar esta foto y enviarla al proveedor de IA.",
      );
      return;
    }
    if (!file) {
      setError(
        "Volvé a cargar la foto original para generar una nueva variante.",
      );
      return;
    }
    generateLock.current = true;
    setBusy(true);
    setElapsed(0);
    setResult("");
    try {
      const data = new FormData();
      data.set("image", file);
      data.set("room", room);
      data.set("style", style);
      data.set("mode", mode);
      data.set("notes", notes);
      if (status.mode === "cloud") {
        // Free results are batched, but the database enforces the lifetime account limit.
        const done = variants?.length || 0;
        const runs = freeTier ? freeBatchSize(freeRemaining) : 1;
        if (!runs)
          throw new Error(
            "Usaste tus 25 diseños gratis. Elegí un plan para seguir creando.",
          );
        setRoundTotal(runs);
        let pid = projectId;
        for (let i = 0; i < runs; i++) {
          setRound(runs > 1 ? i + 1 : 0);
          setElapsed(0);
          requestKey.current ||= crypto.randomUUID();
          data.set("requestKey", requestKey.current);
          data.set("variant", String(((done + i) % 3) + 1));
          if (pid) data.set("projectId", pid);
          const response = await fetch("/api/jobs", {
            method: "POST",
            body: data,
          });
          const job = await response.json();
          if (!response.ok) throw new Error(job.error);
          pid = await watchJob(job.id);
          if (!pid) break;
        }
        return;
      }
      const response = await fetch("/api/generate", {
        method: "POST",
        body: data,
      });
      if (!response.ok) {
        const payload = await response
          .json()
          .catch(() => ({ error: "No pudimos completar la generación." }));
        if (response.status === 401)
          setStatus((s) => (s ? { ...s, authenticated: false } : s));
        throw new Error(payload.error);
      }
      const url = await blobToDataURL(await response.blob());
      setResult(url);
      await persist(url);
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Hubo un problema de conexión. Intentá de nuevo.",
      );
    } finally {
      generateLock.current = false;
      setBusy(false);
      setRound(0);
    }
  }
  async function login(e: React.FormEvent) {
    e.preventDefault();
    setLoginBusy(true);
    setLoginError("");
    try {
      const response = await fetch("/api/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error);
      setStatus({ configured: true, authenticated: true });
      setShowLogin(false);
      setPassword("");
      setNotice("Acceso habilitado. Ya podés generar tu diseño.");
      loginTrigger.current?.focus();
    } catch (e) {
      setLoginError(
        e instanceof Error ? e.message : "No pudimos validar el acceso.",
      );
    } finally {
      setLoginBusy(false);
    }
  }
  async function logout() {
    try {
      const response = await fetch("/api/session", { method: "DELETE" });
      if (!response.ok) throw new Error();
      setStatus((s) => (s ? { ...s, authenticated: false } : s));
      setProjects([]);
      setCredits(null);
      reset();
      setNotice("Cerraste la sesión.");
    } catch {
      setError("No pudimos cerrar la sesión. Intentá de nuevo.");
    }
  }
  async function download(sideBySide = false) {
    try {
      await downloadDesign(
        result,
        `${room}-${style}`,
        sideBySide ? source : undefined,
        label,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "No pudimos descargar.");
    }
  }
  async function openProject(p: Project) {
    setProjectId(p.cloud ? p.id : null);
    setVariants(p.variants || []);
    requestKey.current = null;
    setRoom(p.room);
    setStyle(p.style);
    setMode(p.mode);
    setSource(p.original);
    setResult(p.result);
    setFilename(p.name);
    setDemo(p.demo);
    setFile(null);
    setView("create");
    setError("");
    setConsent(false);
    if (p.pendingJobId && !generateLock.current) {
      generateLock.current = true;
      setBusy(true);
      void watchJob(p.pendingJobId)
        .catch((e) => setError(e.message))
        .finally(() => {
          generateLock.current = false;
          setBusy(false);
        });
    }
    setNotice(
      p.demo
        ? "Ejemplo precargado."
        : "Proyecto recuperado. Podés descargarlo o generar otra variante.",
    );
    if (!p.demo) {
      try {
        const blob = await fetch(p.original).then((r) => r.blob());
        setFile(new File([blob], "room.jpg", { type: "image/jpeg" }));
      } catch {
        setError("No pudimos recuperar el original. Volvé a cargarlo.");
      }
    }
  }
  return (
    <div className={`studio-page ${embedded ? "studio-embedded" : ""}`}>
      {embedded && (
        <button
          className="embedded-close icon-button"
          onClick={onClose}
          aria-label="Cerrar estudio"
        >
          <X size={20} />
        </button>
      )}
      <div className="container">
        <div className="studio-breadcrumb">
          <Link href="/">Inicio</Link>
          <ChevronRight size={13} />
          <span>Estudio de diseño</span>
        </div>
        <div className="studio-heading">
          <div>
            <span className="eyebrow">TU ESPACIO, SU MEJOR VERSIÓN</span>
            <h1>
              Un gran antes.
              <br className="mobile-break" /> Un mejor después
              <span className="accent">.</span>
            </h1>
            <p>
              Subí una foto, elegí el estilo y dejá que aparezcan las
              posibilidades.
            </p>
          </div>
          <div className="status-badge">
            <span className="live-dot" />
            {status?.mode === "cloud" ? (
              <Link href="/cuenta">
                {status.authenticated
                  ? free
                    ? `${freeRemaining} diseños gratis · Mi cuenta`
                    : `${credits ?? "…"} fotos · Mi cuenta`
                  : "Ingresar a mi cuenta"}
              </Link>
            ) : status?.configured ? (
              "Piloto de IA"
            ) : (
              "Modo demo"
            )}
            {status?.authenticated && (
              <button
                className="icon-button"
                onClick={logout}
                title="Cerrar sesión"
                aria-label="Cerrar sesión"
              >
                <LogOut size={15} />
              </button>
            )}
          </div>
        </div>
        <div className="studio-tabs">
          <button
            className={view === "create" ? "selected" : ""}
            onClick={() => setView("create")}
          >
            <Sparkles size={17} /> Nuevo diseño
          </button>
          <button
            className={view === "projects" ? "selected" : ""}
            onClick={() => window.location.assign("/proyectos")}
          >
            <FolderOpen size={17} /> Mis proyectos{" "}
            <span>{projects.length}</span>
          </button>
          <span className="local-label">
            <ShieldCheck size={14} />{" "}
            {status?.mode === "cloud"
              ? "Tus diseños con IA quedan en tu cuenta"
              : "Tus proyectos quedan en este navegador"}
          </span>
        </div>
        {view === "projects" ? (
          <div className="projects-view">
            <div className="projects-header">
              <div>
                <h2>Tu colección de espacios</h2>
                <p>
                  {status?.mode === "cloud"
                    ? "Tus fotos originales, con sus variantes. Los ejemplos demo quedan en este dispositivo."
                    : "Los últimos 20 diseños que guardaste en este dispositivo."}
                </p>
              </div>
              <button className="button button-dark" onClick={reset}>
                <ImagePlus size={17} /> Nuevo diseño
              </button>
            </div>
            {projects.length === 0 ? (
              <div className="empty-projects">
                <FolderOpen size={42} />
                <h3>Acá empieza tu colección.</h3>
                <p>Creá tu primer diseño y lo vas a encontrar acá.</p>
                <button className="button button-dark" onClick={reset}>
                  Crear mi primer diseño <ArrowUpRight size={17} />
                </button>
              </div>
            ) : (
              <div className="projects-grid">
                {projects.map((p) => (
                  <article className="project-card" key={p.id}>
                    <button
                      className="project-image"
                      onClick={() => openProject(p)}
                    >
                      <img src={p.result || p.original} alt={p.name} />
                      <span>
                        {p.demo
                          ? "Demo"
                          : p.pendingJobId
                            ? "Generando…"
                            : p.variants
                              ? `${p.variants.length} diseños`
                              : "Diseño con IA"}
                      </span>
                    </button>
                    <div className="project-info">
                      <button onClick={() => openProject(p)}>
                        <h3>{p.name}</h3>
                        <p>
                          {styles.find((s) => s.id === p.style)?.name} ·{" "}
                          {new Date(p.createdAt).toLocaleDateString("es-AR")}
                        </p>
                      </button>
                      {deleteId === p.id ? (
                        <div className="delete-confirm">
                          <button
                            onClick={async () => {
                              try {
                                if (p.cloud) {
                                  const response = await fetch(
                                    `/api/projects/${p.id}`,
                                    {
                                      method: "PATCH",
                                      headers: {
                                        "Content-Type": "application/json",
                                      },
                                      body: JSON.stringify({ action: "trash" }),
                                    },
                                  );
                                  const payload = await response.json();
                                  if (!response.ok)
                                    throw new Error(payload.error);
                                  await refreshCloud();
                                } else {
                                  await deleteProject(p.id);
                                  if (status?.mode === "cloud")
                                    await refreshCloud();
                                  else setProjects(await listProjects());
                                }
                                setDeleteId(null);
                              } catch (e) {
                                setError(
                                  e instanceof Error
                                    ? e.message
                                    : "No pudimos borrar el proyecto.",
                                );
                              }
                            }}
                          >
                            Borrar
                          </button>
                          <button onClick={() => setDeleteId(null)}>
                            Cancelar
                          </button>
                        </div>
                      ) : (
                        <button
                          className="icon-button"
                          aria-label={`Borrar ${p.name}`}
                          onClick={() => setDeleteId(p.id)}
                        >
                          <Trash2 size={17} />
                        </button>
                      )}
                    </div>
                  </article>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div
            className={`workspace ${result ? "has-results" : ""} ${freeTier && result ? "with-upsell" : ""}`}
          >
            <div className="studio-canvas">
              <div className="canvas-heading">
                <h2>
                  <span className="section-number">01</span>{" "}
                  {result
                    ? "Tu espacio, transformado"
                    : "La foto de tu espacio"}
                </h2>
                {source && !busy && (
                  <button className="subtle-button" onClick={reset}>
                    <RotateCcw size={14} /> Cambiar foto
                  </button>
                )}
              </div>
              <input
                ref={input}
                className="visually-hidden"
                type="file"
                accept="image/jpeg,image/png,image/webp"
                aria-label="Subir foto de la propiedad"
                onChange={(e) => acceptFile(e.target.files?.[0])}
              />
              {!source ? (
                <div
                  className={`dropzone ${dragging ? "dragging" : ""}`}
                  onDragOver={(e) => {
                    e.preventDefault();
                    setDragging(true);
                  }}
                  onDragLeave={() => setDragging(false)}
                  onDrop={(e) => {
                    e.preventDefault();
                    setDragging(false);
                    void acceptFile(e.dataTransfer.files[0]);
                  }}
                >
                  <div className="upload-illustration">
                    <span className="upload-sheet one" />
                    <span className="upload-sheet two" />
                    <div>
                      <ImagePlus size={34} strokeWidth={1.4} />
                    </div>
                    <span className="upload-spark">
                      <Sparkles size={16} />
                    </span>
                  </div>
                  <h3>
                    {reading
                      ? "Preparando tu foto…"
                      : "Todo empieza con una foto."}
                  </h3>
                  <p>Arrastrala hasta acá o elegila desde tu dispositivo.</p>
                  <button
                    className="button button-primary"
                    onClick={() => input.current?.click()}
                    disabled={reading}
                  >
                    {reading ? (
                      <LoaderCircle className="spin" size={17} />
                    ) : (
                      <Upload size={17} />
                    )}{" "}
                    Subir mi foto <ArrowUpRight size={16} />
                  </button>
                  <span className="upload-meta">
                    JPG, PNG o WebP · Hasta 10 MB
                  </span>
                </div>
              ) : (
                <div className="canvas-photo" ref={resultRef}>
                  {result && comparison ? (
                    <Comparison before={source} after={result} />
                  ) : (
                    <img
                      src={result || source}
                      alt={
                        result
                          ? "Diseño de tu ambiente"
                          : "Foto original de tu propiedad"
                      }
                    />
                  )}
                  <span className="photo-name">
                    {demo ? "EJEMPLO DEMO" : filename}
                  </span>
                  {busy && (
                    <div className="generating-overlay">
                      <div className="generating-icon">
                        <Sparkles size={32} />
                      </div>
                      <h3>
                        {round
                          ? `Creando el diseño ${round} de ${roundTotal}…`
                          : "Tu espacio está tomando forma."}
                      </h3>
                      <p>
                        {elapsed < 20
                          ? "Analizando la foto y su perspectiva…"
                          : elapsed < 60
                            ? "Diseñando muebles, materiales y luz…"
                            : "Cuidando los últimos detalles del ambiente…"}
                      </p>
                      <span>
                        <LoaderCircle size={14} className="spin" /> {elapsed} s
                        · Puede demorar varios minutos
                      </span>
                      <p className="generation-hint">
                        Mantené esta página abierta para recibir el resultado.
                      </p>
                    </div>
                  )}
                </div>
              )}
              {variants && variants.length > 0 && !busy && (
                <div
                  className="variant-picker"
                  aria-label="Variantes de esta foto"
                >
                  {variants.map((v, i) => (
                    <button
                      key={v.id}
                      className={result === v.result ? "selected" : ""}
                      onClick={() => {
                        setResult(v.result);
                        setRoom(v.room);
                        setStyle(v.style);
                        setMode(v.mode);
                        setNotes(v.notes);
                      }}
                    >
                      <img src={v.result} alt="" />
                      Diseño {variants.length - i}
                    </button>
                  ))}
                </div>
              )}
              {result && (
                <div className="result-actions">
                  <div className="result-success">
                    <Check size={17} />
                    <span>
                      {demo
                        ? "Ejemplo listo para explorar"
                        : "Tu diseño está listo"}
                    </span>
                    <button
                      className="icon-button"
                      aria-label={
                        comparison ? "Ver solo el resultado" : "Ver comparación"
                      }
                      onClick={() => setComparison(!comparison)}
                    >
                      {comparison ? (
                        <Eye size={17} />
                      ) : (
                        <SplitSquareHorizontal size={17} />
                      )}
                    </button>
                  </div>
                  <div className="download-actions">
                    <button
                      className="button button-dark"
                      onClick={() => download()}
                    >
                      <Download size={16} /> Descargar JPG
                    </button>
                    <button
                      className="button button-outline"
                      onClick={() => download(true)}
                    >
                      <Images size={16} /> Antes y después
                    </button>
                  </div>
                  <label className="checkbox-label">
                    <input
                      type="checkbox"
                      checked={label}
                      onChange={(e) => setLabel(e.target.checked)}
                    />{" "}
                    Incluir etiqueta «Amoblamiento virtual»
                  </label>
                </div>
              )}
              <div className="examples">
                <div className="examples-heading">
                  <span>¿SOLO ESTÁS EXPLORANDO?</span>
                  <p>
                    Probá con un espacio de ejemplo <ArrowRight size={14} />
                  </p>
                </div>
                <div className="example-grid">
                  {demoRooms.map((r) => (
                    <button
                      key={r}
                      onClick={() => useExample(r)}
                      disabled={busy || reading}
                      aria-label={`Usar ejemplo de ${rooms.find((x) => x.id === r)?.name}`}
                      className={demo && room === r ? "selected" : ""}
                    >
                      <img src={beforeImage(r)} alt="" />
                      <span>{rooms.find((x) => x.id === r)?.name}</span>
                      {demo && room === r && (
                        <span className="example-check">
                          <Check size={13} />
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              </div>
              <div className="studio-tip">
                <ShieldCheck size={18} />
                <p>
                  <strong>La arquitectura es el punto de partida.</strong>{" "}
                  Comprobá que el resultado conserve las características reales
                  antes de publicar.
                </p>
              </div>
            </div>
            <aside className="settings-panel">
              {source && (
                <div className="input-preview">
                  <h3>Tu foto original</h3>
                  <img src={source} alt="Foto original" />
                  <button
                    className="subtle-button"
                    onClick={reset}
                    disabled={busy}
                  >
                    Probar otra foto
                  </button>
                </div>
              )}
              <div className="settings-heading">
                <h2>
                  <span className="section-number">02</span> Diseñá a tu manera
                </h2>
                <span>Un poco de vos. Un poco de IA.</span>
              </div>
              <fieldset disabled={busy || reading}>
                <legend>¿Qué querés hacer?</legend>
                <div className="mode-options">
                  {modes.map((m) => (
                    <button
                      key={m.id}
                      className={mode === m.id ? "selected" : ""}
                      onClick={() => chooseMode(m.id)}
                      title={
                        freeTier && !["furnish", "redesign"].includes(m.id)
                          ? "Incluido en los planes pagos"
                          : m.description
                      }
                      disabled={
                        (freeTier && !["furnish", "redesign"].includes(m.id)) ||
                        (demo && ["enhance", "dusk"].includes(m.id))
                      }
                    >
                      {freeTier && !["furnish", "redesign"].includes(m.id) && (
                        <LockKeyhole size={12} />
                      )}{" "}
                      {m.name}
                    </button>
                  ))}
                </div>
                <p className="field-hint">
                  {modes.find((m) => m.id === mode)?.description}
                </p>
              </fieldset>
              <fieldset disabled={busy || reading}>
                <legend>Elegí el ambiente</legend>
                <select
                  className="studio-select"
                  aria-label="Tipo de ambiente"
                  value={room}
                  onChange={(e) => chooseRoom(e.target.value as RoomId)}
                >
                  {rooms.map((r) => (
                    <option
                      key={r.id}
                      value={r.id}
                      disabled={
                        (freeTier && !freeRooms.includes(r.id)) ||
                        (demo &&
                          !(demoRooms as readonly string[]).includes(r.id))
                      }
                    >
                      {r.name}
                      {freeTier && !freeRooms.includes(r.id)
                        ? " · Plan pago"
                        : ""}
                    </option>
                  ))}
                </select>
              </fieldset>
              <fieldset
                disabled={
                  busy ||
                  reading ||
                  ["remove", "enhance", "dusk"].includes(mode)
                }
              >
                <legend>
                  Encontrá tu estilo <span>{styles.length} opciones</span>
                </legend>
                <select
                  className="studio-select"
                  aria-label="Estilo de muebles"
                  value={style}
                  onChange={(e) => {
                    setStyle(e.target.value as StyleId);
                    setResult("");
                  }}
                >
                  {styles.map((s) => (
                    <option
                      key={s.id}
                      value={s.id}
                      disabled={
                        demo &&
                        !(demoStyles as readonly string[]).includes(s.id)
                      }
                    >
                      {s.name}
                    </option>
                  ))}
                </select>
                <p className="field-hint">
                  {styles.find((s) => s.id === style)?.description}
                </p>
                {demo && (
                  <p className="field-hint">
                    Los ejemplos incluyen 2 estilos precargados. Con tu foto
                    podés explorar los {styles.length}.
                  </p>
                )}
              </fieldset>
              <div className="notes-field">
                <label htmlFor="design-notes">
                  Un toque personal <span>opcional</span>
                </label>
                <textarea
                  id="design-notes"
                  placeholder="Ej.: tonos cálidos, sofá de lino, detalles en madera…"
                  maxLength={500}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  disabled={busy || demo || mode === "remove"}
                />
                <span>{notes.length}/500</span>
              </div>
              {source && !demo && (
                <label className="checkbox-label consent">
                  <input
                    type="checkbox"
                    checked={consent}
                    onChange={(e) => setConsent(e.target.checked)}
                    disabled={busy}
                  />{" "}
                  Tengo permiso para usar esta foto y enviarla a nuestro
                  proveedor de inteligencia artificial para generar el diseño.
                </label>
              )}
              <div className="generate-area">
                <button
                  ref={loginTrigger}
                  className="button button-primary generate-button"
                  onClick={generate}
                  disabled={!source || busy || reading}
                >
                  {busy ? (
                    <LoaderCircle size={19} className="spin" />
                  ) : (
                    <Sparkles size={19} />
                  )}{" "}
                  {busy
                    ? "Creando tu diseño…"
                    : demo
                      ? "Ver transformación de ejemplo"
                      : freeTier
                        ? freeRemaining > 0
                          ? `Crear ${freeBatchSize(freeRemaining)} diseños gratis`
                          : "Ver planes"
                        : result
                          ? "Generar otra variante"
                          : "Generar mi diseño"}
                  {!busy && <ArrowUpRight size={19} />}
                </button>
                <p>
                  {demo
                    ? "Demo precargada · No consume API"
                    : freeTier
                      ? `${freeRemaining} de ${FREE_RESULT_LIMIT} diseños gratis disponibles · Con marca de agua`
                      : status?.configured
                        ? status.mode === "cloud"
                          ? "Calidad alta · Regeneraciones incluidas"
                          : "Calidad alta · Acceso de piloto"
                        : "Explorá gratis los ejemplos precargados"}
                </p>
              </div>
              {status?.configured &&
                !status.authenticated &&
                !demo &&
                status.mode !== "cloud" && (
                  <button
                    className="pilot-link"
                    onClick={() => setShowLogin(true)}
                  >
                    <LockKeyhole size={13} /> Tengo una clave de acceso
                  </button>
                )}
            </aside>
            {freeTier && result && (
              <aside className="free-upsell">
                <span className="free-pill">Planes desde 6 fotos por mes</span>
                <h3>La versión completa incluye</h3>
                <ul>
                  {[
                    "Sin marca de agua",
                    "Alta resolución",
                    "Todos los ambientes y estilos",
                    "Retiro de muebles incluido",
                  ].map((t) => (
                    <li key={t}>
                      <Check size={16} /> {t}
                    </li>
                  ))}
                </ul>
                <Link href="/precios" className="button button-primary">
                  <LockKeyhole size={17} /> Desbloquear todo
                </Link>
              </aside>
            )}
          </div>
        )}
        {error && (
          <div className="feedback error" role="alert">
            <Info size={18} />
            <p>{error}</p>
            <button
              className="icon-button"
              aria-label="Cerrar error"
              onClick={() => setError("")}
            >
              <X size={16} />
            </button>
          </div>
        )}
        {notice && (
          <div className="feedback notice" role="status">
            <Check size={18} />
            <p>{notice}</p>
            <button
              className="icon-button"
              aria-label="Cerrar aviso"
              onClick={() => setNotice("")}
            >
              <X size={16} />
            </button>
          </div>
        )}
        <div className="studio-bottom">
          <span>
            <LockKeyhole size={13} /> Las fotos se procesan solo cuando generás.
          </span>
          <Link href="/privacidad">
            Cómo cuidamos tus fotos <ArrowUpRight size={13} />
          </Link>
        </div>
      </div>
      {showLogin && (
        <div
          className="modal-backdrop"
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setShowLogin(false);
              loginTrigger.current?.focus();
            }
          }}
        >
          <section
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="login-title"
          >
            <button
              className="modal-close icon-button"
              aria-label="Cerrar acceso"
              onClick={() => {
                setShowLogin(false);
                loginTrigger.current?.focus();
              }}
            >
              <X size={20} />
            </button>
            <span className="modal-icon">
              <LockKeyhole size={25} />
            </span>
            <span className="eyebrow">ACCESO AL PILOTO</span>
            <h2 id="login-title">Tu estudio te espera.</h2>
            <p>
              Ingresá la clave que te compartió el equipo de amoblaIA para crear
              diseños con tus fotos.
            </p>
            <form onSubmit={login}>
              <label htmlFor="pilot-password">Clave de acceso</label>
              <input
                ref={loginInput}
                id="pilot-password"
                type="password"
                autoComplete="current-password"
                placeholder="Tu clave del piloto"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                maxLength={256}
              />
              {loginError && (
                <p className="form-error" role="alert">
                  {loginError}
                </p>
              )}
              <button className="button button-dark" disabled={loginBusy}>
                {loginBusy ? <LoaderCircle className="spin" size={17} /> : null}{" "}
                Entrar al estudio <ArrowRight size={17} />
              </button>
            </form>
            <span>Acceso seguro durante 8 horas en este dispositivo.</span>
          </section>
        </div>
      )}
    </div>
  );
}
