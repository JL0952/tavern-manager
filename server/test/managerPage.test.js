import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import express from "express";
import { createManagerPage } from "../middleware/managerPage.js";

async function server(t, { built = true } = {}) {
  const directory = await mkdtemp(join(tmpdir(), "manager-page-"));
  if (built) {
    await mkdir(join(directory, "assets"));
    await writeFile(join(directory, "index.html"), "<div id=\"root\"></div>");
    await writeFile(join(directory, "assets", "app.js"), "console.log(1)");
  }
  const app = express();
  app.use(createManagerPage({ directory }));
  app.get("/api/cards", (_request, response) => response.json([]));
  const listener = app.listen(0, "127.0.0.1");
  await once(listener, "listening");
  t.after(async () => {
    listener.close();
    await rm(directory, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${listener.address().port}`;
  return async (path, options) => {
    const response = await fetch(`${base}${path}`, options);
    return { status: response.status, type: response.headers.get("content-type") ?? "", text: await response.text() };
  };
}

test("page routes get index.html, files are served, missing files get 404 instead of the page", async (t) => {
  const get = await server(t);

  for (const path of ["/", "/cards/abc", "/cards/a.b", "/worldbooks", "/files?type=themes"]) {
    const page = await get(path);
    assert.equal(page.status, 200, path);
    assert.match(page.type, /text\/html/, path);
  }
  assert.equal((await get("/assets/app.js")).text, "console.log(1)");
  for (const path of ["/favicon.ico", "/robots.txt", "/assets/missing.js"]) {
    assert.equal((await get(path)).status, 404, path);
  }
  assert.deepEqual(JSON.parse((await get("/api/cards")).text), []);
  assert.equal((await get("/api/missing")).status, 404);
  assert.doesNotMatch((await get("/api/missing")).text, /root/, "an unknown API path never gets the page");
  assert.equal((await get("/cards/abc", { method: "POST" })).status, 404);
});

test("an unbuilt page says how to build it", async (t) => {
  const get = await server(t, { built: false });
  const page = await get("/");
  assert.equal(page.status, 404);
  assert.match(page.text, /npm start/);
});
