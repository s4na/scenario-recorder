export type NavigationHandler = (fromUrl: string, toUrl: string) => void;

let installed = false;
const MAIN_WORLD_EVENT = "scenario-recorder:navigation";

export function watchNavigation(onNavigation: NavigationHandler): void {
  if (installed) {
    return;
  }
  installed = true;

  let previousUrl = location.href;
  let lastSignature = "";
  let lastTimestamp = 0;

  const emitNavigation = (fromUrl: string, toUrl: string) => {
    if (fromUrl === toUrl) {
      return;
    }
    previousUrl = toUrl;
    const signature = `${fromUrl}->${toUrl}`;
    const now = Date.now();
    if (signature === lastSignature && now - lastTimestamp < 500) {
      return;
    }

    lastSignature = signature;
    lastTimestamp = now;
    onNavigation(fromUrl, toUrl);
  };

  const notifyIfChanged = (fromUrl = previousUrl, nextUrl = location.href) => {
    if (nextUrl === previousUrl) {
      return;
    }

    emitNavigation(fromUrl, nextUrl);
  };

  window.addEventListener(MAIN_WORLD_EVENT, (event) => {
    const detail = (event as CustomEvent<unknown>).detail as
      | { fromUrl?: unknown; toUrl?: unknown }
      | undefined;
    if (typeof detail?.fromUrl !== "string" || typeof detail.toUrl !== "string") {
      return;
    }
    if (detail.toUrl !== location.href) {
      return;
    }
    emitNavigation(detail.fromUrl, detail.toUrl);
  });

  window.addEventListener("popstate", () => notifyIfChanged());
  window.addEventListener("hashchange", () => notifyIfChanged());
}
