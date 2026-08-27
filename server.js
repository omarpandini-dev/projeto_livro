import { createServer } from "node:http";
import { readdir, readFile, stat } from "node:fs/promises";
import { createReadStream } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 3000;
const publicDir = path.join(__dirname, "public");
const booksDir = path.join(__dirname, "assets", "livros");

const mimeTypes = new Map([
  [".html", "text/html; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".webp", "image/webp"],
  [".gif", "image/gif"],
  [".svg", "image/svg+xml"],
  [".mp3", "audio/mpeg"]
]);

const imageExtensions = new Set([".jpg", ".jpeg", ".png", ".webp", ".gif"]);

function sendJson(response, status, data) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(data));
}

function titleFromSlug(slug) {
  return slug
    .replace(/[-_]+/g, " ")
    .replace(/([a-zA-Z])(\d)/g, "$1 $2")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

async function readBookInfo(bookPath) {
  try {
    const rawInfo = await readFile(path.join(bookPath, "info.json"), "utf8");
    const normalizedInfo = rawInfo.replace(/^\uFEFF/, "").replace(/,\s*([}\]])/g, "$1");
    const info = JSON.parse(normalizedInfo);

    return {
      title: typeof info.titulo === "string" && info.titulo.trim() ? info.titulo.trim() : null,
      description: typeof info.descricao === "string" && info.descricao.trim() ? info.descricao.trim() : null
    };
  } catch (error) {
    if (error.code === "ENOENT") {
      return { title: null, description: null };
    }

    console.warn(`Nao foi possivel ler info.json em ${bookPath}: ${error.message}`);
    return { title: null, description: null };
  }
}

function pageNumber(fileName, index) {
  const match = fileName.match(/\d+/);
  return match ? Number(match[0]) : Number.MAX_SAFE_INTEGER + index;
}

async function existingMp3ForImage(imagePath, bookSlug) {
  const parsedPath = path.parse(imagePath);
  const audioPath = path.join(parsedPath.dir, `${parsedPath.name}.mp3`);

  try {
    const audioStat = await stat(audioPath);
    if (!audioStat.isFile()) return null;
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }

  const relativeToBook = path.relative(path.join(booksDir, bookSlug), audioPath);
  const urlPath = ["assets", "livros", bookSlug, ...relativeToBook.split(path.sep)]
    .map(encodeURIComponent)
    .join("/");

  return `/${urlPath}`;
}

async function collectImages(directory, bookSlug, list = []) {
  const entries = await readdir(directory, { withFileTypes: true });

  for (const entry of entries) {
    const absolute = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      await collectImages(absolute, bookSlug, list);
      continue;
    }

    if (!entry.isFile() || !imageExtensions.has(path.extname(entry.name).toLowerCase())) {
      continue;
    }

    const relativeToBook = path.relative(path.join(booksDir, bookSlug), absolute);
    const urlPath = ["assets", "livros", bookSlug, ...relativeToBook.split(path.sep)]
      .map(encodeURIComponent)
      .join("/");

    list.push({
      name: entry.name,
      number: pageNumber(entry.name, list.length),
      url: `/${urlPath}`,
      audioUrl: await existingMp3ForImage(absolute, bookSlug)
    });
  }

  return list;
}

async function getBooks() {
  let entries = [];

  try {
    entries = await readdir(booksDir, { withFileTypes: true });
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }

  const books = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    const bookPath = path.join(booksDir, entry.name);
    const [pages, info] = await Promise.all([
      collectImages(bookPath, entry.name),
      readBookInfo(bookPath)
    ]);
    pages.sort((a, b) => a.number - b.number || a.name.localeCompare(b.name, undefined, { numeric: true }));

    if (pages.length === 0) continue;

    books.push({
      slug: entry.name,
      title: info.title || titleFromSlug(entry.name),
      description: info.description || "",
      pageCount: pages.length,
      thumb: pages[0].url,
      pages
    });
  }

  return books.sort((a, b) => a.title.localeCompare(b.title, undefined, { numeric: true }));
}

function safePath(baseDir, requestPath) {
  const decodedPath = decodeURIComponent(requestPath);
  const normalizedPath = path.normalize(decodedPath).replace(/^(\.\.[/\\])+/, "");
  const absolutePath = path.join(baseDir, normalizedPath);
  const relativePath = path.relative(baseDir, absolutePath);

  if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    return null;
  }

  return absolutePath;
}

async function serveFile(response, absolutePath) {
  try {
    const fileStat = await stat(absolutePath);
    if (!fileStat.isFile()) {
      sendJson(response, 404, { error: "Arquivo nao encontrado." });
      return;
    }

    const contentType = mimeTypes.get(path.extname(absolutePath).toLowerCase()) || "application/octet-stream";
    response.writeHead(200, {
      "Content-Type": contentType,
      "Content-Length": fileStat.size,
      "Cache-Control": "public, max-age=3600"
    });
    createReadStream(absolutePath).pipe(response);
  } catch (error) {
    if (error.code === "ENOENT") {
      sendJson(response, 404, { error: "Arquivo nao encontrado." });
      return;
    }

    sendJson(response, 500, { error: "Erro interno ao servir arquivo." });
  }
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", `http://${request.headers.host}`);

  if (url.pathname === "/api/books") {
    try {
      sendJson(response, 200, await getBooks());
    } catch {
      sendJson(response, 500, { error: "Nao foi possivel carregar os livros." });
    }
    return;
  }

  if (url.pathname.startsWith("/assets/")) {
    const assetPath = safePath(__dirname, url.pathname.slice(1));
    if (!assetPath) {
      sendJson(response, 403, { error: "Caminho invalido." });
      return;
    }

    await serveFile(response, assetPath);
    return;
  }

  const requestedPath = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
  const publicPath = safePath(publicDir, requestedPath);

  if (!publicPath) {
    sendJson(response, 403, { error: "Caminho invalido." });
    return;
  }

  try {
    await serveFile(response, publicPath);
  } catch {
    const indexHtml = await readFile(path.join(publicDir, "index.html"));
    response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    response.end(indexHtml);
  }
});

server.listen(PORT, () => {
  console.log(`Mundo Encantado rodando em http://localhost:${PORT}`);
});
