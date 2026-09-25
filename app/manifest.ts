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
        src: "/wuniflow-icon.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "any",
      },
      {
        src: "/wuniflow-icon-maskable.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "maskable",
      },
    ],
  };
}
