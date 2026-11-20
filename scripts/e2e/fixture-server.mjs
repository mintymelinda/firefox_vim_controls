import { createServer } from "node:http";

const port = Number(process.env.FIXTURE_PORT || 4173);

function escapeHtml(value) {
  return value.replace(/[&<>"']/g, (character) => {
    const entities = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    };
    return entities[character];
  });
}

const server = createServer((request, response) => {
  const url = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);
  if (url.pathname === "/health") {
    response.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
    response.end("ok");
    return;
  }

  const pathLabel = escapeHtml(decodeURIComponent(url.pathname));
  const title =
    url.pathname === "/" ? "Firefox Vim Controls fixture" : `Firefox Vim Controls fixture — ${pathLabel}`;

  response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  response.end(`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${title}</title>
  </head>
  <body>
    <main>
      <h1>${title}</h1>
      <label for="fixture-input">Editable test input</label>
      <input id="fixture-input" type="text" autocomplete="off">
      <button id="fixture-button" type="button">Fixture button</button>
    </main>
  </body>
</html>`);
});

server.listen(port, "0.0.0.0", () => {
  console.log(`Firefox smoke-test fixture listening on :${port}`);
});
