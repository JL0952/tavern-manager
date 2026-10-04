import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  Drawer,
  OverlayHeader,
  StatusPanel as CommonStatusPanel,
} from "./common/index.js";
import GraphPage from "../pages/GraphPage.jsx";
import { getRpStats, getRpTagDetail } from "../services/api.js";

const chartColors = [
  "#73522d",
  "#0f766e",
  "#9f1239",
  "#4338ca",
  "#a16207",
  "#047857",
  "#be185d",
  "#2563eb",
  "#64748b",
];

function formatPercent(value) {
  return `${Number(value || 0).toFixed(1).replace(/\.0$/, "")}%`;
}

function describeCount(value, singular, plural) {
  return `${value} ${value === 1 ? singular : plural}`;
}

function polarToCartesian(center, radius, angleInDegrees) {
  const angleInRadians = ((angleInDegrees - 90) * Math.PI) / 180;

  return {
    x: center + radius * Math.cos(angleInRadians),
    y: center + radius * Math.sin(angleInRadians),
  };
}

function describeArc(center, radius, startAngle, endAngle) {
  const start = polarToCartesian(center, radius, endAngle);
  const end = polarToCartesian(center, radius, startAngle);
  const largeArcFlag = endAngle - startAngle <= 180 ? "0" : "1";

  return [
    `M ${center} ${center}`,
    `L ${start.x} ${start.y}`,
    `A ${radius} ${radius} 0 ${largeArcFlag} 0 ${end.x} ${end.y}`,
    "Z",
  ].join(" ");
}

function RpStatsDrawer({ open, onClose, refreshKey = 0 }) {
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [selectedTag, setSelectedTag] = useState("");
  const [libraryMapOpen, setLibraryMapOpen] = useState(false);
  const [tagDetail, setTagDetail] = useState(null);
  const [tagDetailLoading, setTagDetailLoading] = useState(false);
  const [tagDetailError, setTagDetailError] = useState("");

  useEffect(() => {
    if (!open) {
      return undefined;
    }

    function handleKeyDown(event) {
      if (event.key === "Escape") {
        if (libraryMapOpen) {
          setLibraryMapOpen(false);
          return;
        }

        onClose();
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [libraryMapOpen, onClose, open]);

  useEffect(() => {
    let active = true;

    if (!open) {
      return () => {
        active = false;
      };
    }

    setLoading(true);
    setError("");

    getRpStats()
      .then((nextStats) => {
        if (active) {
          setStats(nextStats);
        }
      })
      .catch((requestError) => {
        if (active) {
          setError(requestError.message);
          setStats(null);
        }
      })
      .finally(() => {
        if (active) {
          setLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, [open, refreshKey]);

  useEffect(() => {
    let active = true;

    if (!selectedTag) {
      setTagDetail(null);
      setTagDetailError("");
      return () => {
        active = false;
      };
    }

    setTagDetailLoading(true);
    setTagDetailError("");

    getRpTagDetail(selectedTag)
      .then((detail) => {
        if (active) {
          setTagDetail(detail);
        }
      })
      .catch((requestError) => {
        if (active) {
          setTagDetailError(requestError.message);
          setTagDetail(null);
        }
      })
      .finally(() => {
        if (active) {
          setTagDetailLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, [selectedTag]);

  if (!open) {
    return null;
  }

  return (
    <Drawer ariaLabel="RP statistics drawer" onClose={onClose}>
      <OverlayHeader eyebrow="RP library" title="Statistics" onClose={onClose} />

      <div className="flex-1 overflow-y-auto px-4 py-4 sm:px-5 sm:py-5">
        {loading && (
          <CommonStatusPanel
            className="text-left"
            message="Loading RP statistics..."
            variant="loading"
          />
        )}
        {error && (
          <CommonStatusPanel
            className="text-left"
            title="Unable to load statistics"
            message={error}
            variant="error"
          />
        )}

        {!loading && !error && stats && (
          <div className="space-y-5">
            <SummaryGrid stats={stats} />
            <PieSection
              data={stats.tagDistributionForPie || []}
              onSelectTag={setSelectedTag}
            />
            <HorizontalBarSection
              title="Tag Coverage"
              subtitle="Percent of characters with each tag"
              data={(stats.tagCoverage || []).slice(0, 16)}
              getLabel={(item) => item.tag}
              getValue={(item) => item.percentageOfCharacters}
              getMeta={(item) =>
                `${describeCount(item.characterCount, "character", "characters")} - ${formatPercent(
                  item.percentageOfCharacters,
                )}`
              }
              onSelect={(item) => setSelectedTag(item.tag)}
            />
            <HorizontalBarSection
              title="Top Tag Pairings"
              subtitle="Characters sharing both tags"
              data={stats.topTagCombinations || []}
              getLabel={(item) => item.tags.join(" + ")}
              getValue={(item) => item.percentageOfCharacters}
              getMeta={(item) =>
                `${describeCount(item.count, "character", "characters")} - ${formatPercent(
                  item.percentageOfCharacters,
                )}`
              }
            />
            <WorldbookUsageSection
              data={stats.worldbookUsage || []}
              onClose={onClose}
            />
            <LibraryMapEntry onOpen={() => setLibraryMapOpen(true)} />
          </div>
        )}
      </div>

      {selectedTag && (
        <TagDetailPanel
          detail={tagDetail}
          error={tagDetailError}
          loading={tagDetailLoading}
          onClose={() => setSelectedTag("")}
          onDrawerClose={onClose}
          tag={selectedTag}
        />
      )}

      {libraryMapOpen && (
        <GraphPage
          overlay
          refreshKey={refreshKey}
          onClose={() => setLibraryMapOpen(false)}
          onNavigate={onClose}
        />
      )}
    </Drawer>
  );
}

function SummaryGrid({ stats }) {
  const items = [
    ["Total characters", stats.totalCharacters],
    ["Total worldbooks", stats.totalWorldbooks],
    ["Worldbook coverage", formatPercent(stats.worldbookCoveragePercentage)],
    ["Avg tags per character", stats.averageTagsPerCharacter],
  ];

  return (
    <section className="grid grid-cols-1 gap-3 min-[380px]:grid-cols-2" aria-label="RP summary">
      {items.map(([label, value]) => (
        <div className="rounded-2xl border border-tavern-200 bg-white p-4 shadow-sm" key={label}>
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-tavern-700">
            {label}
          </p>
          <p className="mt-2 text-2xl font-bold text-tavern-900">{value}</p>
        </div>
      ))}
    </section>
  );
}

function PieSection({ data, onSelectTag }) {
  const total = data.reduce((sum, item) => sum + item.count, 0);
  let angle = 0;

  return (
    <ChartPanel title="Tag Share" subtitle="Top tags by total assignments">
      {total === 0 ? (
        <p className="text-sm text-slate-600">No tags yet.</p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-[12rem_1fr] sm:items-center">
          <svg aria-label="Tag share pie chart" className="mx-auto h-44 w-44" viewBox="0 0 200 200">
            {data.map((item, index) => {
              const sliceAngle = (item.count / total) * 360;
              const path = describeArc(100, 92, angle, angle + sliceAngle);
              angle += sliceAngle;

              return (
                <path
                  className={item.tag === "Other" ? "" : "cursor-pointer"}
                  d={path}
                  fill={chartColors[index % chartColors.length]}
                  key={item.tag}
                  onClick={() => item.tag !== "Other" && onSelectTag(item.tag)}
                />
              );
            })}
            <circle cx="100" cy="100" fill="var(--surface-muted)" r="46" />
            <text
              fill="var(--text-strong)"
              fontSize="18"
              fontWeight="700"
              textAnchor="middle"
              x="100"
              y="105"
            >
              Tags
            </text>
          </svg>
          <div className="space-y-2">
            {data.map((item, index) => (
              <button
                className="flex w-full items-center justify-between gap-3 rounded-xl px-2 py-1.5 text-left text-sm transition hover:bg-tavern-50 disabled:cursor-default disabled:hover:bg-transparent"
                disabled={item.tag === "Other"}
                key={item.tag}
                type="button"
                onClick={() => onSelectTag(item.tag)}
              >
                <span className="flex min-w-0 items-center gap-2">
                  <span
                    className="h-3 w-3 shrink-0 rounded-full"
                    style={{ backgroundColor: chartColors[index % chartColors.length] }}
                  />
                  <span className="truncate font-semibold text-tavern-900">{item.tag}</span>
                </span>
                <span className="shrink-0 text-xs text-slate-500">
                  {item.count} - {formatPercent(item.percentageOfAllTagAssignments)}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </ChartPanel>
  );
}

function HorizontalBarSection({ data, getLabel, getMeta, getValue, onSelect, subtitle, title }) {
  const maxValue = useMemo(
    () => Math.max(1, ...data.map((item) => Number(getValue(item)) || 0)),
    [data, getValue],
  );

  return (
    <ChartPanel title={title} subtitle={subtitle}>
      {data.length === 0 ? (
        <p className="text-sm text-slate-600">Nothing to show yet.</p>
      ) : (
        <div className="max-h-80 space-y-3 overflow-y-auto pr-1">
          {data.map((item) => {
            const label = getLabel(item);
            const value = Number(getValue(item)) || 0;
            const bar = (
              <div className="w-full">
                <div className="flex justify-between gap-3 text-sm">
                  <span className="truncate font-semibold text-tavern-900">{label}</span>
                  <span className="shrink-0 text-xs text-slate-500">{getMeta(item)}</span>
                </div>
                <div className="mt-1 h-2 rounded-full bg-tavern-200">
                  <div
                    className="h-2 rounded-full bg-tavern-700"
                    style={{ width: `${Math.max(3, (value / maxValue) * 100)}%` }}
                  />
                </div>
              </div>
            );

            return onSelect ? (
              <button
                className="block w-full rounded-xl px-2 py-1.5 text-left transition hover:bg-tavern-50"
                key={label}
                type="button"
                onClick={() => onSelect(item)}
              >
                {bar}
              </button>
            ) : (
              <div className="rounded-xl px-2 py-1.5" key={label}>
                {bar}
              </div>
            );
          })}
        </div>
      )}
    </ChartPanel>
  );
}

function WorldbookUsageSection({ data, onClose }) {
  const maxValue = Math.max(1, ...data.map((item) => item.linkedCharacterCount || 0));

  return (
    <ChartPanel title="Worldbook Usage" subtitle="Characters linked to each worldbook">
      {data.length === 0 ? (
        <p className="text-sm text-slate-600">No worldbooks yet.</p>
      ) : (
        <div className="max-h-72 space-y-3 overflow-y-auto pr-1">
          {data.map((item) => (
            <Link
              className="block rounded-xl px-2 py-1.5 transition hover:bg-tavern-50"
              key={item.worldBookId}
              to={`/worldbooks/${encodeURIComponent(item.worldBookId)}`}
              onClick={onClose}
            >
              <div className="flex justify-between gap-3 text-sm">
                <span className="truncate font-semibold text-tavern-900">{item.name}</span>
                <span className="shrink-0 text-xs text-slate-500">
                  {describeCount(item.linkedCharacterCount, "character", "characters")}
                </span>
              </div>
              <div className="mt-1 h-2 rounded-full bg-tavern-200">
                <div
                  className="h-2 rounded-full bg-tavern-700"
                  style={{
                    width: `${Math.max(3, (item.linkedCharacterCount / maxValue) * 100)}%`,
                  }}
                />
              </div>
            </Link>
          ))}
        </div>
      )}
    </ChartPanel>
  );
}

function LibraryMapEntry({ onOpen }) {
  return (
    <button
      className="block w-full rounded-2xl border border-tavern-200 bg-white p-4 text-left shadow-sm transition hover:border-tavern-700 hover:bg-tavern-50"
      type="button"
      onClick={onOpen}
    >
      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-tavern-700">
        Visual explorer
      </p>
      <p className="mt-1 text-lg font-bold text-tavern-900">Open Library Map</p>
      <p className="mt-1 text-sm text-slate-600">
        Visualize your RP worlds and characters.
      </p>
    </button>
  );
}

function TagDetailPanel({ detail, error, loading, onClose, onDrawerClose, tag }) {
  return (
    <div className="absolute inset-y-0 right-0 z-10 flex w-full max-w-md flex-col border-l border-tavern-200 bg-white shadow-2xl">
      <OverlayHeader
        eyebrow="Tag detail"
        headingLevel={3}
        title={tag}
        onClose={onClose}
      />
      <div className="flex-1 overflow-y-auto px-4 py-4 sm:px-5 sm:py-5">
        {loading && (
          <CommonStatusPanel
            className="text-left"
            message="Loading tag detail..."
            variant="loading"
          />
        )}
        {error && (
          <CommonStatusPanel
            className="text-left"
            title="Unable to load tag detail"
            message={error}
            variant="error"
          />
        )}
        {!loading && !error && detail && (
          <div className="space-y-5">
            <div className="rounded-2xl border border-tavern-200 bg-tavern-50 p-4">
              <p className="text-xl font-bold text-tavern-900">
                {describeCount(detail.characterCount, "character", "characters")}
              </p>
              <p className="mt-1 text-sm text-slate-600">
                {formatPercent(detail.percentageOfCharacters)} of the library
              </p>
            </div>

            <DetailList title="Characters">
              {detail.characters.length === 0 ? (
                <p className="text-sm text-slate-600">No characters found.</p>
              ) : (
                detail.characters.map((character) => (
                  <Link
                    className="block rounded-xl px-3 py-2 text-sm font-semibold text-tavern-700 transition hover:bg-tavern-50"
                    key={character.id}
                    to={`/cards/${encodeURIComponent(character.id)}`}
                    onClick={onDrawerClose}
                  >
                    {character.name}
                  </Link>
                ))
              )}
            </DetailList>

            <DetailList title="Common combinations">
              {detail.commonCombinations.length === 0 ? (
                <p className="text-sm text-slate-600">No combinations yet.</p>
              ) : (
                detail.commonCombinations.map((item) => (
                  <div className="flex justify-between rounded-xl px-3 py-2 text-sm" key={item.tag}>
                    <span className="font-semibold text-tavern-900">{item.tag}</span>
                    <span className="text-slate-500">{item.count}</span>
                  </div>
                ))
              )}
            </DetailList>

            <DetailList title="Linked worldbooks">
              {detail.linkedWorldbooks.length === 0 ? (
                <p className="text-sm text-slate-600">No linked worldbooks.</p>
              ) : (
                detail.linkedWorldbooks.map((worldBook) => (
                  <Link
                    className="block rounded-xl px-3 py-2 text-sm transition hover:bg-tavern-50"
                    key={worldBook.id}
                    to={`/worldbooks/${encodeURIComponent(worldBook.id)}`}
                    onClick={onDrawerClose}
                  >
                    <span className="font-semibold text-tavern-700">{worldBook.name}</span>
                    <span className="ml-2 text-xs text-slate-500">
                      {describeCount(worldBook.characterCount, "character", "characters")}
                    </span>
                  </Link>
                ))
              )}
            </DetailList>
          </div>
        )}
      </div>
    </div>
  );
}

function DetailList({ children, title }) {
  return (
    <section className="rounded-2xl border border-tavern-200 bg-white p-4">
      <h4 className="font-bold text-tavern-900">{title}</h4>
      <div className="mt-2">{children}</div>
    </section>
  );
}

function ChartPanel({ children, subtitle, title }) {
  return (
    <section className="rounded-2xl border border-tavern-200 bg-white p-4 shadow-sm">
      <h3 className="font-bold text-tavern-900">{title}</h3>
      {subtitle && <p className="mt-1 text-sm text-slate-600">{subtitle}</p>}
      <div className="mt-4">{children}</div>
    </section>
  );
}

export default RpStatsDrawer;
