import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Doramy Online",
    short_name: "Doramy",
    description: "Смотри бесплатно фильмы и сериалы онлайн на Doramy Online",
    start_url: "/",
    display: "standalone",
    background_color: "#0b0f0c",
    theme_color: "#2ee58a",
    icons: [
      {
        src: "/icon.svg",
        sizes: "any",
        type: "image/svg+xml",
      },
      {
        src: "/favicon.ico",
        sizes: "48x48",
        type: "image/x-icon",
      },
    ],
  };
}
