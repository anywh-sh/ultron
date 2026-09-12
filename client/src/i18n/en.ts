import type { Dictionary } from "./dictionary";

export const en: Dictionary = {
  common: {
    add: "Add",
    back: "Back",
    cancel: "Cancel",
    close: "Close",
    copy: "Copy",
    delete: "Delete",
    download: "Download",
    edit: "Edit",
    loading: "Loading…",
    remove: "Remove",
    rename: "Rename",
    retry: "Try again",
    save: "Save",
    search: "Search",
    send: "Send",
    stop: "Stop",
  },
  settings: {
    language: {
      title: "Language",
      description: "Applies to the whole app, on this device only.",
    },
  },
  errors: {
    setCwdTitle: "Couldn't switch folder",
    setCwd: {
      locked: "This conversation already has history, so its folder is fixed.",
      not_found: "That folder doesn't exist.",
      permission_denied: "No permission to open that folder.",
      not_a_directory: "That path is a file, not a folder.",
      invalid_path: "That path isn't valid — use an absolute path.",
    },
    editMessage: {
      not_found: "Message not found — the history may have changed.",
      truncate_failed: "That message couldn't be edited.",
      relay_restarting: "The relay is restarting. Try again in a moment.",
    },
  },
};
