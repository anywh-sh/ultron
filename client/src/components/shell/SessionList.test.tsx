import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ComponentProps } from "react";
import { en } from "@/i18n/en";
import type { Profile } from "@/lib/profiles";
import type { MergedSession } from "@/lib/sessionGrouping";
import { SessionList } from "./SessionList";

const copy = en.shell.sidebar;

const profiles: Profile[] = [
  { id: "work", label: "Work", host: "127.0.0.1", relayPort: 8765 },
  { id: "home", label: "Home", host: "127.0.0.1", relayPort: 8766 },
];

const DAY = 24 * 60 * 60 * 1000;

function session(overrides: Partial<MergedSession> & { id: string }): MergedSession {
  return { title: overrides.id, lastActiveAt: Date.now(), profileId: "work", ...overrides };
}

function noop() {}

function renderList(props: Partial<ComponentProps<typeof SessionList>> = {}) {
  return render(
    <SessionList
      sessions={[]}
      profiles={profiles}
      selectedProfileCount={profiles.length}
      loading={false}
      error={false}
      onRetry={noop}
      selected={null}
      running={new Set()}
      backgroundJobSessions={new Set()}
      onSelect={noop}
      onRename={noop}
      onDelete={noop}
      onClearFilter={noop}
      {...props}
    />,
  );
}

afterEach(() => {
  cleanup();
});

describe("SessionList", () => {
  it("shows the skeleton while the first sync is loading", () => {
    renderList({ loading: true });
    expect(screen.getByRole("status")).toBeInTheDocument();
    expect(screen.queryByText(copy.emptyTitle)).not.toBeInTheDocument();
  });

  it("keeps showing cached rows while a later sync is in flight", () => {
    // The list is cached per profile and survives a profile switch, so a
    // refresh must not replace a perfectly usable list with pulsing bars.
    renderList({ loading: true, sessions: [session({ id: "s1", title: "Cached session" })] });
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(screen.getByText("Cached session")).toBeInTheDocument();
  });

  it("shows an error message with a retry button once loading finishes", async () => {
    const onRetry = vi.fn();
    renderList({ error: true, onRetry });
    expect(screen.getByText(copy.loadFailed)).toBeInTheDocument();

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: en.common.retry }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("shows the empty state when nothing is filtered out", () => {
    renderList();
    expect(screen.getByText(copy.emptyTitle)).toBeInTheDocument();
    expect(screen.queryByText(copy.noMatches)).not.toBeInTheDocument();
  });

  it("distinguishes an empty list from one emptied by the filter", async () => {
    // Conflating the two is how someone concludes their history is gone
    // when they have narrowed the view to a profile with nothing in it.
    const onClearFilter = vi.fn();
    renderList({ selectedProfileCount: 1, onClearFilter });
    expect(screen.getByText(copy.noMatches)).toBeInTheDocument();
    expect(screen.queryByText(copy.emptyTitle)).not.toBeInTheDocument();

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: copy.allProfiles }));
    expect(onClearFilter).toHaveBeenCalledTimes(1);
  });

  it("groups sessions by recency, newest group first, with a count per heading", () => {
    renderList({
      sessions: [
        session({ id: "s1", title: "Today one" }),
        session({ id: "s2", title: "Today two" }),
        session({ id: "s3", title: "Long ago", lastActiveAt: Date.now() - 90 * DAY }),
      ],
    });

    expect(screen.getByText(copy.groups.today).parentElement).toHaveTextContent(`${copy.groups.today} 2`);
    expect(screen.getByText(copy.groups.older).parentElement).toHaveTextContent(`${copy.groups.older} 1`);
    // A bucket with nothing in it never gets a heading of its own.
    expect(screen.queryByText(copy.groups.yesterday)).not.toBeInTheDocument();
  });

  it("names each row's profile only when more than one is in view", () => {
    const sessions = [session({ id: "s1", title: "Work item", profileId: "work" })];

    const single = renderList({ sessions, selectedProfileCount: 1 });
    expect(screen.queryByText("Work")).not.toBeInTheDocument();
    single.unmount();

    renderList({ sessions, selectedProfileCount: 2 });
    // With every profile merged into one list, the row would otherwise not
    // say which machine it belongs to.
    expect(screen.getByText("Work")).toBeInTheDocument();
  });

  it("hands the whole session back on select, so the caller knows its profile", async () => {
    const onSelect = vi.fn();
    const target = session({ id: "s1", title: "From home", profileId: "home" });
    renderList({ sessions: [target], selectedProfileCount: 2, onSelect });

    const user = userEvent.setup();
    await user.click(screen.getByText("From home"));
    // The id alone is not enough any more: opening this tab needs the
    // profile the row came from, which may not be the active one.
    expect(onSelect).toHaveBeenCalledWith(target);
  });

  it("shows one spinner for a session that is both running and has a background job", () => {
    renderList({
      sessions: [session({ id: "s1", title: "Busy" })],
      running: new Set(["s1"]),
      backgroundJobSessions: new Set(["s1"]),
    });
    // Two infinite spinners stacked on one row is exactly the kind of
    // always-animating chrome the redesign caps at one per row.
    expect(screen.getAllByLabelText(copy.agentWorking)).toHaveLength(1);
    expect(screen.queryByLabelText(copy.backgroundJob)).not.toBeInTheDocument();
  });

  it("renders a rename control per row, labelled with the session it renames", async () => {
    const onRename = vi.fn();
    const target = session({ id: "s1", title: "Rename me" });
    renderList({ sessions: [target], onRename });

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: copy.renameSession.replace("{title}", "Rename me") }));
    expect(onRename).toHaveBeenCalledWith(target);
  });

  it("renders both rows when two profiles hand out the same session id", () => {
    renderList({
      selectedProfileCount: 2,
      sessions: [
        session({ id: "shared", title: "Work copy", profileId: "work" }),
        session({ id: "shared", title: "Home copy", profileId: "home" }),
      ],
    });
    // Session ids are only unique within one relay — two profiles can hand
    // out the same one, and keying rows on the id alone would drop one.
    expect(screen.getByText("Work copy")).toBeInTheDocument();
    expect(screen.getByText("Home copy")).toBeInTheDocument();
  });
});
