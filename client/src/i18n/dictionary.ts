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
  };
  settings: {
    language: {
      title: string;
      description: string;
    };
  };
}
