import { type ReactNode, useState } from "react";
import {
  bggGameUrl,
  formatBggRank,
  formatPlayTime,
  formatPlayerCount,
  formatRating,
  gameTags,
  placeholderColor,
  type BoardGameDoc,
} from "./datatype";
import type { SortDirection, SortKey, TagGroup, TagOption } from "./collection-filters";

const tagGroupLabels: Record<TagGroup, string> = {
  category: "Categories",
  mechanic: "Mechanics",
  designer: "Designers",
};

const tagGroupChipClass: Record<TagGroup, string> = {
  category: "border-sky-200 bg-sky-50 text-sky-800",
  mechanic: "border-violet-200 bg-violet-50 text-violet-800",
  designer: "border-emerald-200 bg-emerald-50 text-emerald-800",
};

export function GameArt({ game }: { game: BoardGameDoc }) {
  const [failed, setFailed] = useState(false);
  const imageUrl = game.thumbnailUrl ?? game.imageUrl;

  if (!imageUrl || failed) {
    const initials = game.name
      .split(/\s+/)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase() ?? "")
      .join("");

    return (
      <div
        className="flex h-full w-full flex-col items-center justify-center gap-1 p-3 text-center text-white"
        style={{
          background: `linear-gradient(145deg, ${placeholderColor(game.bggId)}, ${placeholderColor(game.bggId + 17)})`,
        }}
      >
        <span className="text-2xl font-semibold">{initials || "?"}</span>
        {game.yearPublished ? (
          <span className="text-xs font-medium text-white/80">
            {game.yearPublished}
          </span>
        ) : null}
      </div>
    );
  }

  return (
    <img
      src={imageUrl}
      alt={game.name}
      className="h-full w-full object-cover"
      loading="lazy"
      onError={() => setFailed(true)}
    />
  );
}

export function TagMultiPicker({
  options,
  selected,
  onChange,
}: {
  options: TagOption[];
  selected: string[];
  onChange: (tags: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  if (!options.length) return null;

  const selectedSet = new Set(selected);
  const normalizedQuery = query.trim().toLowerCase();
  const visibleOptions = normalizedQuery
    ? options.filter((option) => option.label.toLowerCase().includes(normalizedQuery))
    : options;

  const grouped = (["category", "mechanic", "designer"] as const).map((group) => ({
    group,
    options: visibleOptions.filter((option) => option.group === group),
  }));

  const toggleTag = (label: string) => {
    if (selectedSet.has(label)) {
      onChange(selected.filter((tag) => tag !== label));
      return;
    }
    onChange([...selected, label]);
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          className="rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
        >
          {open ? "Hide tags" : "Filter tags"}
          {selected.length ? (
            <span className="ml-1 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800">
              {selected.length}
            </span>
          ) : null}
        </button>
        {selected.map((tag) => {
          const group =
            options.find((option) => option.label === tag)?.group ?? "category";
          return (
            <button
              key={tag}
              type="button"
              onClick={() => toggleTag(tag)}
              className={`rounded-full border px-2 py-0.5 text-xs ${tagGroupChipClass[group]}`}
            >
              {tag} ×
            </button>
          );
        })}
      </div>

      {open ? (
        <div className="rounded-md border border-slate-200 bg-slate-50 p-2">
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search tags..."
            className="mb-2 w-full rounded-md border border-slate-200 bg-white px-2 py-1.5 text-xs outline-none focus:border-amber-400"
          />
          <div className="max-h-40 space-y-2 overflow-y-auto">
            {grouped.map(({ group, options: groupOptions }) =>
              groupOptions.length ? (
                <div key={group}>
                  <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                    {tagGroupLabels[group]}
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {groupOptions.map((option) => {
                      const active = selectedSet.has(option.label);
                      return (
                        <button
                          key={`${option.group}:${option.label}`}
                          type="button"
                          onClick={() => toggleTag(option.label)}
                          className={`rounded-full border px-2 py-0.5 text-xs transition ${
                            active
                              ? tagGroupChipClass[option.group]
                              : "border-slate-200 bg-white text-slate-600 hover:border-slate-300"
                          }`}
                        >
                          {option.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ) : null,
            )}
            {!visibleOptions.length ? (
              <p className="text-xs text-slate-500">No tags match your search.</p>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function TagList({ tags }: { tags: string[] }) {
  if (!tags.length) return null;
  return (
    <div className="flex flex-wrap gap-1.5">
      {tags.map((tag) => (
        <span
          key={tag}
          className="rounded-full border border-slate-200 bg-white px-2 py-0.5 text-xs text-slate-600"
        >
          {tag}
        </span>
      ))}
    </div>
  );
}

function Cell({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <td className={`px-2 py-1.5 text-sm text-slate-700 ${className}`}>
      {children}
    </td>
  );
}

export function SortableHeader({
  label,
  sortKey,
  activeKey,
  direction,
  onSort,
  className = "",
}: {
  label: string;
  sortKey: SortKey;
  activeKey: SortKey;
  direction: SortDirection;
  onSort: (key: SortKey) => void;
  className?: string;
}) {
  const active = sortKey === activeKey;
  const indicator = active ? (direction === "asc" ? " ▲" : " ▼") : "";

  return (
    <th className={`px-2 py-2 ${className}`}>
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        className={`inline-flex items-center gap-0.5 uppercase tracking-wide transition hover:text-slate-800 ${
          active ? "font-semibold text-slate-800" : "font-medium text-slate-500"
        }`}
      >
        {label}
        {indicator ? (
          <span className="text-[10px] text-amber-700">{indicator}</span>
        ) : null}
      </button>
    </th>
  );
}

export function GameListRow({
  game,
  selected,
  onSelect,
}: {
  game: BoardGameDoc;
  selected: boolean;
  onSelect: () => void;
}) {
  const typeLabel =
    game.itemType === "expansion"
      ? "exp"
      : game.itemType === "standalone"
        ? "base"
        : "—";

  return (
    <tr
      onClick={onSelect}
      className={`cursor-pointer border-b border-slate-100 transition hover:bg-amber-50/60 ${
        selected ? "bg-amber-50" : "bg-white"
      }`}
    >
      <Cell className="max-w-[280px] truncate font-medium text-slate-900">
        {game.name}
      </Cell>
      <Cell className="tabular-nums text-slate-500">
        {game.yearPublished ?? "—"}
      </Cell>
      <Cell className="tabular-nums">{formatPlayerCount(game)}</Cell>
      <Cell className="tabular-nums">{formatPlayTime(game)}</Cell>
      <Cell className="tabular-nums">{formatRating(game.bggWeight)}</Cell>
      <Cell className="max-w-[120px] truncate text-xs text-slate-500">
        {game.categories?.[0] ?? "—"}
      </Cell>
      <Cell className="max-w-[120px] truncate text-xs text-slate-500">
        {game.mechanics?.[0] ?? "—"}
      </Cell>
      <Cell className="max-w-[120px] truncate text-xs text-slate-500">
        {game.designers?.[0] ?? "—"}
      </Cell>
      <Cell className="tabular-nums font-medium text-amber-800">
        {formatRating(game.rating)}
      </Cell>
      <Cell className="tabular-nums">{formatBggRank(game.bggRank)}</Cell>
      <Cell className="text-xs uppercase tracking-wide text-slate-500">
        {typeLabel}
      </Cell>
    </tr>
  );
}

export function GameDetail({
  game,
  onClose,
  onUpdateComment,
  compact = false,
}: {
  game: BoardGameDoc;
  onClose?: () => void;
  onUpdateComment: (comment: string) => void;
  compact?: boolean;
}) {
  const tags = gameTags(game);

  return (
    <div
      className={`flex min-h-0 flex-col overflow-hidden border border-slate-200 bg-white ${
        compact ? "h-full rounded-lg" : "h-full rounded-xl shadow-sm"
      }`}
    >
      <div className="flex items-start justify-between gap-3 border-b border-slate-100 px-4 py-2.5">
        <div>
          <h2 className="text-base font-semibold text-slate-900">{game.name}</h2>
          <a
            href={bggGameUrl(game.bggId)}
            target="_blank"
            rel="noreferrer"
            className="text-xs text-amber-700 hover:underline"
          >
            View on BoardGameGeek
          </a>
        </div>
        {onClose ? (
          <button
            type="button"
            onClick={onClose}
            className="rounded-md px-2 py-1 text-sm text-slate-500 hover:bg-slate-100"
          >
            Close
          </button>
        ) : null}
      </div>

      <div className={`flex-1 space-y-4 overflow-y-auto p-4 ${compact ? "" : ""}`}>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <div className="rounded-lg bg-slate-50 p-3">
              <div className="text-xs uppercase tracking-wide text-slate-500">
                Players
              </div>
              <div className="text-lg font-semibold text-slate-900">
                {formatPlayerCount(game)}
              </div>
              {game.bestPlayers ? (
                <div className="text-xs text-slate-500">
                  Best: {game.bestPlayers}
                </div>
              ) : null}
            </div>
            <div className="rounded-lg bg-slate-50 p-3">
              <div className="text-xs uppercase tracking-wide text-slate-500">
                Play Time
              </div>
              <div className="text-lg font-semibold text-slate-900">
                {formatPlayTime(game)}
              </div>
            </div>
            <div className="rounded-lg bg-slate-50 p-3">
              <div className="text-xs uppercase tracking-wide text-slate-500">
                BGG Rating
              </div>
              <div className="text-lg font-semibold text-slate-900">
                {formatRating(game.bggRating)}
              </div>
              {game.bggRank ? (
                <div className="text-xs text-slate-500">Rank #{game.bggRank}</div>
              ) : null}
            </div>
            <div className="rounded-lg bg-slate-50 p-3">
              <div className="text-xs uppercase tracking-wide text-slate-500">
                Weight
              </div>
              <div className="text-lg font-semibold text-slate-900">
                {formatRating(game.bggWeight)}
              </div>
              {game.rating != null && game.rating > 0 ? (
                <div className="text-xs text-slate-500">
                  Your rating: {formatRating(game.rating)}
                </div>
              ) : null}
            </div>
          </div>

          <TagList tags={tags} />

          {game.mechanics?.length ? (
            <section>
              <h3 className="mb-2 text-sm font-semibold text-slate-900">
                Mechanics
              </h3>
              <TagList tags={game.mechanics} />
            </section>
          ) : null}

          {game.categories?.length ? (
            <section>
              <h3 className="mb-2 text-sm font-semibold text-slate-900">
                Categories
              </h3>
              <TagList tags={game.categories} />
            </section>
          ) : null}

          {!game.mechanics?.length && !game.categories?.length ? (
            <p className="text-sm text-slate-500">
              Use Kaggle metadata for mechanics and categories, or BGG enrich
              for descriptions and cover art. CSV import already includes
              player counts, weight, ratings, and your notes.
            </p>
          ) : null}

          {game.designers?.length ? (
            <section>
              <h3 className="mb-2 text-sm font-semibold text-slate-900">
                Designers
              </h3>
              <p className="text-sm text-slate-700">
                {game.designers.join(", ")}
              </p>
            </section>
          ) : null}

          {game.description ? (
            <section>
              <h3 className="mb-2 text-sm font-semibold text-slate-900">
                Description
              </h3>
              <p className="text-sm leading-6 text-slate-700">
                {game.description}
              </p>
            </section>
          ) : null}

          <section>
            <h3 className="mb-2 text-sm font-semibold text-slate-900">
              My Notes
            </h3>
            <textarea
              value={game.comment ?? ""}
              onChange={(event) => onUpdateComment(event.target.value)}
              placeholder="Add notes about this game..."
              className="min-h-24 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-800 outline-none focus:border-amber-400"
            />
          </section>

        <div className="grid gap-2 text-sm text-slate-600 sm:grid-cols-2">
          {game.numPlays != null ? <div>Plays: {game.numPlays}</div> : null}
          {game.invLocation ? <div>Location: {game.invLocation}</div> : null}
          {game.acquiredFrom ? (
            <div>Acquired from: {game.acquiredFrom}</div>
          ) : null}
          {game.languageDependence ? (
            <div>Language: {game.languageDependence}</div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
