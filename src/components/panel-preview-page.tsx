// What a link-preview bot gets from a link to an agency's panel: the preview
// is in the metadata; the page only says where the link goes.
export function PanelPreviewPage() {
  return (
    <main className="container" style={{ padding: "48px 16px" }}>
      <h1>Tu panel de habita.</h1>
      <p>Abrí este enlace para ingresar a tu panel.</p>
    </main>
  );
}
