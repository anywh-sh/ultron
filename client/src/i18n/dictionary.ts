/**
 * Every string the interface can render, as one shape both languages have to
 * satisfy. A missing key is a type error, not a string that silently falls
 * back to another language at runtime — which is the entire reason this is a
 * typed object instead of a bag of lookup keys.
 *
 * It starts small on purpose: the redesign is rewriting most screens, and
 * each phase moves its own copy in here as it rewrites it, rather than
 * translating text that is about to be deleted. `common` is the slice that
 * survives any redesign — the verbs on buttons.
 */
import type { EditMessageErrorCode, SetCwdErrorCode } from "@/lib/relay-types";

export interface Dictionary {
  common: {
    add: string;
    back: string;
    cancel: string;
    close: string;
    copy: string;
    delete: string;
    download: string;
    edit: string;
    loading: string;
    remove: string;
    rename: string;
    retry: string;
    save: string;
    search: string;
    send: string;
    stop: string;
    /** Fallback name for a session the relay hasn't titled yet (`title` is
     * still `null`). Lives in `common` rather than under a surface because
     * it is the session's own identity, and five surfaces render it: the
     * tab, its tooltip and close label, the title bar, the idle screen and
     * the turn-complete notification. Distinct from the default title the
     * relay *persists* (`titleGenerator.ts`), which stays untranslated: that
     * one is written into the session record, so translating it would leave
     * every already-stored session named in the old language while new ones
     * arrived in the new one. */
    untitledSession: string;
  };
  settings: {
    language: {
      title: string;
      description: string;
    };
  };
  /**
   * Failures the relay reports as a code rather than as a sentence. Typed as
   * a record over the wire contract's own unions on purpose: adding an error
   * code on the relay side and forgetting the copy is then a compile error in
   * both languages, instead of a raw enum like `not_found` reaching the user
   * — which is exactly what used to happen to four of the five folder-picker
   * failures.
   */
  errors: {
    setCwdTitle: string;
    setCwd: Record<SetCwdErrorCode, string>;
    editMessage: Record<EditMessageErrorCode, string>;
  };
  /** The conversation itself — the tab strip down to the message log.
   * Same grouping rule as `shell` below: by the surface the string appears
   * on, not by the component that renders it. */
  chat: {
    tabs: {
      newTab: string;
      close: string;
      agentWorking: string;
      sessionDone: string;
    };
    message: {
      copy: string;
      copied: string;
      copyResponse: string;
      edit: string;
      editUnavailable: string;
      editWithAttachment: string;
    };
  };
  /** The window frame and the session list — everything outside a
   * conversation. Grouped by the surface a string appears on rather than by
   * the component that renders it, so moving a control between surfaces
   * (the working directory, which went from the composer row to the title
   * bar) doesn't drag its key along with it. */
  shell: {
    titleBar: {
      menu: string;
      settings: string;
      back: string;
      forward: string;
      collapseSidebar: string;
      expandSidebar: string;
      openSidebar: string;
      searchSessions: string;
      minimize: string;
      maximize: string;
      restore: string;
      close: string;
      reconnecting: string;
    };
    sidebar: {
      label: string;
      newConversation: string;
      filterByProfile: string;
      filterHeading: string;
      allProfiles: string;
      loadingSessions: string;
      loadFailed: string;
      emptyTitle: string;
      emptyBody: string;
      noMatches: string;
      noMatchesHint: string;
      /** `{time}` — a relative moment ("2 hr. ago"). */
      syncedAt: string;
      neverSynced: string;
      renameSession: string;
      agentWorking: string;
      backgroundJob: string;
      groups: {
        today: string;
        yesterday: string;
        week: string;
        older: string;
      };
    };
    profiles: {
      heading: string;
      activeProfile: string;
      addRemoteMachine: string;
      addProfile: string;
      badgeLocal: string;
      badgeRemote: string;
      badgeRevoked: string;
    };
    revoked: {
      eyebrow: string;
      /** `{profile}` — the profile's label, rendered as its own element. */
      body: string;
      removeProfile: string;
      dismiss: string;
      /** `{profile}` — the profile's label. */
      confirmTitle: string;
      confirmBody: string;
      lastProfile: string;
    };
    /** The folder a conversation runs in. Lives in the title bar since the
     * shell redesign, but it is still per-conversation state. */
    workingDirectory: {
      chooseFolder: string;
      connecting: string;
      heading: string;
      copyPath: string;
      copyFailed: string;
      recent: string;
      noRecent: string;
      browse: string;
    };
    idle: {
      heading: string;
      subtitle: string;
    };
    search: {
      title: string;
      description: string;
      placeholder: string;
      noResults: string;
    };
  };
}
