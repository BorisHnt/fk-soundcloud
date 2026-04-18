#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");

const ROOT_DIR = path.resolve(__dirname, "..");
const PORT = Number(process.env.PORT || 4173);

const MIME_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".mp3": "audio/mpeg",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".txt": "text/plain; charset=utf-8",
};

http
  .createServer((request, response) => {
    const url = new URL(request.url, `http://${request.headers.host}`);
    let requestPath = decodeURIComponent(url.pathname);

    if (requestPath === "/") {
      requestPath = "/index.html";
    }

    const filePath = path.join(ROOT_DIR, requestPath);

    if (!filePath.startsWith(ROOT_DIR)) {
      response.writeHead(403);
      response.end("Forbidden");
      return;
    }

    fs.readFile(filePath, (error, buffer) => {
      if (error) {
        response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
        response.end("Not found");
        return;
      }

      const extension = path.extname(filePath).toLowerCase();
      response.writeHead(200, {
        "Content-Type": MIME_TYPES[extension] || "application/octet-stream",
      });
      response.end(buffer);
    });
  })
  .listen(PORT, () => {
    console.log(`Preview server running on http://localhost:${PORT}`);
  });
