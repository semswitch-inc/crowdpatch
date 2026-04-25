"use client";

import type { ConnectedApp } from "@/types/connected-app";

interface ConnectedAppCardProps {
  app: ConnectedApp;
  onEdit?: () => void;
}

export default function ConnectedAppCard({
  app,
  onEdit,
}: ConnectedAppCardProps) {
  return (
    <article className="flex w-full flex-col gap-3 rounded-xl border border-lime-500/30 bg-lime-500/[0.06] px-5 py-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <span className="text-xs font-600 uppercase tracking-[0.12em] text-lime-200">
            App connected
          </span>
          <h3 className="text-base font-600 text-ink-50">{app.display_name}</h3>
          <a
            href={app.github_repo_url}
            target="_blank"
            rel="noopener noreferrer"
            className="break-all font-mono text-xs text-ink-300 underline-offset-2 hover:text-orange-300 hover:underline"
          >
            {app.github_repo_url}
          </a>
        </div>
        <span className="shrink-0 rounded-full border border-violet-500/40 bg-violet-500/[0.10] px-2 py-0.5 font-mono text-xs font-600 text-violet-100">
          {app.default_branch}
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <span className="font-mono text-xs text-ink-400">{app.id}</span>
        {onEdit && (
          <button
            type="button"
            onClick={onEdit}
            className="text-xs text-orange-400 underline-offset-2 hover:underline"
          >
            Edit and connect a different app
          </button>
        )}
      </div>
    </article>
  );
}
