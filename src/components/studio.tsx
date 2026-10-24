"use client";
import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
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
  ShieldCheck,
  LockKeyhole,
  Images,
  RotateCcw,
  LogOut,
  Info,
  Eye,
  SplitSquareHorizontal,
  Sofa,
  RefreshCw,
  Eraser,
  WandSparkles,
  Sunset,
} from "lucide-react";
import Link from "next/link";
import {
  beforeImage,
  demoRooms,
  afterImage,
  rooms,
  styles,
  modes,
  normalizeStyle,
  freeRooms,
  type RoomId,
  type StyleId,
  type ModeId,
} from "@/lib/catalog";
import { listProjects, saveProject, type Project } from "@/lib/history";
import { optimizePhoto, blobToDataURL, downloadDesign } from "@/lib/images";
import { Comparison } from "./comparison";
import { clearDraft, loadDraft, saveDraft } from "@/lib/studio-draft";
import { FREE_RESULT_LIMIT, freeBatchSize } from "@/lib/free-tier";
import { trackPhotoUploaded } from "@/lib/ads";
import { metaTrack } from "@/lib/meta";
import { waitForJob } from "@/lib/jobs-client";
import { BatchList, useBatch } from "./batch-queue";
// Staging changes the furniture; the photo modes only retouch the picture.
const stagingModes = [
  { id: "furnish", icon: Sofa },
  { id: "redesign", icon: RefreshCw },
  { id: "remove", icon: Eraser },
] as const;
const photoModes = [
  { id: "enhance", icon: WandSparkles, label: "Mejorar foto" },
  { id: "dusk", icon: Sunset, label: "Atardecer" },
] as const;
export function Studio({
  embedded = false,
  onClose,
}: {
  embedded?: boolean;
  onClose?: () => void;
}) {
  const searchParams = useSearchParams();
  const [openingProject, setOpeningProject] = useState(false);
  const [cloudReady, setCloudReady] = useState(false);
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
    anonymous?: boolean;
  } | null>(null);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [variants, setVariants] = useState<Project["variants"]>([]);
  const [credits, setCredits] = useState<number | null>(null);
  const [unlimited, setUnlimited] = useState(false);
  const [free, setFree] = useState(false);
  const [freeRemaining, setFreeRemaining] = useState(0);
  const [draftReady, setDraftReady] = useState(false);
  const [roundTotal, setRoundTotal] = useState(3);
  const [round, setRound] = useState(0);
  const [batchCompleted, setBatchCompleted] = useState(0);
  const requestKey = useRef<string | null>(null);
  // Bumped whenever another photo is opened: results that arrive late for an
  // earlier photo must not replace what is on screen (nor its project id).
  const photoSession = useRef(0);
  // Photo session already reported to Meta: a regeneration is not an upload.
  const trackedUpload = useRef(-1);
  const [showLogin, setShowLogin] = useState(false);
  const [password, setPassword] = useState("");
  const [loginBusy, setLoginBusy] = useState(false);
  const [loginError, setLoginError] = useState("");
  const [label, setLabel] = useState(true);
  const [comparison, setComparison] = useState(false);
  // Width over height of the photo on screen, so the stage fits it whole.
  const [aspect, setAspect] = useState(4 / 3);
  const input = useRef<HTMLInputElement>(null);
  const resultRef = useRef<HTMLDivElement>(null);
  const loginInput = useRef<HTMLInputElement>(null);
  const loginTrigger = useRef<HTMLButtonElement>(null);
  const generateLock = useRef(false);
  const restoringProject = useRef<string | null>(null);
  // Each photo only updates the balance: the full library signs every image
  // of the account, so it is reloaded once the batch ends.
  const batch = useBatch(
    (finished) =>
      void (finished ? refreshCloud() : refreshAccount()).catch(() => null),
  );
  const batchMode = batch.items.length > 0;
  useEffect(() => {
    let active = true;
    void loadDraft()
      .then(async (draft) => {
        if (
          !active ||
          !draft ||
          searchParams.get("project") ||
          searchParams.get("job")
        )
          return;
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
        setProjectId(draft.projectId);
        restoringProject.current = draft.projectId;
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
        if (state.mode === "cloud" && !state.authenticated && !state.anonymous)
          setFreeRemaining(FREE_RESULT_LIMIT);
        const local = await listProjects().catch(() => [] as Project[]);
        if (state.mode === "cloud") {
          setProjects(local.filter((p) => p.demo));
          if (state.authenticated || state.anonymous) {
            const [remote, account] = await Promise.all([
              fetch("/api/projects", { cache: "no-store" }).then((r) =>
                r.json(),
              ),
              fetch("/api/account", { cache: "no-store" }).then((r) =>
                r.json(),
              ),
            ]);
            if (!active) return;
            if (account.error) throw new Error(account.error);
            if (remote.error) setNotice(remote.error);
            else
              setProjects([
                ...(remote.projects || []),
                ...local.filter((p) => p.demo),
              ]);
            if (typeof account.credits === "number")
              setCredits(account.credits);
            setUnlimited(account.unlimited === true);
            setFree(account.free === true);
            setFreeRemaining(account.freeRemaining ?? 0);
            setCloudReady(true);
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
      projectId,
      savedAt: Date.now(),
    }).catch(() => {});
  }, [draftReady, file, filename, room, style, mode, notes, projectId, demo]);
  useEffect(() => {
    if (searchParams.get("view") === "projects")
      window.location.replace("/proyectos");
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
  // Notices confirm and step aside (on phones they cover the actions);
  // errors stay until closed.
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(
      () => setNotice(""),
      Math.max(5000, notice.length * 70),
    );
    return () => clearTimeout(timer);
  }, [notice]);
  // The request key makes a retry return the same batch; with different
  // settings it must be a new request, not a replay of the old one.
  useEffect(() => {
    requestKey.current = null;
  }, [room, style, mode, notes]);
  function reset() {
    photoSession.current++;
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
        projectId: null,
        savedAt: Date.now(),
      });
      photoSession.current++;
      setProjectId(null);
      setVariants([]);
      requestKey.current = null;
      setSource(photo.url);
      setFile(photo.file);
      setFilename(selected.name);
      setResult("");
      setDemo(false);
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "No pudimos abrir esta imagen.",
      );
    } finally {
      setReading(false);
      if (input.current) input.current.value = "";
    }
  }
  async function acceptFiles(selected: File[]) {
    if (!selected.length) return;
    if (batchMode || (selected.length > 1 && batchAllowed)) {
      if (input.current) input.current.value = "";
      setError("");
      setNotice("");
      const problems = await batch.add(selected, room);
      if (problems.length) setError(problems.join(" "));
      return;
    }
    await acceptFile(selected[0]);
    if (selected.length > 1 && status?.mode === "cloud")
      setNotice(
        "Subir varias fotos juntas está incluido en los planes pagos. Abrimos la primera.",
      );
  }
  function startBatch() {
    setError("");
    setNotice("");
    void batch.start({ style, mode, notes }).then((stop) => {
      if (stop) setError(stop);
    });
  }
  function useExample(r: RoomId) {
    photoSession.current++;
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
    if (remote.error || account.error)
      throw new Error(remote.error || account.error);
    const local = await listProjects().catch(() => [] as Project[]);
    setProjects([...(remote.projects || []), ...local.filter((p) => p.demo)]);
    applyAccount(account);
    return remote.projects as Project[];
  }
  async function refreshAccount() {
    const account = await fetch("/api/account", { cache: "no-store" }).then(
      (r) => r.json(),
    );
    if (account.error) throw new Error(account.error);
    applyAccount(account);
  }
  function applyAccount(account: {
    credits?: number;
    unlimited?: boolean;
    free?: boolean;
    freeRemaining?: number;
  }) {
    if (typeof account.credits === "number") setCredits(account.credits);
    setUnlimited(account.unlimited === true);
    setFree(account.free === true);
    setFreeRemaining(account.freeRemaining ?? 0);
  }
  async function watchJob(id: string) {
    const session = photoSession.current;
    const current = () => session === photoSession.current;
    const job = await waitForJob(id);
    if (!job) {
      if (current())
        setNotice(
          "Tu diseño sigue en proceso. Podés consultar su estado desde Mi cuenta.",
        );
      return null;
    }
    if (job.status === "succeeded") {
      if (!job.result || !job.variant)
        throw new Error(
          "No pudimos recuperar esta imagen. Volvé a abrir la foto desde tus proyectos.",
        );
      if (!current()) return job.projectId || null;
      // Publish the finished image before fetching the rest of the library.
      setResult(job.result);
      setBatchCompleted((n) => n + 1);
      setProjectId(job.projectId || null);
      const variant = job.variant;
      setVariants((previous) => [
        variant,
        ...(previous || []).filter((v) => v.id !== id),
      ]);
      setNotice("Diseño listo y guardado.");
      requestKey.current = null;
      return job.projectId || null;
    }
    if (!current()) return null;
    requestKey.current = null;
    await refreshCloud().catch(() => null);
    throw new Error(job.error);
  }
  useEffect(() => {
    const id = searchParams.get("job");
    if (!id || !cloudReady || openingProject) return;
    const project = projects.find(
      (p) =>
        p.pendingJobId === id ||
        p.pendingJobIds?.includes(id) ||
        p.variants?.some((v) => v.id === id),
    );
    setOpeningProject(true);
    if (project) void openProject(project);
    else setError("No encontramos esa generación en tus fotos.");
  }, [searchParams, cloudReady, projects, openingProject]);
  useEffect(() => {
    const id = searchParams.get("project");
    if (!id || openingProject || !cloudReady) return;
    const project = projects.find((p) => p.id === id);
    setOpeningProject(true);
    if (project) void openProject(project);
    else setError("No encontramos esa foto. Revisá también la papelera.");
  }, [searchParams, projects, openingProject, cloudReady]);
  useEffect(() => {
    const id = restoringProject.current;
    if (!draftReady || !id || !cloudReady) return;
    const project = projects.find((p) => p.id === id);
    if (!project) {
      restoringProject.current = null;
      setProjectId(null);
      setVariants([]);
      return;
    }
    restoringProject.current = null;
    setResult(project.result);
    setVariants(project.variants || []);
    const pending = project.pendingJobIds?.length
      ? project.pendingJobIds
      : project.pendingJobId
        ? [project.pendingJobId]
        : [];
    if (pending.length && !generateLock.current) {
      generateLock.current = true;
      setBusy(true);
      setRoundTotal(pending.length);
      setBatchCompleted(0);
      void Promise.allSettled(pending.map((id) => watchJob(id)))
        .then(() => refreshCloud())
        .catch(() =>
          setNotice(
            "El proceso queda guardado. Volvé a abrir esta foto para consultar su estado.",
          ),
        )
        .finally(() => {
          generateLock.current = false;
          setBusy(false);
        });
    }
  }, [draftReady, projects, cloudReady]);
  const freeTier =
    status?.mode === "cloud" &&
    (!status.authenticated || free) &&
    !demo &&
    !(projectId && variants?.some((v) => v.free === false));
  // Several photos at once is part of the paid plans.
  const batchAllowed =
    status?.mode === "cloud" &&
    status.authenticated &&
    !status.anonymous &&
    cloudReady &&
    !free;
  const locked = busy || batch.running;
  function trackUpload() {
    if (trackedUpload.current === photoSession.current) return;
    trackedUpload.current = photoSession.current;
    metaTrack("amoblaia_foto_subida", { ambiente: room, estilo: style });
  }
  async function generate() {
    if (generateLock.current || !source) return;
    // Set when a batch is already running: opened once the lock is released.
    let resume: Project | null = null;
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
    if (!file) {
      setError(
        "Volvé a cargar la foto original para generar una nueva variante.",
      );
      return;
    }
    let activeStatus = status;
    let activeProjectId = projectId;
    let availableFree = freeRemaining;
    let activeFreeTier = freeTier;
    if (!status.authenticated && !status.anonymous) {
      if (status.mode === "cloud") {
        generateLock.current = true;
        setBusy(true);
        try {
          const response = await fetch("/api/guest", { method: "POST" });
          const guest = await response.json();
          if (!response.ok) throw new Error(guest.error);
          if (guest.newSession) {
            activeProjectId = null;
            setProjectId(null);
            setVariants([]);
          }
          activeStatus = { ...status, anonymous: true };
          setStatus(activeStatus);
          availableFree = guest.freeRemaining;
          activeFreeTier = true;
          setCredits(guest.credits ?? 0);
          setFree(true);
          setFreeRemaining(availableFree);
        } catch (e) {
          setError(
            e instanceof Error
              ? e.message
              : "No pudimos iniciar la prueba. Intentá nuevamente.",
          );
          return;
        } finally {
          generateLock.current = false;
          setBusy(false);
        }
      } else {
        setShowLogin(true);
        return;
      }
    }
    if (activeFreeTier && availableFree <= 0) {
      window.location.assign("/precios");
      return;
    }
    generateLock.current = true;
    setBusy(true);
    setElapsed(0);
    setBatchCompleted(0);
    try {
      const data = new FormData();
      data.set("image", file);
      data.set("room", room);
      data.set("style", style);
      data.set("mode", mode);
      data.set("notes", notes);
      if (activeStatus.mode === "cloud") {
        // Free results are batched, but the database enforces the lifetime account limit.
        const done = variants?.length || 0;
        const runs = activeFreeTier ? freeBatchSize(availableFree) : 1;
        if (!runs)
          throw new Error(
            "Llegaste al límite de la prueba gratis. Elegí un plan para seguir creando.",
          );
        setRoundTotal(runs);
        setRound(runs > 1 ? 1 : 0);
        requestKey.current ||= crypto.randomUUID();
        data.set("requestKey", requestKey.current);
        data.set("batchSize", String(runs));
        data.set("variant", String((done % 3) + 1));
        if (activeProjectId) data.set("projectId", activeProjectId);
        const response = await fetch("/api/jobs", {
          method: "POST",
          body: data,
        });
        const batch = await response.json();
        if (response.status === 409 && /en curso/.test(batch.error || "")) {
          // A batch already runs, typically started before a page reload:
          // open it so its results show up instead of a dead end.
          const running = (await refreshCloud().catch(() => [])).find(
            (p) => p.pendingJobIds?.length || p.pendingJobId,
          );
          if (running) {
            resume = running;
            return;
          }
        }
        if (!response.ok) throw new Error(batch.error);
        trackPhotoUploaded();
        if (!activeProjectId) trackUpload();
        const ids: string[] = batch.ids || [batch.id];
        setProjectId(batch.projectId);
        setRoundTotal(ids.length);
        setFreeRemaining((n) =>
          activeFreeTier ? Math.max(0, n - ids.length) : n,
        );
        const outcomes = await Promise.allSettled(
          ids.map((id) => watchJob(id)),
        );
        const rejected = outcomes.find((r) => r.status === "rejected");
        if (rejected?.status === "rejected")
          setError(
            rejected.reason instanceof Error
              ? rejected.reason.message
              : "Una propuesta necesita revisión. Las otras se conservan.",
          );
        await refreshCloud();
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
      trackPhotoUploaded();
      trackUpload();
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
    if (resume) {
      setNotice("Ya tenías una generación en curso. Te la mostramos acá.");
      await openProject(resume);
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
      // Saved images use links that expire after an hour: renew them once.
      const shown = variants?.find((v) => v.result === result);
      if (status?.mode === "cloud" && projectId) {
        try {
          const fresh = (await refreshCloud()).find((p) => p.id === projectId);
          const image =
            fresh?.variants?.find((v) => v.id === shown?.id)?.result ||
            fresh?.result;
          if (fresh && image) {
            setSource(fresh.original);
            setResult(image);
            setVariants(fresh.variants || []);
            await downloadDesign(
              image,
              `${room}-${style}`,
              sideBySide ? fresh.original : undefined,
              label,
            );
            return;
          }
        } catch {
          /* falls through to the original error */
        }
      }
      setError(e instanceof Error ? e.message : "No pudimos descargar.");
    }
  }
  async function openProject(p: Project) {
    photoSession.current++;
    setProjectId(p.cloud ? p.id : null);
    setVariants(p.variants || []);
    requestKey.current = null;
    setRoom(p.room);
    setStyle(normalizeStyle(p.style));
    setMode(p.mode);
    setSource(p.original);
    setResult(p.result);
    setFilename(p.name);
    setDemo(p.demo);
    setFile(null);
    setError("");
    if (p.pendingJobId && !generateLock.current) {
      generateLock.current = true;
      setBusy(true);
      const pending = p.pendingJobIds?.length
        ? p.pendingJobIds
        : [p.pendingJobId];
      setRoundTotal(pending.length);
      setBatchCompleted(0);
      // One failed proposal must not stop watching the others.
      void Promise.allSettled(pending.map((id) => watchJob(id)))
        .then((outcomes) => {
          const failed = outcomes.find((o) => o.status === "rejected");
          if (failed && failed.status === "rejected")
            setError(
              failed.reason instanceof Error
                ? failed.reason.message
                : "Una de las propuestas falló.",
            );
        })
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
        const response = await fetch(p.original);
        // An expired link answers with an error page, not the photo.
        if (!response.ok) throw new Error("ORIGINAL_UNAVAILABLE");
        const blob = await response.blob();
        setFile(
          new File([blob], `${p.name || "room"}.jpg`, { type: "image/jpeg" }),
        );
      } catch {
        setError("No pudimos recuperar el original. Volvé a cargarlo.");
      }
    }
  }
  const usesStyle = mode === "furnish" || mode === "redesign";
  // What the account has left: the first thing to know before creating.
  const balance: { label: ReactNode; href?: string } | null = !status
    ? null
    : status.mode !== "cloud"
      ? { label: status.configured ? "Piloto de IA" : "Modo demo" }
      : (status.authenticated || status.anonymous) && !cloudReady
        ? { label: "Cargando tu saldo…" }
        : status.authenticated && !free
          ? {
              label: unlimited ? (
                <>
                  Fotos <strong>ilimitadas</strong>
                </>
              ) : (
                <>
                  Te quedan <strong>{credits}</strong>{" "}
                  {credits === 1 ? "foto" : "fotos"}
                </>
              ),
              href: "/cuenta",
            }
          : {
              label:
                status.authenticated || status.anonymous ? (
                  <>
                    Prueba gratis: <strong>{freeRemaining}</strong> de{" "}
                    {FREE_RESULT_LIMIT} diseños
                  </>
                ) : (
                  <>
                    Prueba gratis: <strong>{FREE_RESULT_LIMIT}</strong> diseños
                    sin registro
                  </>
                ),
              href: status.authenticated ? "/cuenta" : "/precios",
            };
  const hint: ReactNode = demo ? (
    "Ejemplo precargado: no descuenta fotos"
  ) : !status?.configured ? (
    "Explorá gratis los ejemplos precargados"
  ) : !source ? (
    "Subí una foto o probá con un ejemplo"
  ) : freeTier ? (
    result ? (
      <>
        Con marca de agua · <Link href="/precios">Ver planes sin marca</Link>
      </>
    ) : (
      "Prueba gratis · Con marca de agua"
    )
  ) : status.mode !== "cloud" ? (
    "Calidad alta · Acceso de piloto"
  ) : unlimited ? (
    "Calidad alta · No descuenta fotos"
  ) : projectId ? (
    "Calidad alta · Regeneraciones incluidas"
  ) : (
    `Calidad alta · Usa 1 de tus ${credits ?? "…"} fotos`
  );
  const hasVariants = Boolean(variants && variants.length > 0);
  const showExamples = !source || (demo && !result);
  const showFooter =
    !batchMode && (hasVariants || busy || Boolean(result) || showExamples);
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
        <div className="workspace">
          <div className="studio-intro">
            <h1>Estudio de diseño</h1>
            {balance && (
              <div className="studio-balance">
                {balance.href ? (
                  <Link href={balance.href}>
                    <span className="live-dot" />
                    <span>{balance.label}</span>
                    <ArrowUpRight size={14} />
                  </Link>
                ) : (
                  <span>
                    <span className="live-dot" />
                    {balance.label}
                  </span>
                )}
                {status?.mode !== "cloud" && status?.authenticated && (
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
            )}
          </div>
          <section
            className="studio-canvas"
            data-tour="upload"
            aria-label="Tu foto"
          >
            <div className="canvas-heading">
              <h2>
                {batchMode
                  ? "Las fotos de la propiedad"
                  : result
                    ? "Tu espacio, transformado"
                    : "La foto de tu espacio"}
              </h2>
              {source && !batchMode && (
                <span className="photo-name" title={filename}>
                  {demo ? "Ejemplo" : filename}
                </span>
              )}
              {source && !busy && !batchMode && (
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
              aria-label="Subir fotos de la propiedad"
              multiple
              onChange={(e) => acceptFiles(Array.from(e.target.files || []))}
            />
            <div
              className={`canvas-stage ${batchMode ? "is-batch" : !source ? "is-empty" : ""}`}
              ref={resultRef}
            >
              {batchMode ? (
                <BatchList
                  batch={batch}
                  onAddPhotos={() => input.current?.click()}
                  onFiles={(files) => void acceptFiles(files)}
                  label={label}
                  onLabelChange={setLabel}
                  onError={setError}
                />
              ) : !source ? (
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
                    void acceptFiles(Array.from(e.dataTransfer.files));
                  }}
                >
                  <div className="upload-illustration">
                    <span className="upload-sheet one" />
                    <span className="upload-sheet two" />
                    <div>
                      <ImagePlus size={30} strokeWidth={1.4} />
                    </div>
                    <span className="upload-spark">
                      <Sparkles size={14} />
                    </span>
                  </div>
                  <h3>
                    {reading
                      ? "Preparando tu foto…"
                      : "Todo empieza con una foto."}
                  </h3>
                  <p>
                    <span className="pointer-only">
                      {batchAllowed
                        ? "Arrastrá una o varias fotos (hasta 20) o elegilas desde tu computadora."
                        : "Arrastrala hasta acá o elegila desde tu computadora."}
                    </span>
                    <span className="touch-only">
                      {batchAllowed
                        ? "Elegí una o varias fotos (hasta 20) de tu galería."
                        : "Elegí una foto de tu galería o sacala con la cámara."}
                    </span>
                  </p>
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
                    {batchAllowed ? "Subir mis fotos" : "Subir mi foto"}
                  </button>
                  <span className="upload-meta">
                    JPG, PNG o WebP · Hasta 10 MB
                  </span>
                </div>
              ) : (
                <div
                  className="stage-media"
                  style={{ "--ar": aspect } as CSSProperties}
                >
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
                      onLoad={(e) => {
                        const { naturalWidth: w, naturalHeight: h } =
                          e.currentTarget;
                        if (w && h) setAspect(w / h);
                      }}
                    />
                  )}
                  {busy && !result && (
                    <div className="generating-overlay">
                      <div className="generating-icon">
                        <Sparkles size={28} />
                      </div>
                      <h3>
                        {round
                          ? `Creando ${roundTotal} propuestas…`
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
              {(error || notice) && (
                <div className="studio-feedback">
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
                </div>
              )}
            </div>
            {showFooter && (
              <div className="canvas-footer">
                {(hasVariants || busy) && (
                  <div
                    className="variant-picker"
                    role="group"
                    aria-label="Variantes de esta foto"
                  >
                    {(variants || []).map((v, i) => (
                      <button
                        key={v.id}
                        className={result === v.result ? "selected" : ""}
                        aria-pressed={result === v.result}
                        onClick={() => {
                          setResult(v.result);
                          setRoom(v.room);
                          setStyle(normalizeStyle(v.style));
                          setMode(v.mode);
                          setNotes(v.notes);
                        }}
                      >
                        <img src={v.result} alt="" />
                        <span>Diseño {(variants?.length || 0) - i}</span>
                      </button>
                    ))}
                    {busy &&
                      Array.from(
                        { length: Math.max(0, roundTotal - batchCompleted) },
                        (_, i) => (
                          <div
                            className="variant-pending"
                            key={`pending-${i}`}
                            role="status"
                            aria-label={
                              i === 0
                                ? "Generando siguiente diseño"
                                : "Diseño pendiente"
                            }
                          >
                            <img src={source} alt="" />
                            <LoaderCircle className="spin" size={20} />
                            <span>Creando…</span>
                          </div>
                        ),
                      )}
                  </div>
                )}
                {result && (
                  <div className="result-actions">
                    <div
                      className="view-toggle"
                      role="group"
                      aria-label="Cómo ver el diseño"
                    >
                      <button
                        className={comparison ? "" : "selected"}
                        aria-pressed={!comparison}
                        onClick={() => setComparison(false)}
                      >
                        <Eye size={16} /> Diseño
                      </button>
                      <button
                        className={comparison ? "selected" : ""}
                        aria-pressed={comparison}
                        onClick={() => setComparison(true)}
                      >
                        <SplitSquareHorizontal size={16} /> Comparar
                      </button>
                    </div>
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
                )}
                {busy && result && (
                  <p className="batch-progress" role="status">
                    <LoaderCircle className="spin" size={16} />
                    {batchCompleted} de {roundTotal} propuestas listas. Ya podés
                    ver y descargar las que están listas.
                  </p>
                )}
                {result && (
                  <div className="result-meta">
                    <label className="checkbox-label">
                      <input
                        type="checkbox"
                        checked={label}
                        onChange={(e) => setLabel(e.target.checked)}
                      />{" "}
                      Incluir etiqueta «Amoblamiento virtual»
                    </label>
                    <p className="studio-tip">
                      <ShieldCheck size={15} />
                      Antes de publicar, revisá que se conserve la arquitectura
                      real.
                    </p>
                  </div>
                )}
                {showExamples && (
                  <div className="examples">
                    <p>
                      <span>¿Solo estás explorando?</span> Probá con un ejemplo{" "}
                      <ArrowRight size={14} />
                    </p>
                    <div className="example-grid">
                      {demoRooms.map((r) => (
                        <button
                          key={r}
                          onClick={() => useExample(r)}
                          disabled={busy || reading}
                          aria-label={`Usar ejemplo de ${rooms.find((x) => x.id === r)?.name}`}
                          aria-pressed={demo && room === r}
                          className={demo && room === r ? "selected" : ""}
                        >
                          <img src={beforeImage(r)} alt="" />
                          <span>{rooms.find((x) => x.id === r)?.name}</span>
                          {demo && room === r && (
                            <span className="example-check">
                              <Check size={12} />
                            </span>
                          )}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </section>
          <section className="settings-panel" aria-label="Opciones de diseño">
            <fieldset className="mode-field" data-tour="operation">
              <legend>¿Qué querés hacer?</legend>
              <div className="mode-segment">
                {stagingModes.map(({ id, icon: Icon }) => {
                  const paidOnly = freeTier && id !== "furnish";
                  return (
                    <button
                      key={id}
                      className={mode === id ? "selected" : ""}
                      aria-pressed={mode === id}
                      disabled={locked || reading || paidOnly}
                      title={
                        paidOnly ? "Incluido en los planes pagos" : undefined
                      }
                      onClick={() => chooseMode(id)}
                    >
                      <Icon size={18} />
                      {modes.find((m) => m.id === id)?.name}
                      {paidOnly && (
                        <>
                          <LockKeyhole size={12} className="mode-lock" />
                          <span className="visually-hidden"> (plan pago)</span>
                        </>
                      )}
                    </button>
                  );
                })}
              </div>
              <div className="mode-tools">
                <span>Retoque</span>
                {photoModes.map(({ id, icon: Icon, label: name }) => (
                  <button
                    key={id}
                    className={mode === id ? "selected" : ""}
                    aria-pressed={mode === id}
                    disabled={locked || reading || freeTier || demo}
                    title={
                      freeTier
                        ? "Incluido en los planes pagos"
                        : modes.find((m) => m.id === id)?.name
                    }
                    onClick={() => chooseMode(id)}
                  >
                    {freeTier ? <LockKeyhole size={12} /> : <Icon size={14} />}
                    {name}
                    {freeTier && (
                      <span className="visually-hidden"> (plan pago)</span>
                    )}
                  </button>
                ))}
              </div>
              <p className="field-hint">
                {modes.find((m) => m.id === mode)?.description}
                {freeTier && " Las demás opciones están en los planes pagos."}
              </p>
            </fieldset>
            {(!batchMode || usesStyle) && (
              <div className="staging-selects">
                {/* In a batch each photo has its own room. */}
                {!batchMode && (
                  <label className="select-field">
                    <span>Ambiente</span>
                    <select
                      className="studio-select"
                      value={room}
                      disabled={busy || reading}
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
                  </label>
                )}
                {usesStyle && (
                  <label className="select-field">
                    <span>Estilo</span>
                    <select
                      className="studio-select"
                      data-tour="style"
                      value={style}
                      disabled={locked || reading}
                      onChange={(e) => {
                        setStyle(e.target.value as StyleId);
                        setResult("");
                      }}
                    >
                      {styles.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
              </div>
            )}
            {usesStyle && (
              <p className="field-hint style-hint">
                {styles.find((s) => s.id === style)?.description}
              </p>
            )}
            <div className="notes-field">
              <label htmlFor="design-notes">
                Un toque personal <span>opcional</span>
                <span className="notes-count">{notes.length}/500</span>
              </label>
              <textarea
                id="design-notes"
                rows={2}
                placeholder="Ej.: tonos cálidos, sofá de lino, detalles en madera…"
                maxLength={500}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                disabled={locked || demo || mode === "remove"}
              />
            </div>
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
                      <Check size={15} /> {t}
                    </li>
                  ))}
                </ul>
                <Link href="/precios" className="button button-primary">
                  <LockKeyhole size={16} /> Desbloquear todo
                </Link>
              </aside>
            )}
          </section>
          <div className="generate-area" data-tour="generate">
            {batchMode ? (
              <>
                <button
                  className="button button-primary generate-button"
                  onClick={startBatch}
                  disabled={
                    batch.running || !batch.waiting || batch.preparing > 0
                  }
                >
                  {batch.running ? (
                    <LoaderCircle size={19} className="spin" />
                  ) : (
                    <Sparkles size={19} />
                  )}{" "}
                  {batch.running
                    ? "Creando tus diseños…"
                    : batch.waiting
                      ? `Crear ${batch.waiting} ${batch.waiting === 1 ? "diseño" : "diseños"}`
                      : "Tanda terminada"}
                </button>
                <p>
                  {unlimited
                    ? "Calidad alta · Una foto por vez · Sin límite de fotos"
                    : credits !== null && batch.waiting > credits
                      ? `Te quedan ${credits} fotos: las demás no se van a crear.`
                      : "Calidad alta · Una foto por vez · Cada foto nueva usa 1 de tu saldo"}
                </p>
              </>
            ) : (
              <>
                <button
                  ref={loginTrigger}
                  className="button button-primary generate-button"
                  onClick={generate}
                  disabled={
                    !source ||
                    busy ||
                    reading ||
                    !status ||
                    (!demo &&
                      status.mode === "cloud" &&
                      (status.authenticated || status.anonymous) &&
                      credits === null)
                  }
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
                </button>
                <p>{hint}</p>
              </>
            )}
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
          </div>
        </div>
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
