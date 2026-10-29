import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ApiError, api } from "../api";
import { dueLabel, isOverdue } from "../lib";
import { Avatar, EmptyState, PriorityBadge, Spinner } from "../ui";
import type { SearchResults, WorkspaceDetail } from "../types";

export function SearchPage({ workspace }: { workspace: WorkspaceDetail }) {
  const [params] = useSearchParams();
  const query = (params.get("q") ?? "").trim();
  const [results, setResults] = useState<SearchResults | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (query.length < 2) {
      setResults({ tasks: [], projects: [], tags: [] });
      return;
    }

    let cancelled = false;
    setResults(null);
    setError(null);

    api.workspaces
      .search(workspace.id, query)
      .then((data) => {
        if (!cancelled) setResults(data);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof ApiError ? err.message : "Search failed");
      });

    return () => {
      cancelled = true;
    };
  }, [workspace.id, query]);

  const total = results ? results.tasks.length + results.projects.length + results.tags.length : 0;

  return (
    <div className="page">
      <header className="page__head">
        <div>
          <h1>Search</h1>
          <p className="page__sub">
            {query.length < 2
              ? "Type at least two characters in the search box above."
              : `Results for “${query}” across ${workspace.name}.`}
          </p>
        </div>
      </header>

      {error ? <EmptyState title="Search unavailable" body={error} /> : null}
      {!results && !error ? <Spinner label="Searching…" /> : null}

      {results && query.length >= 2 && total === 0 ? (
        <EmptyState
          title="No matches"
          body="Try a task key like WEB-3, part of a title, a comment, a project name or a tag."
        />
      ) : null}

      {results && results.tasks.length > 0 ? (
        <section className="card">
          <header className="card__head">
            <h2>Tasks</h2>
            <span className="card__hint">{results.tasks.length} found</span>
          </header>
          <ul className="task-rows">
            {results.tasks.map((task) => (
              <li key={task.id}>
                <Link to={`/p/${task.project.id}?task=${task.id}`} className="task-rows__link">
                  <span className="mono" style={{ color: task.project.color }}>
                    {task.project.key}-{task.number}
                  </span>
                  <span className="task-rows__title">{task.title}</span>
                  <span className="task-rows__project">{task.project.name}</span>
                  <PriorityBadge priority={task.priority} />
                  <span className={`due ${isOverdue(task.dueDate, task.status.category) ? "due--late" : ""}`}>
                    {dueLabel(task.dueDate) ?? "No date"}
                  </span>
                  {task.assignee ? <Avatar user={task.assignee} size={24} /> : <span className="unassigned">—</span>}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {results && results.projects.length > 0 ? (
        <section className="card">
          <header className="card__head">
            <h2>Projects</h2>
          </header>
          <ul className="search-links">
            {results.projects.map((project) => (
              <li key={project.id}>
                <Link to={`/p/${project.id}`} className="search-link">
                  <span className="dot" style={{ background: project.color }} />
                  <strong>{project.name}</strong>
                  <span className="mono">{project.key}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {results && results.tags.length > 0 ? (
        <section className="card">
          <header className="card__head">
            <h2>Tags</h2>
          </header>
          <div className="chip-row">
            {results.tags.map((tag) => (
              <span
                key={tag.id}
                className="chip"
                style={{ borderColor: `${tag.color}66`, background: `${tag.color}1a` }}
              >
                <span className="dot" style={{ background: tag.color }} />
                {tag.name}
                {typeof tag._count?.tasks === "number" ? (
                  <span className="hint">{tag._count.tasks}</span>
                ) : null}
              </span>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
