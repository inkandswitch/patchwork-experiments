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
        className="bg-art-placeholder"
        style={{
          background: `linear-gradient(145deg, ${placeholderColor(game.bggId)}, ${placeholderColor(game.bggId + 17)})`,
        }}
      >
        <span className="bg-art-placeholder__initials">{initials || "?"}</span>
        {game.yearPublished ? (
          <span className="bg-art-placeholder__year">
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
      className="bg-art"
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
    <div className="bg-tagpicker">
      <div className="bg-tagpicker__row">
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          className="bg-button"
        >
          {open ? "Hide tags" : "Filter tags"}
          {selected.length ? (
            <span className="bg-button__count">
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
              className="bg-chip"
              data-group={group}
            >
              {tag} ×
            </button>
          );
        })}
      </div>

      {open ? (
        <div className="bg-tagpicker__panel">
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search tags..."
            className="bg-tagpicker__search"
          />
          <div className="bg-tagpicker__groups">
            {grouped.map(({ group, options: groupOptions }) =>
              groupOptions.length ? (
                <div key={group}>
                  <div className="bg-tagpicker__grouplabel">
                    {tagGroupLabels[group]}
                  </div>
                  <div className="bg-tagpicker__chips">
                    {groupOptions.map((option) => {
                      const active = selectedSet.has(option.label);
                      return (
                        <button
                          key={`${option.group}:${option.label}`}
                          type="button"
                          onClick={() => toggleTag(option.label)}
                          className="bg-chip"
                          data-group={active ? option.group : undefined}
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
              <p className="bg-tagpicker__none">No tags match your search.</p>
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
    <div className="bg-taglist">
      {tags.map((tag) => (
        <span
          key={tag}
          className="bg-chip"
        >
          {tag}
        </span>
      ))}
    </div>
  );
}

function Cell({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <td className={`bg-cell ${className}`}>
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
    <th className={`bg-th ${className}`}>
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        className="bg-sort"
        data-active={active || undefined}
      >
        {label}
        {indicator ? (
          <span className="bg-sort__arrow">{indicator}</span>
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
      className="bg-row"
      data-selected={selected || undefined}
    >
      <Cell className="bg-cell--name">
        {game.name}
      </Cell>
      <Cell className="bg-cell--num bg-cell--muted">
        {game.yearPublished ?? "—"}
      </Cell>
      <Cell className="bg-cell--num">{formatPlayerCount(game)}</Cell>
      <Cell className="bg-cell--num">{formatPlayTime(game)}</Cell>
      <Cell className="bg-cell--num">{formatRating(game.bggWeight)}</Cell>
      <Cell className="bg-cell--tag">
        {game.categories?.[0] ?? "—"}
      </Cell>
      <Cell className="bg-cell--tag">
        {game.mechanics?.[0] ?? "—"}
      </Cell>
      <Cell className="bg-cell--tag">
        {game.designers?.[0] ?? "—"}
      </Cell>
      <Cell className="bg-cell--num bg-cell--rating">
        {formatRating(game.rating)}
      </Cell>
      <Cell className="bg-cell--num">{formatBggRank(game.bggRank)}</Cell>
      <Cell className="bg-cell--type">
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
      className="bg-detail"
      data-compact={compact || undefined}
    >
      <div className="bg-detail__head">
        <div>
          <h2 className="bg-detail__title">{game.name}</h2>
          <a
            href={bggGameUrl(game.bggId)}
            target="_blank"
            rel="noreferrer"
            className="bg-detail__link"
          >
            View on BoardGameGeek
          </a>
        </div>
        {onClose ? (
          <button
            type="button"
            onClick={onClose}
            className="bg-button bg-button--quiet"
          >
            Close
          </button>
        ) : null}
      </div>

      <div className="bg-detail__body">
          <div className="bg-stat-grid">
            <div className="bg-stat">
              <div className="bg-stat__label">
                Players
              </div>
              <div className="bg-stat__value">
                {formatPlayerCount(game)}
              </div>
              {game.bestPlayers ? (
                <div className="bg-stat__note">
                  Best: {game.bestPlayers}
                </div>
              ) : null}
            </div>
            <div className="bg-stat">
              <div className="bg-stat__label">
                Play Time
              </div>
              <div className="bg-stat__value">
                {formatPlayTime(game)}
              </div>
            </div>
            <div className="bg-stat">
              <div className="bg-stat__label">
                BGG Rating
              </div>
              <div className="bg-stat__value">
                {formatRating(game.bggRating)}
              </div>
              {game.bggRank ? (
                <div className="bg-stat__note">Rank #{game.bggRank}</div>
              ) : null}
            </div>
            <div className="bg-stat">
              <div className="bg-stat__label">
                Weight
              </div>
              <div className="bg-stat__value">
                {formatRating(game.bggWeight)}
              </div>
              {game.rating != null && game.rating > 0 ? (
                <div className="bg-stat__note">
                  Your rating: {formatRating(game.rating)}
                </div>
              ) : null}
            </div>
          </div>

          <TagList tags={tags} />

          {game.mechanics?.length ? (
            <section>
              <h3 className="bg-detail__section">
                Mechanics
              </h3>
              <TagList tags={game.mechanics} />
            </section>
          ) : null}

          {game.categories?.length ? (
            <section>
              <h3 className="bg-detail__section">
                Categories
              </h3>
              <TagList tags={game.categories} />
            </section>
          ) : null}

          {!game.mechanics?.length && !game.categories?.length ? (
            <p className="bg-detail__hint">
              Use Kaggle metadata for mechanics and categories, or BGG enrich
              for descriptions and cover art. CSV import already includes
              player counts, weight, ratings, and your notes.
            </p>
          ) : null}

          {game.designers?.length ? (
            <section>
              <h3 className="bg-detail__section">
                Designers
              </h3>
              <p className="bg-detail__text">
                {game.designers.join(", ")}
              </p>
            </section>
          ) : null}

          {game.description ? (
            <section>
              <h3 className="bg-detail__section">
                Description
              </h3>
              <p className="bg-detail__text">
                {game.description}
              </p>
            </section>
          ) : null}

          <section>
            <h3 className="bg-detail__section">
              My Notes
            </h3>
            <textarea
              value={game.comment ?? ""}
              onChange={(event) => onUpdateComment(event.target.value)}
              placeholder="Add notes about this game..."
              className="bg-notes"
            />
          </section>

        <div className="bg-detail__facts">
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
