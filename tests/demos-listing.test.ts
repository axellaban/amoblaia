import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({
  adminClient: () => {
    throw new Error("not used");
  },
  currentUser: async () => null,
}));
import { fetchPublic, parseListing, publicAddress, readListing } from "../src/lib/demos/listing";

const PAGE = "https://www.russilloinmobiliaria.com/p/123-departamento-palermo";

describe("Listing page", () => {
  it("reads title, location, description, agency and photos from JSON-LD and Open Graph", () => {
    const html = `<html><head>
      <title>Departamento 3 ambientes en Palermo | Russillo Inmobiliaria</title>
      <meta property="og:site_name" content="Russillo Inmobiliaria">
      <meta property="og:title" content="Departamento 3 ambientes en Palermo | Russillo Inmobiliaria">
      <meta property="og:description" content="Luminoso, con balc&oacute;n &amp; cochera.">
      <meta property="og:image" content="https://cdn.example.com/fotos/1.jpg">
      <script type="application/ld+json">{"@context":"https://schema.org","@graph":[
        {"@type":"RealEstateAgent","name":"Russillo"},
        {"@type":"Apartment","name":"Departamento 3 ambientes en Palermo",
         "address":{"streetAddress":"Gorriti 4500","addressLocality":"Palermo"},
         "image":["https://cdn.example.com/fotos/1.jpg","/fotos/2.jpg"]}]}</script>
      </head><body>
      <img src="/static/logo.png"><img src="/img/icons/whatsapp.png">
      <img src="https://cdn.example.com/fotos/3.jpg" width="1200" height="800">
      <img src="https://cdn.example.com/fotos/tiny.jpg" width="80" height="60">
      <a href="https://cdn.example.com/fotos/4.webp"><img src="https://cdn.example.com/fotos/4-300x200.webp"></a>
      </body></html>`;
    const listing = parseListing(html, PAGE);
    expect(listing).toMatchObject({
      title: "Departamento 3 ambientes en Palermo",
      location: "Gorriti 4500, Palermo",
      description: "Luminoso, con balcón & cochera.",
      listingUrl: PAGE,
      agency: { name: "Russillo Inmobiliaria", website: "https://www.russilloinmobiliaria.com/" },
    });
    expect(listing.images).toEqual([
      "https://cdn.example.com/fotos/1.jpg",
      "https://www.russilloinmobiliaria.com/fotos/2.jpg",
      "https://cdn.example.com/fotos/3.jpg",
      "https://cdn.example.com/fotos/4.webp",
    ]);
  });

  it("works on plain pages: lazy galleries, Tokko thumbnails and the site name from the domain", () => {
    const html = `<title>Casa en Pinamar</title><h1>Casa con pileta en Pinamar</h1>
      <div class="gallery">
        <img data-src="https://static.tokkobroker.com/pictures/99_a_thumb.jpg">
        <img data-src="https://static.tokkobroker.com/pictures/99_a.jpg">
        <img srcset="https://x.com/b-480.jpg 480w, https://x.com/b-1600.jpg 1600w">
        <div style="background-image:url('https://x.com/pinamar/c.jpeg')"></div>
        <img src="data:image/gif;base64,R0lGOD">
        <img src="https://x.com/d.svg">
      </div>`;
    const listing = parseListing(html, "https://surpropiedades.com.ar/ficha/99");
    expect(listing.title).toBe("Casa con pileta en Pinamar");
    expect(listing.agency.name).toBe("Sur Propiedades");
    expect(listing.location).toBeNull();
    expect(listing.images).toEqual([
      "https://static.tokkobroker.com/pictures/99_a.jpg",
      "https://x.com/b-1600.jpg",
      "https://x.com/pinamar/c.jpeg",
    ]);
  });

  it("keeps at most 30 photos", () => {
    const html = Array.from({ length: 50 }, (_, i) => `<img src="https://x.com/f${i}.jpg">`).join("");
    expect(parseListing(html, PAGE).images).toHaveLength(30);
  });
});

describe("Downloads from listings", () => {
  it("only reach public internet addresses", () => {
    for (const ip of ["8.8.8.8", "190.210.1.1", "2800:3f0:4002:80b::200e"])
      expect(publicAddress(ip)).toBe(true);
    for (const ip of [
      "127.0.0.1",
      "10.1.2.3",
      "172.16.0.1",
      "192.168.1.1",
      "169.254.169.254",
      "100.64.0.1",
      "0.0.0.0",
      "::1",
      "fd00::1",
      "fe80::1",
      "::ffff:127.0.0.1",
      "not-an-ip",
    ])
      expect(publicAddress(ip)).toBe(false);
  });

  it("refuse local addresses before any request", async () => {
    const spy = vi.spyOn(globalThis, "fetch");
    await expect(fetchPublic("http://169.254.169.254/latest/meta-data", "page")).rejects.toThrow(
      /no es un sitio público/,
    );
    await expect(fetchPublic("http://127.0.0.1:3000/", "image")).rejects.toThrow(/pública/);
    await expect(readListing("ftp://x.com/a")).rejects.toThrow(/URL de la ficha/);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});
