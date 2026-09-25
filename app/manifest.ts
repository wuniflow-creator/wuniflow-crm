import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Wuniflow CRM",
    short_name: "Wuniflow",
    description: "CRM comercial e central de atendimento da Wuniflow Automations.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#0f1216",
    theme_color: "#171b20",
    orientation: "any",
    categories: ["business", "productivity"],
    icons: [
      {
        src: "/pwa-icon/192",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/pwa-icon/512",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/pwa-icon/512",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
      {
        src: "/wuniflow-icon.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "any",
      },
    ],
  };
}
