// Character create/edit forms and the request bodies built from them. Plain
// JavaScript so server tests can check them against the Manager routes.

export function parseTagInput(value) {
  return [
    ...new Set(
      String(value || "")
        .split(",")
        .map((tag) => tag.trim())
        .filter(Boolean),
    ),
  ];
}

export function createCharacterPayload(form) {
  return {
    name: form.name.trim(),
    description: form.description,
    creator_notes: form.creator_notes,
    extensions: { depth_prompt: form.depth_prompt },
    first_mes: form.first_mes,
    tags: parseTagInput(form.tags),
  };
}

export function createCardFormState(card) {
  return {
    depth_prompt: { prompt: "", depth: 4, role: "system", ...card.extensions?.depth_prompt },
    name: card.name || "",
    description: card.description || "",
    personality: card.personality || "",
    scenario: card.scenario || "",
    first_mes: card.first_mes || "",
    mes_example: card.mes_example || "",
    creator_notes: card.creator_notes || "",
    system_prompt: card.system_prompt || "",
    post_history_instructions: card.post_history_instructions || "",
    creator: card.creator || "",
    character_version: card.character_version || "",
    alternate_greetings: card.alternate_greetings || [],
    group_only_greetings: card.group_only_greetings || [],
    tags: (card.tags || []).join(", "),
    // A tag may contain a comma (SillyTavern keeps it whole), which the tag
    // text cannot show; the saved tags go back as they are unless it is edited.
    savedTags: card.tags || [],
  };
}

export function createCardUpdatePayload(form) {
  return {
    name: form.name,
    description: form.description,
    personality: form.personality,
    scenario: form.scenario,
    first_mes: form.first_mes,
    mes_example: form.mes_example,
    creator_notes: form.creator_notes,
    extensions: { depth_prompt: form.depth_prompt },
    system_prompt: form.system_prompt,
    post_history_instructions: form.post_history_instructions,
    creator: form.creator,
    character_version: form.character_version,
    alternate_greetings: form.alternate_greetings,
    group_only_greetings: form.group_only_greetings,
    tags: form.tags === (form.savedTags ?? []).join(", ") ? form.savedTags : parseTagInput(form.tags),
  };
}
