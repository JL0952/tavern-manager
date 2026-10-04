import { drag } from "d3-drag";
import {
  forceCenter,
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  forceX,
  forceY,
} from "d3-force";
import { select } from "d3-selection";
import { zoom, zoomIdentity } from "d3-zoom";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  Button,
  getButtonClasses,
  OverlayCloseButton,
  StatusPanel,
} from "../components/common/index.js";
import LibraryNav from "../components/LibraryNav.jsx";
import { getLibraryGraph } from "../services/api.js";

const defaultCounts = {
  characters: 0,
  worldbooks: 0,
  orphans: 0,
};

const defaultGraph = {
  nodes: [],
  edges: [],
  metadata: {
    counts: defaultCounts,
  },
};

function getRootTheme() {
  return document.documentElement.dataset.theme === "dark" ? "dark" : "light";
}

function getGraphTheme(themeMode) {
  const dark = themeMode === "dark";

  return {
    background: dark ? "#111827" : "#fbf8f1",
    character: dark ? "#9aa9ba" : "#8b9aaa",
    characterStroke: dark ? "#cbd5e1" : "#64748b",
    edge: dark ? "#94a3b8" : "#94a3b8",
    edgeActive: dark ? "#e4c487" : "#73522d",
    orphan: dark ? "#263244" : "#eef2f6",
    orphanStroke: dark ? "#64748b" : "#94a3b8",
    pinned: dark ? "#d8b4fe" : "#7c3aed",
    selected: dark ? "#f7efe2" : "#111827",
    text: dark ? "#f7efe2" : "#3c2b1d",
    textMuted: dark ? "#cbd5e1" : "#475569",
    worldbook: dark ? "#b98b4d" : "#80603a",
    worldbookLight: dark ? "#d6b06d" : "#ad8a56",
    worldbookStroke: dark ? "#f7efe2" : "#3c2b1d",
  };
}

function hashString(value) {
  let hash = 0;

  for (const character of String(value || "")) {
    hash = (hash * 31 + character.charCodeAt(0)) % 100000;
  }

  return hash;
}

function getWorldBookRadius(node) {
  const linkedCount = Number(node.metadata?.linkedCharacterCount || 0);

  return 22 + Math.min(12, Math.sqrt(linkedCount) * 4);
}

function getNodeRadius(node) {
  if (node.type === "worldbook") {
    return getWorldBookRadius(node);
  }

  if (node.orphan) {
    return node.pinned ? 13 : 11.5;
  }

  return node.pinned ? 15 : 13.5;
}

function createSimulationNodes(nodes, width, height) {
  const centerX = width / 2;
  const centerY = height / 2;
  const outerRadius = Math.max(140, Math.min(width, height) * 0.36);

  return nodes.map((node) => {
    const angle = (hashString(node.id) / 100000) * Math.PI * 2;

    return {
      ...node,
      radius: getNodeRadius(node),
      targetX: node.orphan ? centerX + Math.cos(angle) * outerRadius : centerX,
      targetY: node.orphan ? centerY + Math.sin(angle) * outerRadius * 0.72 : centerY,
    };
  });
}

function getFocusedGraph(graph, selectedNodeId, focusMode) {
  if (!focusMode || !selectedNodeId) {
    return graph;
  }

  const visibleIds = new Set([selectedNodeId]);

  for (const edge of graph.edges) {
    if (edge.source === selectedNodeId) {
      visibleIds.add(edge.target);
    }

    if (edge.target === selectedNodeId) {
      visibleIds.add(edge.source);
    }
  }

  return {
    ...graph,
    nodes: graph.nodes.filter((node) => visibleIds.has(node.id)),
    edges: graph.edges.filter((edge) => visibleIds.has(edge.source) && visibleIds.has(edge.target)),
  };
}

function getWorldBookName(graph, worldBookId) {
  if (!worldBookId) {
    return "";
  }

  return graph.nodes.find((node) => node.id === `worldbook:${worldBookId}`)?.label || "";
}

function getLinkEndpointId(endpoint) {
  return typeof endpoint === "string" ? endpoint : endpoint.id;
}

function getAvatarUrl(node) {
  return node.type === "character" && node.avatar ? `/${node.avatar}` : "";
}

function getInitial(label) {
  return String(label || "?").trim().charAt(0).toUpperCase() || "?";
}

function getNodeStroke(node, selectedNodeId, theme) {
  if (node.id === selectedNodeId) {
    return theme.selected;
  }

  if (node.pinned) {
    return theme.pinned;
  }

  if (node.type === "worldbook") {
    return theme.worldbookStroke;
  }

  return node.orphan ? theme.orphanStroke : theme.characterStroke;
}

function getNodeStrokeWidth(node, selectedNodeId) {
  if (node.id === selectedNodeId) {
    return 3.5;
  }

  if (node.pinned) {
    return 2.4;
  }

  return node.type === "worldbook" ? 2.5 : 1.4;
}

function applyActiveStyles(canvasState, activeId, selectedNodeId) {
  if (!canvasState) {
    return;
  }

  const {
    circleSelection,
    labelSelection,
    linkedIdsByNode,
    linksSelection,
    nodeSelection,
    theme,
  } = canvasState;
  const activeNeighbors = activeId ? linkedIdsByNode.get(activeId) || new Set() : new Set();

  circleSelection
    .attr("stroke", (node) => getNodeStroke(node, selectedNodeId, theme))
    .attr("stroke-width", (node) => getNodeStrokeWidth(node, selectedNodeId));
  nodeSelection.attr("opacity", (node) => {
    if (!activeId) {
      return node.orphan ? 0.72 : 1;
    }

    return node.id === activeId || activeNeighbors.has(node.id) ? 1 : 0.22;
  });
  linksSelection
    .attr("stroke", (link) => {
      const source = getLinkEndpointId(link.source);
      const target = getLinkEndpointId(link.target);

      return source === activeId || target === activeId ? theme.edgeActive : theme.edge;
    })
    .attr("stroke-opacity", (link) => {
      const source = getLinkEndpointId(link.source);
      const target = getLinkEndpointId(link.target);

      return !activeId || source === activeId || target === activeId ? 0.52 : 0.08;
    })
    .attr("stroke-width", (link) => {
      const source = getLinkEndpointId(link.source);
      const target = getLinkEndpointId(link.target);

      return source === activeId || target === activeId ? 2 : 1.1;
    });
  labelSelection.attr("opacity", (node) => {
    if (node.type === "worldbook") {
      return activeId && node.id !== activeId && !activeNeighbors.has(node.id) ? 0.38 : 1;
    }

    return node.id === activeId || node.id === selectedNodeId ? 1 : 0;
  });
}

function GraphCanvas({ graph, onSelectNode, resetKey, selectedNodeId, themeMode }) {
  const canvasStateRef = useRef(null);
  const containerRef = useRef(null);
  const selectedNodeIdRef = useRef(selectedNodeId);
  const svgRef = useRef(null);
  const [size, setSize] = useState({ height: 560, width: 900 });

  useEffect(() => {
    selectedNodeIdRef.current = selectedNodeId;
    applyActiveStyles(canvasStateRef.current, selectedNodeId, selectedNodeId);
  }, [selectedNodeId]);

  useEffect(() => {
    if (!containerRef.current) {
      return undefined;
    }

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];

      if (!entry) {
        return;
      }

      setSize({
        height: Math.max(420, Math.round(entry.contentRect.height)),
        width: Math.max(320, Math.round(entry.contentRect.width)),
      });
    });

    observer.observe(containerRef.current);

    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!svgRef.current || graph.nodes.length === 0) {
      return undefined;
    }

    const theme = getGraphTheme(themeMode);
    const svg = select(svgRef.current);
    const width = size.width;
    const height = size.height;
    const nodes = createSimulationNodes(graph.nodes, width, height);
    const links = graph.edges.map((edge) => ({ ...edge }));
    const linkedIdsByNode = new Map();

    for (const link of links) {
      const source = getLinkEndpointId(link.source);
      const target = getLinkEndpointId(link.target);

      if (!linkedIdsByNode.has(source)) {
        linkedIdsByNode.set(source, new Set());
      }

      if (!linkedIdsByNode.has(target)) {
        linkedIdsByNode.set(target, new Set());
      }

      linkedIdsByNode.get(source).add(target);
      linkedIdsByNode.get(target).add(source);
    }

    svg.selectAll("*").remove();
    svg
      .attr("viewBox", `0 0 ${width} ${height}`)
      .attr("role", "img")
      .attr("aria-label", "Library map")
      .style("background", theme.background);

    const viewport = svg.append("g");
    const zoomBehavior = zoom()
      .scaleExtent([0.25, 3])
      .on("zoom", (event) => {
        viewport.attr("transform", event.transform);
      });

    svg.call(zoomBehavior).call(zoomBehavior.transform, zoomIdentity);

    const defs = svg.append("defs");
    const avatarNodes = nodes.filter((node) => getAvatarUrl(node));

    defs
      .selectAll("clipPath")
      .data(avatarNodes)
      .join("clipPath")
      .attr("id", (node) => `avatar-clip-${node.id.replace(/[^a-zA-Z0-9_-]/g, "-")}`)
      .append("circle")
      .attr("r", (node) => Math.max(1, node.radius - 1));

    const linkGroup = viewport
      .append("g")
      .attr("fill", "none")
      .attr("stroke-linecap", "round");
    const nodeGroup = viewport.append("g");
    const labelGroup = viewport.append("g").attr("pointer-events", "none");
    const linksSelection = linkGroup
      .selectAll("line")
      .data(links)
      .join("line")
      .attr("stroke", theme.edge)
      .attr("stroke-opacity", 0.34)
      .attr("stroke-width", 1.2);
    const nodeSelection = nodeGroup
      .selectAll("g")
      .data(nodes)
      .join("g")
      .attr("cursor", "pointer")
      .on("click", (event, node) => {
        event.stopPropagation();
        onSelectNode(node.id);
      })
      .on("mouseenter", (_event, node) => {
        applyActiveStyles(canvasStateRef.current, node.id, selectedNodeIdRef.current);
      })
      .on("mouseleave", () => {
        applyActiveStyles(
          canvasStateRef.current,
          selectedNodeIdRef.current,
          selectedNodeIdRef.current,
        );
      });
    const labelSelection = labelGroup
      .selectAll("text")
      .data(nodes)
      .join("text")
      .attr("fill", theme.text)
      .attr("font-family", "ui-sans-serif, system-ui, sans-serif")
      .attr("font-size", (node) => (node.type === "worldbook" ? 13 : 10))
      .attr("font-weight", (node) => (node.type === "worldbook" ? 800 : 650))
      .attr("paint-order", "stroke")
      .attr("stroke", theme.background)
      .attr("stroke-linejoin", "round")
      .attr("stroke-width", 4)
      .attr("text-anchor", "middle")
      .text((node) => node.label);

    const circleSelection = nodeSelection
      .append("circle")
      .attr("r", (node) => node.radius)
      .attr("fill", (node) => {
        if (node.type === "worldbook") {
          return theme.worldbook;
        }

        return node.orphan ? theme.orphan : theme.character;
      })
      .attr("stroke", (node) => getNodeStroke(node, selectedNodeIdRef.current, theme))
      .attr("stroke-dasharray", (node) => (node.orphan ? "3 4" : null))
      .attr("stroke-width", (node) => getNodeStrokeWidth(node, selectedNodeIdRef.current));

    nodeSelection
      .filter((node) => node.type === "worldbook")
      .append("circle")
      .attr("r", (node) => Math.max(10, node.radius - 9))
      .attr("fill", theme.worldbookLight)
      .attr("fill-opacity", 0.28);

    nodeSelection
      .filter((node) => node.pinned && node.type === "character")
      .append("circle")
      .attr("r", (node) => node.radius + 3)
      .attr("fill", "none")
      .attr("stroke", theme.pinned)
      .attr("stroke-opacity", 0.8)
      .attr("stroke-width", 1.2);

    nodeSelection
      .filter((node) => getAvatarUrl(node))
      .append("image")
      .attr("clip-path", (node) => `url(#avatar-clip-${node.id.replace(/[^a-zA-Z0-9_-]/g, "-")})`)
      .attr("height", (node) => node.radius * 2)
      .attr("href", (node) => getAvatarUrl(node))
      .attr("preserveAspectRatio", "xMidYMid slice")
      .attr("width", (node) => node.radius * 2)
      .attr("x", (node) => -node.radius)
      .attr("y", (node) => -node.radius);

    nodeSelection
      .filter((node) => node.type === "character" && !getAvatarUrl(node))
      .append("text")
      .attr("dy", "0.35em")
      .attr("fill", theme.text)
      .attr("font-family", "ui-sans-serif, system-ui, sans-serif")
      .attr("font-size", 10)
      .attr("font-weight", 800)
      .attr("paint-order", "stroke")
      .attr("stroke", theme.background)
      .attr("stroke-width", 2)
      .attr("text-anchor", "middle")
      .text((node) => getInitial(node.label));

    const simulation = forceSimulation(nodes)
      .force(
        "link",
        forceLink(links)
          .id((node) => node.id)
          .distance((link) => {
            const source = typeof link.source === "string" ? null : link.source;
            const target = typeof link.target === "string" ? null : link.target;
            const hasWorldbook = source?.type === "worldbook" || target?.type === "worldbook";

            return hasWorldbook ? 96 : 120;
          })
          .strength(0.58),
      )
      .force(
        "charge",
        forceManyBody().strength((node) => {
          if (node.type === "worldbook") {
            return -560;
          }

          return node.orphan ? -120 : -210;
        }),
      )
      .force("center", forceCenter(width / 2, height / 2))
      .force(
        "collide",
        forceCollide()
          .radius((node) => node.radius + (node.type === "worldbook" ? 18 : 8))
          .strength(0.86),
      )
      .force(
        "x",
        forceX((node) => (node.orphan ? node.targetX : width / 2)).strength((node) => {
          if (node.type === "worldbook") {
            return 0.08;
          }

          return node.orphan ? 0.045 : 0.018;
        }),
      )
      .force(
        "y",
        forceY((node) => (node.orphan ? node.targetY : height / 2)).strength((node) => {
          if (node.type === "worldbook") {
            return 0.08;
          }

          return node.orphan ? 0.045 : 0.018;
        }),
      )
      .on("tick", () => {
        linksSelection
          .attr("x1", (link) => link.source.x)
          .attr("y1", (link) => link.source.y)
          .attr("x2", (link) => link.target.x)
          .attr("y2", (link) => link.target.y);
        nodeSelection.attr("transform", (node) => `translate(${node.x},${node.y})`);
        labelSelection
          .attr("x", (node) => node.x)
          .attr("y", (node) => node.y + node.radius + (node.type === "worldbook" ? 19 : 15));
      });

    const nodeDrag = drag()
      .on("start", (event, node) => {
        if (!event.active) {
          simulation.alphaTarget(0.18).restart();
        }

        node.fx = node.x;
        node.fy = node.y;
      })
      .on("drag", (event, node) => {
        node.fx = event.x;
        node.fy = event.y;
      })
      .on("end", (event, node) => {
        if (!event.active) {
          simulation.alphaTarget(0);
        }

        node.fx = null;
        node.fy = null;
      });

    nodeSelection.call(nodeDrag);
    svg.on("click", () => onSelectNode(null));
    canvasStateRef.current = {
      circleSelection,
      labelSelection,
      linkedIdsByNode,
      linksSelection,
      nodeSelection,
      theme,
    };
    applyActiveStyles(canvasStateRef.current, selectedNodeIdRef.current, selectedNodeIdRef.current);

    return () => {
      simulation.stop();
      if (canvasStateRef.current?.nodeSelection === nodeSelection) {
        canvasStateRef.current = null;
      }
      svg.on(".zoom", null);
      svg.on("click", null);
    };
  }, [graph, onSelectNode, resetKey, size.height, size.width, themeMode]);

  return (
    <div
      className="min-h-[22rem] flex-1 overflow-hidden rounded-3xl border border-tavern-200 bg-white shadow-sm sm:min-h-[30rem] lg:min-h-0"
      ref={containerRef}
      style={{ background: getGraphTheme(themeMode).background }}
    >
      <svg className="h-[24rem] w-full sm:h-[34rem] lg:h-full" ref={svgRef} />
    </div>
  );
}

function GraphToggle({ checked, label, onChange }) {
  return (
    <label className="flex items-center justify-between gap-4 rounded-2xl border border-tavern-200 bg-white px-4 py-3 text-sm font-semibold text-tavern-900">
      <span>{label}</span>
      <input
        className="h-4 w-4"
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
    </label>
  );
}

function getNodeKindLabel(node) {
  if (!node) {
    return "";
  }

  return node.type === "worldbook" ? "Worldbook" : "Character";
}

function SelectedNodePreview({ graph, node, onNavigate }) {
  const worldBookName =
    node?.type === "character" ? getWorldBookName(graph, node.worldBookId) : "";

  if (!node) {
    return (
      <StatusPanel
        className="rounded-3xl p-6"
        message="Select a worldbook or character to preview it here."
        variant="empty"
      />
    );
  }

  return (
    <section className="rounded-3xl border border-tavern-200 bg-white p-5 shadow-sm">
      <p className="text-xs font-bold uppercase tracking-wide text-slate-500">
        {getNodeKindLabel(node)}
      </p>
      <h2 className="mt-2 text-xl font-bold text-tavern-900">{node.label}</h2>

      {node.type === "character" && (
        <div className="mt-5 space-y-4">
          <dl className="grid gap-3 text-sm">
            <div>
              <dt className="font-semibold text-slate-500">Pinned</dt>
              <dd className="mt-1 text-tavern-900">{node.pinned ? "Yes" : "No"}</dd>
            </div>
            <div>
              <dt className="font-semibold text-slate-500">Worldbook</dt>
              <dd className="mt-1 text-tavern-900">{worldBookName || "None"}</dd>
            </div>
          </dl>
          {node.tags?.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {node.tags.map((tag) => (
                <span
                  className="rounded-full bg-tavern-50 px-3 py-1 text-xs font-semibold text-tavern-700"
                  key={tag}
                >
                  {tag}
                </span>
              ))}
            </div>
          )}
          <Link
            className={getButtonClasses({ size: "sm", variant: "primary" })}
            to={node.route}
            onClick={onNavigate}
          >
            Open Character
          </Link>
        </div>
      )}

      {node.type === "worldbook" && (
        <div className="mt-5 space-y-4">
          <dl className="grid gap-3 text-sm">
            <div>
              <dt className="font-semibold text-slate-500">Linked characters</dt>
              <dd className="mt-1 text-tavern-900">
                {node.metadata?.linkedCharacterCount || 0}
              </dd>
            </div>
            <div>
              <dt className="font-semibold text-slate-500">Entries</dt>
              <dd className="mt-1 text-tavern-900">{node.metadata?.entryCount || 0}</dd>
            </div>
          </dl>
          <Link
            className={getButtonClasses({ size: "sm", variant: "primary" })}
            to={node.route}
            onClick={onNavigate}
          >
            Open Worldbook
          </Link>
        </div>
      )}
    </section>
  );
}

function GraphLegend() {
  const items = [
    ["Worldbook hub", "bg-tavern-700"],
    ["Character", "bg-slate-400"],
    ["Pinned", "border-2 border-violet-500 bg-slate-100"],
    ["Orphan", "border-2 border-dashed border-slate-400 bg-white"],
  ];

  return (
    <div className="flex flex-wrap gap-3 text-xs font-semibold text-slate-600">
      {items.map(([label, swatchClass]) => (
        <span className="inline-flex items-center gap-2" key={label}>
          <span className={`h-3 w-3 rounded-full ${swatchClass}`} />
          {label}
        </span>
      ))}
    </div>
  );
}

function GraphPage({ onClose, onNavigate, overlay = false, refreshKey = 0 }) {
  const [graph, setGraph] = useState(defaultGraph);
  const [includeOrphans, setIncludeOrphans] = useState(true);
  const [pinnedOnly, setPinnedOnly] = useState(false);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [selectedNodeId, setSelectedNodeId] = useState(null);
  const [focusMode, setFocusMode] = useState(false);
  const [resetKey, setResetKey] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [themeMode, setThemeMode] = useState(getRootTheme);

  useEffect(() => {
    if (!overlay || !onClose) {
      return undefined;
    }

    function handleKeyDown(event) {
      if (event.key === "Escape") {
        onClose();
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose, overlay]);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setSearch(searchInput);
    }, 220);

    return () => window.clearTimeout(timeout);
  }, [searchInput]);

  useEffect(() => {
    const observer = new MutationObserver(() => {
      setThemeMode(getRootTheme());
    });

    observer.observe(document.documentElement, {
      attributeFilter: ["data-theme"],
      attributes: true,
    });

    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    let active = true;

    setLoading(true);
    setError("");

    getLibraryGraph({
      includeOrphans,
      pinnedOnly,
      search,
    })
      .then((nextGraph) => {
        if (!active) {
          return;
        }

        setGraph(nextGraph);
        setSelectedNodeId(null);
        setFocusMode(false);
      })
      .catch((requestError) => {
        if (!active) {
          return;
        }

        setError(requestError.message);
        setGraph(defaultGraph);
        setSelectedNodeId(null);
        setFocusMode(false);
      })
      .finally(() => {
        if (active) {
          setLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, [includeOrphans, pinnedOnly, search, refreshKey]);

  const visibleGraph = useMemo(
    () => getFocusedGraph(graph, selectedNodeId, focusMode),
    [focusMode, graph, selectedNodeId],
  );
  const selectedNode = useMemo(
    () => graph.nodes.find((node) => node.id === selectedNodeId) || null,
    [graph.nodes, selectedNodeId],
  );
  const counts = graph.metadata?.counts || defaultCounts;

  const content = (
    <main
      className={
        overlay
          ? "flex h-full min-h-0 flex-col overflow-y-auto bg-tavern-50 px-3 py-3 sm:px-5 sm:py-4"
          : "min-h-screen bg-tavern-50 px-4 py-6 sm:px-6 sm:py-10 lg:px-8"
      }
    >
      <div
        className={
          overlay
            ? "mx-auto flex h-full min-h-0 w-full max-w-[104rem] flex-col gap-4"
            : "mx-auto flex h-auto max-w-7xl flex-col gap-5 lg:h-[calc(100vh-5rem)]"
        }
      >
        {!overlay && <LibraryNav />}
        <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-sm font-bold uppercase tracking-wide text-tavern-700">
              RP Universe Map
            </p>
            <h1 className="mt-2 text-3xl font-bold text-tavern-900">Library Map</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">
              A visual map of your RP worlds and characters.
            </p>
          </div>
          {onClose && <OverlayCloseButton ariaLabel="Close Library Map" onClick={onClose} />}
        </header>

        <section className="grid min-h-0 flex-1 gap-5 lg:grid-cols-[17rem_minmax(0,1fr)_18rem]">
          <aside className="space-y-4 rounded-3xl border border-tavern-200 bg-white p-4 shadow-sm sm:p-5 lg:min-h-0 lg:overflow-y-auto">
            <div>
              <label className="text-sm font-bold text-tavern-900" htmlFor="library-map-search">
                Search
              </label>
              <input
                className="mt-2 w-full rounded-2xl border border-tavern-200 px-4 py-2 text-sm outline-none placeholder:text-slate-400 focus:border-tavern-700 focus:ring-2 focus:ring-tavern-200"
                id="library-map-search"
                type="search"
                value={searchInput}
                onChange={(event) => setSearchInput(event.target.value)}
                placeholder="World or character..."
              />
            </div>

            <div className="space-y-3">
              <GraphToggle
                checked={includeOrphans}
                label="Include orphans"
                onChange={setIncludeOrphans}
              />
              <GraphToggle
                checked={pinnedOnly}
                label="Pinned only"
                onChange={setPinnedOnly}
              />
            </div>

            <div className="grid gap-3">
              <Button
                size="sm"
                type="button"
                variant="secondary"
                onClick={() => {
                  setFocusMode(false);
                  setResetKey((key) => key + 1);
                }}
              >
                Reset View
              </Button>
              <Button
                size="sm"
                type="button"
                variant={focusMode ? "primary" : "secondary"}
                disabled={!selectedNodeId}
                onClick={() => setFocusMode(true)}
              >
                Focus Selected
              </Button>
              <Button
                size="sm"
                type="button"
                variant="secondary"
                disabled={!focusMode}
                onClick={() => setFocusMode(false)}
              >
                Show All
              </Button>
            </div>

            <dl className="grid grid-cols-2 gap-3 text-sm">
              <div className="rounded-2xl bg-tavern-50 p-3">
                <dt className="text-xs font-semibold text-slate-500">Characters</dt>
                <dd className="mt-1 font-bold text-tavern-900">{counts.characters}</dd>
              </div>
              <div className="rounded-2xl bg-tavern-50 p-3">
                <dt className="text-xs font-semibold text-slate-500">Worldbooks</dt>
                <dd className="mt-1 font-bold text-tavern-900">{counts.worldbooks}</dd>
              </div>
              <div className="rounded-2xl bg-tavern-50 p-3 sm:col-span-2">
                <dt className="text-xs font-semibold text-slate-500">Orphans</dt>
                <dd className="mt-1 font-bold text-tavern-900">{counts.orphans}</dd>
              </div>
            </dl>
          </aside>

          <section className="flex min-h-0 flex-col gap-3">
            <GraphLegend />
            {loading && (
              <StatusPanel
                className="min-h-[22rem] flex-1 rounded-3xl p-6 sm:min-h-[30rem] sm:p-10"
                message="Loading map..."
                variant="loading"
              />
            )}
            {!loading && error && (
              <StatusPanel
                className="min-h-[22rem] flex-1 rounded-3xl p-6 sm:min-h-[30rem] sm:p-10"
                message={error}
                title="Unable to load map"
                variant="error"
              />
            )}
            {!loading && !error && visibleGraph.nodes.length === 0 && (
              <StatusPanel
                className="min-h-[22rem] flex-1 rounded-3xl p-6 sm:min-h-[30rem] sm:p-10"
                message="No map nodes match the current filters."
                variant="empty"
              />
            )}
            {!loading && !error && visibleGraph.nodes.length > 0 && (
              <GraphCanvas
                graph={visibleGraph}
                resetKey={resetKey}
                selectedNodeId={selectedNodeId}
                themeMode={themeMode}
                onSelectNode={setSelectedNodeId}
              />
            )}
          </section>

          <aside className="lg:min-h-0 lg:overflow-y-auto">
            <SelectedNodePreview graph={graph} node={selectedNode} onNavigate={onNavigate} />
          </aside>
        </section>
      </div>
    </main>
  );

  if (!overlay) {
    return content;
  }

  return (
    <div
      className="fixed inset-0 z-[70] bg-slate-950/45 px-0 py-0 backdrop-blur-[2px] sm:px-4 sm:py-6"
      role="presentation"
      onMouseDown={onClose}
    >
      <section
        aria-label="Library Map overlay"
        className="mx-auto flex h-full w-full flex-col overflow-hidden bg-tavern-50 shadow-2xl sm:h-[88vh] sm:w-[92vw] sm:max-w-[112rem] sm:rounded-3xl sm:border sm:border-tavern-200"
        onMouseDown={(event) => event.stopPropagation()}
      >
        {content}
      </section>
    </div>
  );
}

export default GraphPage;
