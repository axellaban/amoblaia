"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  Images,
  Folder,
  FolderPlus,
  Trash2,
  ArchiveRestore,
  Search,
  Plus,
  LoaderCircle,
  Pencil,
  Inbox,
} from "lucide-react";
import { TourButton } from "./product-tour";
import type { Project } from "@/lib/history";
type FolderRow = { id: string; name: string };
export function ProjectLibrary() {
  const [projects, setProjects] = useState<Project[]>([]),
    [folders, setFolders] = useState<FolderRow[]>([]),
    [filter, setFilter] = useState("all"),
    [query, setQuery] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [folderName, setFolderName] = useState(""),
    [editingFolder, setEditingFolder] = useState(""),
    [folderForm, setFolderForm] = useState(false),
    [rename, setRename] = useState(""),
    [projectName, setProjectName] = useState(""),
    [purge, setPurge] = useState("");
  // Decides the banner: plans for the free trial, the balance otherwise.
  const [plan, setPlan] = useState<{
    free: boolean;
    unlimited: boolean;
    credits: number;
  } | null>(null);
  const load = useCallback(async () => {
    try {
      const session = await fetch("/api/session", { cache: "no-store" }).then(
        (r) => r.json(),
      );
      if (!session.authenticated) {
        window.location.assign("/acceso?next=%2Fproyectos");
        return;
      }
      const responses = await Promise.all([
        fetch("/api/projects?includeTrash=1", { cache: "no-store" }),
        fetch("/api/folders", { cache: "no-store" }),
      ]);
      if (responses.some((r) => r.status === 401)) {
        window.location.assign("/acceso?next=%2Fproyectos");
        return;
      }
      const [p, f] = await Promise.all(responses.map((r) => r.json()));
      if (p.error || f.error) throw new Error(p.error || f.error);
      setProjects(p.projects);
      setFolders(f.folders);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No pudimos cargar tus fotos.");
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  // Once, not on every reload of the photos; a failure only hides the banner.
  useEffect(() => {
    fetch("/api/account", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then(
        (a) =>
          a &&
          !a.anonymous &&
          setPlan({
            free: a.free === true,
            unlimited: a.unlimited === true,
            credits: a.credits ?? 0,
          }),
      )
      .catch(() => {});
  }, []);
  const active = projects.filter((p) => !p.trashedAt),
    trash = projects.filter((p) => p.trashedAt),
    inFolder = (p: Project) =>
      p.folderId && folders.some((f) => f.id === p.folderId);
  const shown = (filter === "trash" ? trash : active).filter(
    (p) =>
      (filter === "all" ||
        filter === "trash" ||
        (filter === "unassigned" ? !inFolder(p) : p.folderId === filter)) &&
      p.name.toLocaleLowerCase("es").includes(query.toLocaleLowerCase("es")),
  );
  async function change(
    id: string,
    action: string,
    extra: Record<string, unknown> = {},
  ) {
    setBusy(true);
    setError("");
    try {
      const r = await fetch(`/api/projects/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, ...extra }),
      });
      const p = await r.json();
      if (!r.ok) throw new Error(p.error);
      setRename("");
      await load();
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "No pudimos guardar el cambio.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function saveFolder(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const r = await fetch("/api/folders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: folderName,
          id: editingFolder || undefined,
        }),
      });
      const p = await r.json();
      if (!r.ok) throw new Error(p.error);
      setFolderForm(false);
      setFolderName("");
      setEditingFolder("");
      await load();
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "No pudimos guardar la carpeta.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function permanentDelete(id: string) {
    setBusy(true);
    setError("");
    try {
      const r = await fetch(`/api/projects/${id}`, { method: "DELETE" });
      const p = await r.json();
      if (!r.ok) throw new Error(p.error);
      setPurge("");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No pudimos eliminar la foto.");
    } finally {
      setBusy(false);
    }
  }
  const title =
    filter === "all"
      ? "Todas mis fotos"
      : filter === "unassigned"
        ? "Sin carpeta"
        : filter === "trash"
          ? "Papelera"
          : folders.find((f) => f.id === filter)?.name || "Mis fotos";
  return (
    <div className="library-page container">
      <aside className="library-sidebar">
        <nav aria-label="Organizar fotos">
          {[
            ["all", "Todas las fotos", Images, active.length],
            [
              "unassigned",
              "Sin carpeta",
              Inbox,
              active.filter((p) => !inFolder(p)).length,
            ],
            ["trash", "Papelera", Trash2, trash.length],
          ].map(([id, label, Icon, count]) => {
            const I = Icon as typeof Images;
            return (
              <button
                key={id as string}
                data-tour={id === "trash" ? "trash" : undefined}
                className={filter === id ? "selected" : ""}
                onClick={() => setFilter(id as string)}
              >
                <I size={18} />
                {label as string}
                <span>{count as number}</span>
              </button>
            );
          })}
        </nav>
        <div className="folder-heading" data-tour="folders">
          <span>Carpetas</span>
          <button
            className="icon-button"
            aria-label="Nueva carpeta"
            onClick={() => {
              setFolderForm(true);
              setEditingFolder("");
              setFolderName("");
            }}
          >
            <FolderPlus size={18} />
          </button>
        </div>
        {folderForm && (
          <form onSubmit={saveFolder} className="folder-form">
            <input
              autoFocus
              required
              maxLength={80}
              aria-label="Nombre de carpeta"
              placeholder="Ej.: Departamento Palermo"
              value={folderName}
              onChange={(e) => setFolderName(e.target.value)}
            />
            <button className="button button-small" disabled={busy}>
              Guardar
            </button>
            <button
              type="button"
              className="subtle-button"
              onClick={() => setFolderForm(false)}
            >
              Cancelar
            </button>
          </form>
        )}
        {!folders.length && !folderForm && (
          <p className="empty-folders">
            <Folder size={28} />
            <br />
            Creá una carpeta para organizar las fotos de cada propiedad.
          </p>
        )}
        {folders.map((f) => (
          <div className="folder-item" key={f.id}>
            <button
              className={filter === f.id ? "selected" : ""}
              onClick={() => setFilter(f.id)}
            >
              <Folder size={17} />
              {f.name}
              <span>{active.filter((p) => p.folderId === f.id).length}</span>
            </button>
            <button
              className="icon-button"
              aria-label={`Cambiar nombre de ${f.name}`}
              onClick={() => {
                setEditingFolder(f.id);
                setFolderName(f.name);
                setFolderForm(true);
              }}
            >
              <Pencil size={13} />
            </button>
          </div>
        ))}
      </aside>
      <section className="library-main" data-tour="photos">
        <div className="library-heading">
          <h1>{title}</h1>
          <TourButton />
          <Link className="button button-primary" href="/estudio">
            <Plus size={17} />
            Subir foto
          </Link>
        </div>
        <label className="library-search" data-tour="search">
          <Search size={18} />
          <input
            type="search"
            aria-label="Buscar fotos"
            placeholder="Buscar por nombre…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        {error && (
          <p className="inline-error" role="alert">
            {error}
          </p>
        )}
        {busy && (
          <p role="status">
            <LoaderCircle className="spin" size={18} />
            Guardando…
          </p>
        )}
        {filter !== "trash" && plan && (
          <div className="library-upgrade">
            <Images size={23} />
            {plan.free ? (
              <>
                <p>
                  Todos los estilos, alta resolución y resultados sin marca de
                  agua.
                </p>
                <Link className="button button-primary" href="/precios">
                  Elegir plan
                </Link>
              </>
            ) : (
              <>
                <p>
                  {plan.unlimited ? (
                    <>
                      Tu cuenta tiene fotos <strong>ilimitadas</strong>.
                    </>
                  ) : (
                    <>
                      Te quedan <strong>{plan.credits}</strong>{" "}
                      {plan.credits === 1 ? "foto" : "fotos"} en tu plan. Cada
                      foto incluye sus regeneraciones.
                    </>
                  )}
                </p>
                <Link className="button button-outline" href="/cuenta">
                  Ver mi cuenta
                </Link>
              </>
            )}
          </div>
        )}
        {filter === "trash" && (
          <p className="field-hint">
            Podés restaurar estas fotos. Los resultados gratuitos utilizados
            siguen contando dentro del límite de 25.
          </p>
        )}
        {!shown.length ? (
          <div className="library-empty">
            <Images size={42} />
            <h2>
              {query
                ? "No encontramos esa foto"
                : "Acá empieza tu próxima publicación"}
            </h2>
            <p>
              {filter === "trash"
                ? "La papelera está vacía."
                : "Subí una foto y organizá los resultados por propiedad."}
            </p>
            {filter !== "trash" && (
              <Link href="/estudio" className="button button-outline">
                Crear mi primer diseño
              </Link>
            )}
          </div>
        ) : (
          <div className="library-grid">
            {shown.map((p) => (
              <article key={p.id} className="library-card">
                <Link
                  href={p.trashedAt ? "#" : `/estudio?project=${p.id}`}
                  aria-label={`Abrir ${p.name}`}
                >
                  <img src={p.result || p.original} alt={p.name} />
                  <span>{p.variants?.length || 0} diseños</span>
                </Link>
                <div>
                  {rename === p.id ? (
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        void change(p.id, "rename", { name: projectName });
                      }}
                    >
                      <input
                        aria-label="Nuevo nombre de la foto"
                        maxLength={100}
                        value={projectName}
                        onChange={(e) => setProjectName(e.target.value)}
                      />
                      <button disabled={busy}>Guardar</button>
                      <button type="button" onClick={() => setRename("")}>
                        Cancelar
                      </button>
                    </form>
                  ) : (
                    <h2>{p.name}</h2>
                  )}
                  <p>{new Date(p.createdAt).toLocaleDateString("es-AR")}</p>
                  <div className="library-card-actions">
                    {p.trashedAt ? (
                      <>
                        <button
                          className="button button-outline"
                          disabled={busy}
                          onClick={() => void change(p.id, "restore")}
                        >
                          <ArchiveRestore size={16} />
                          Restaurar
                        </button>
                        <button
                          className="icon-button"
                          aria-label={`Eliminar definitivamente ${p.name}`}
                          onClick={() => setPurge(p.id)}
                          disabled={busy}
                        >
                          <Trash2 size={16} />
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          className="icon-button"
                          aria-label={`Renombrar ${p.name}`}
                          disabled={busy}
                          onClick={() => {
                            setRename(p.id);
                            setProjectName(p.name);
                          }}
                        >
                          <Pencil size={16} />
                        </button>
                        <select
                          aria-label={`Carpeta de ${p.name}`}
                          value={inFolder(p) ? p.folderId! : ""}
                          disabled={busy}
                          onChange={(e) =>
                            void change(p.id, "move", {
                              folderId: e.target.value || null,
                            })
                          }
                        >
                          <option value="">Sin carpeta</option>
                          {folders.map((f) => (
                            <option key={f.id} value={f.id}>
                              {f.name}
                            </option>
                          ))}
                        </select>
                        <button
                          className="icon-button"
                          aria-label={`Mover ${p.name} a papelera`}
                          disabled={busy}
                          onClick={() => void change(p.id, "trash")}
                        >
                          <Trash2 size={16} />
                        </button>
                      </>
                    )}
                  </div>
                </div>
              </article>
            ))}
          </div>
        )}
        {purge && (
          <div className="modal-backdrop">
            <section
              className="modal"
              role="dialog"
              aria-modal="true"
              aria-labelledby="purge-title"
            >
              <h2 id="purge-title">¿Eliminar definitivamente esta foto?</h2>
              <p>
                Se borran el original y sus resultados. No se pueden restaurar y
                el cupo gratuito usado no se reinicia.
              </p>
              <div className="resource-links">
                <button
                  className="button button-outline"
                  onClick={() => setPurge("")}
                  disabled={busy}
                >
                  Conservar en papelera
                </button>
                <button
                  className="button button-primary"
                  onClick={() => void permanentDelete(purge)}
                  disabled={busy}
                >
                  Eliminar definitivamente
                </button>
              </div>
            </section>
          </div>
        )}
      </section>
    </div>
  );
}
