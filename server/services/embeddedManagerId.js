import { isPlainObject } from "./objects.js";

// The Manager UUID travels inside exported card files as
// data.extensions.tavern_manager.id, outside the canonical sync projection, so
// a manual download/import into SillyTavern keeps its identity. The Manager
// never stores the marker: record.id is the only source of truth, so imports
// strip it and exports write it fresh.
export const EMBEDDED_MANAGER_KEY = "tavern_manager";

export function readEmbeddedManagerId(card) {
  const source = isPlainObject(card?.data) ? card.data : card;
  const value = source?.extensions?.[EMBEDDED_MANAGER_KEY] ?? card?.extensions?.[EMBEDDED_MANAGER_KEY];
  return isPlainObject(value) && typeof value.id === "string" && value.id ? value.id : null;
}

function removeMarker(extensions) {
  if (isPlainObject(extensions)) {
    delete extensions[EMBEDDED_MANAGER_KEY];
  }
}

// Removes the marker from a parsed character record and returns the id it carried.
export function takeEmbeddedManagerId(character) {
  const id = readEmbeddedManagerId(character?.rawCard);
  removeMarker(character?.rawCard?.data?.extensions);
  removeMarker(character?.rawCard?.extensions);
  removeMarker(character?.extensions);
  return id;
}

export function embedManagerId(card, id) {
  const target = isPlainObject(card.data) ? card.data : card;
  target.extensions = {
    ...(isPlainObject(target.extensions) ? target.extensions : {}),
    [EMBEDDED_MANAGER_KEY]: { id },
  };
  return card;
}
