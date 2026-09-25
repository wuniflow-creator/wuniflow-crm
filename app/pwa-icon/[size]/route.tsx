import { ImageResponse } from "next/og";

export const runtime = "edge";

export async function GET(
  _request: Request,
  context: { params: Promise<{ size: string }> },
) {
  const { size: rawSize } = await context.params;
  const size = rawSize === "512" ? 512 : 192;

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#171B20",
          borderRadius: Math.round(size * 0.22),
          position: "relative",
          fontFamily: "Arial, sans-serif",
        }}
      >
        <div
          style={{
            color: "#F1F3F5",
            fontSize: Math.round(size * 0.46),
            fontWeight: 800,
            letterSpacing: "-0.08em",
            transform: "translateX(-0.03em)",
          }}
        >
          W
        </div>
        <div
          style={{
            position: "absolute",
            right: Math.round(size * 0.16),
            top: Math.round(size * 0.15),
            width: Math.round(size * 0.11),
            height: Math.round(size * 0.11),
            borderRadius: "50%",
            background: "#76507D",
          }}
        />
      </div>
    ),
    {
      width: size,
      height: size,
    },
  );
}
