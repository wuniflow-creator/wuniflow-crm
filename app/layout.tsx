import type { Metadata, Viewport } from "next";
import "./globals.css";

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#171b20",
};

export const metadata: Metadata = {
  title: "Wuniflow CRM",
  description: "Tecnologia para quem vive a operação.",
  applicationName: "Wuniflow CRM",
  manifest: "/manifest.webmanifest",
  icons: {
    icon: "/wuniflow-icon.svg",
  },
  appleWebApp: {
    capable: true,
    title: "Wuniflow CRM",
    statusBarStyle: "black-translucent",
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="pt-BR"><body>{children}</body></html>;
}
