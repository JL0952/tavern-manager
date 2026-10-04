import express, { Router } from "express";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// The built Manager page (npm start builds it; npm run dev serves it on 5173).
export const defaultPageDirectory = fileURLToPath(new URL("../../client/dist", import.meta.url));

// The page's own files hold no library data: a device that has not signed in
// yet gets them too, to show the sign-in form. Client-side routes answer with
// index.html. A missing file (a top-level name such as /favicon.ico, or
// anything under /assets/) answers 404 instead; client routes never end a
// top-level segment in an extension.
export function createManagerPage({ directory = defaultPageDirectory } = {}) {
  const router = Router();
  const index = join(directory, "index.html");

  router.use(express.static(directory));
  router.use((request, response, next) => {
    if (!["GET", "HEAD"].includes(request.method) || /^\/(api|avatars)(\/|$)/.test(request.path)) {
      return next();
    }

    if (/^\/(assets\/|[^/]*\.[^/]*$)/.test(request.path)) {
      return response.sendStatus(404);
    }

    return response.sendFile(index, (error) => {
      if (error && !response.headersSent) {
        response.status(404).type("text").send("The Manager page is not built yet. Start Manager with npm start.");
      }
    });
  });

  return router;
}

export default createManagerPage();
