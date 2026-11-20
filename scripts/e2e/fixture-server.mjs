import { createServer } from "node:http";

const port = Number(process.env.FIXTURE_PORT || 4173);

const server = createServer((request, response) => {
  if (request.url === "/health") {
    response.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
    response.end("ok");
    return;
  }

  if (request.url !== "/") {
    response.writeHead(404);
    response.end("Not found");
    return;
  }

  response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  response.end(`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Firefox Vim Controls fixture</title>
  </head>
  <body>
    <main>
      <h1>Firefox Vim Controls fixture</h1>
      <label for="fixture-input">Editable test input</label>
      <input id="fixture-input" type="text" autocomplete="off">
      <button type="button">Fixture button</button>
    </main>
  </body>
</html>`);
});

server.listen(port, "0.0.0.0", () => {
  console.log(`Firefox smoke-test fixture listening on :${port}`);
});
