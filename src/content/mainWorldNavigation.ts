const MAIN_WORLD_EVENT = "scenario-recorder:navigation";

export {};

declare global {
  interface Window {
    __SCENARIO_RECORDER_NAVIGATION_HOOKED__?: boolean;
  }
}

if (!window.__SCENARIO_RECORDER_NAVIGATION_HOOKED__) {
  window.__SCENARIO_RECORDER_NAVIGATION_HOOKED__ = true;
  let previousUrl = location.href;

  const emit = () => {
    const toUrl = location.href;
    if (toUrl === previousUrl) {
      return;
    }

    const fromUrl = previousUrl;
    previousUrl = toUrl;
    window.dispatchEvent(new CustomEvent(MAIN_WORLD_EVENT, { detail: { fromUrl, toUrl } }));
  };

  const originalPushState = history.pushState;
  history.pushState = function pushState(...args) {
    const result = originalPushState.apply(this, args);
    queueMicrotask(emit);
    return result;
  };

  const originalReplaceState = history.replaceState;
  history.replaceState = function replaceState(...args) {
    const result = originalReplaceState.apply(this, args);
    queueMicrotask(emit);
    return result;
  };

  window.addEventListener("popstate", emit);
  window.addEventListener("hashchange", emit);
}
