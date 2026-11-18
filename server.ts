import fs from "fs";
import path from "path";
import express from "express";
import app from "./api/index";

const PORT = Number(process.env.PORT) || 3000;

async function startServer() {
  if (process.env.VERCEL) return; // Serverless entrypoint uses api/index.ts directly

  const distPath = path.join(process.cwd(), "dist");
  const isProdBuild = process.env.NODE_ENV === "production" || fs.existsSync(path.join(distPath, "index.html"));

  if (isProdBuild && process.env.NODE_ENV !== "development") {
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  } else {
    try {
      const { createServer: createViteServer } = await import("vite");
      const vite = await createViteServer({
        server: { middlewareMode: true },
        appType: "spa",
      });
      app.use(vite.middlewares);
    } catch (err) {
      console.error("Failed to start Vite server:", err);
      if (fs.existsSync(path.join(distPath, "index.html"))) {
        app.use(express.static(distPath));
        app.get("*", (req, res) => {
          res.sendFile(path.join(distPath, "index.html"));
        });
      }
    }
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();

export default app;
