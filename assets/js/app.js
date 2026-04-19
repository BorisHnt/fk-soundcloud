import { loadLibrary } from "./library.js";
import { AudioPlayer } from "./player.js";
import { copyText, debounce, escapeHtml, getQueryParams, showToast, shareLink } from "./utils.js";
import { renderView } from "./views.js";

const ROUTE_VIEW_MAP = new Map([
  ["", "home"],
  ["index.html", "home"],
  ["artists.html", "artists"],
  ["artist.html", "artist"],
  ["release.html", "release"],
  ["playlists.html", "playlists"],
  ["playlist.html", "playlist"],
]);

const APP_STATE = {
  currentViewCleanup: null,
  hasShownGenerationWarning: false,
  library: null,
  player: null,
};

init().catch((error) => {
  console.error(error);
  document.body.innerHTML = `
    <main class="fatal-error">
      <section class="empty-state card">
        <span class="eyebrow">Startup error</span>
        <h1>Unable to start the frontend.</h1>
        <p>${escapeHtml(error.message || "Unknown error")}</p>
      </section>
    </main>
  `;
});

async function init() {
  renderShell();
  APP_STATE.library = await loadLibrary();
  APP_STATE.player = new AudioPlayer({
    root: document.querySelector("#player-root"),
    library: APP_STATE.library,
    onToast: (message) => showToast(message),
  });

  bindGlobalActions();
  bindSearch();
  bindRouter();
  renderPage({ scroll: false });
}

function renderShell() {
  document.body.innerHTML = `
    <div class="site-shell">
      <header class="site-header">
        <nav class="site-nav" aria-label="Primary navigation">
          <a href="index.html" data-nav-link="home">Home</a>
          <a href="artists.html" data-nav-link="artists">Artists</a>
          <a href="playlists.html" data-nav-link="playlists">Playlists</a>
        </nav>

        <div class="header-actions">
          <button type="button" class="button button--ghost button--small" data-open-search>Search</button>
        </div>
      </header>

      <aside class="search-panel" data-search-panel hidden>
        <div class="search-panel__inner card">
          <div class="search-panel__header">
            <div>
              <h2>Search</h2>
            </div>
            <button type="button" class="icon-button" data-close-search aria-label="Close search">
              <span>&times;</span>
            </button>
          </div>
          <label class="search-input">
            <input type="search" placeholder="Track, artist, genre, release..." data-search-input>
          </label>
          <div class="search-results" data-search-results></div>
        </div>
      </aside>

      <main id="page-content" class="page-content"></main>
      <div id="toast-stack" class="toast-stack" aria-live="polite" aria-atomic="true"></div>
      <div id="player-root"></div>
    </div>
  `;
}

function bindGlobalActions() {
  document.addEventListener("click", async (event) => {
    const library = APP_STATE.library;
    const player = APP_STATE.player;
    const trackButton = event.target.closest("[data-play-track-id]");
    const releaseButton = event.target.closest("[data-play-release-id]");
    const artistButton = event.target.closest("[data-play-artist-slug]");
    const playlistButton = event.target.closest("[data-play-playlist-id]");
    const copyButton = event.target.closest("[data-copy-path]");
    const shareButton = event.target.closest("[data-share-path]");
    const openSearch = event.target.closest("[data-open-search]");
    const closeSearch = event.target.closest("[data-close-search]");

    if (trackButton) {
      const trackId = trackButton.dataset.playTrackId;
      const queue = resolveQueue({
        library,
        contextType: trackButton.dataset.contextType,
        contextId: trackButton.dataset.contextId,
        fallbackTrackId: trackId,
      });

      player.playTrack(trackId, { queue, autoplay: true });
      if (trackButton.closest("[data-search-panel]")) {
        toggleSearch(false);
      }
      return;
    }

    if (releaseButton) {
      const release = library.releases.find((item) => item.id === releaseButton.dataset.playReleaseId);
      if (release) {
        player.setQueue(release.trackIds, release.primaryTrackId || release.trackIds[0], { autoplay: true });
      }
      if (releaseButton.closest("[data-search-panel]")) {
        toggleSearch(false);
      }
      return;
    }

    if (artistButton) {
      const artist = library.getArtistBySlug(artistButton.dataset.playArtistSlug);
      if (artist) {
        player.setQueue(artist.trackIds, artist.trackIds[0], { autoplay: true });
      }
      return;
    }

    if (playlistButton) {
      const playlist = library.playlists.find((item) => item.id === playlistButton.dataset.playPlaylistId);
      if (playlist) {
        player.setQueue(playlist.trackIds, playlist.trackIds[0], { autoplay: true });
      }
      return;
    }

    if (copyButton) {
      await copyText(new URL(copyButton.dataset.copyPath.replace(/^\//, ""), window.location.href).toString(), "Lien copie");
      return;
    }

    if (shareButton) {
      await shareLink({
        title: shareButton.dataset.shareTitle || document.title,
        text: shareButton.dataset.shareText || "Listen here",
        path: shareButton.dataset.sharePath,
      });
      return;
    }

    if (openSearch) {
      toggleSearch(true);
      return;
    }

    if (closeSearch) {
      toggleSearch(false);
      return;
    }

    const anchor = event.target.closest("a[href]");
    if (!anchor || !shouldHandleClientNavigation(anchor, event)) {
      return;
    }

    event.preventDefault();
    if (anchor.closest("[data-search-panel]")) {
      toggleSearch(false);
    }
    navigateTo(anchor.href);
  });

  window.addEventListener("fk:player-state", (event) => {
    const { currentTrack, duration, isPlaying } = event.detail;

    document.querySelectorAll(".track-row").forEach((node) => {
      const button = node.querySelector("[data-play-track-id]");
      const isCurrent = button?.dataset.playTrackId === currentTrack?.id;

      node.classList.toggle("is-active", Boolean(isCurrent));
      if (button) {
        button.classList.toggle("is-active", Boolean(isCurrent));
        button.innerHTML = isCurrent && isPlaying ? iconPause() : iconPlay();
      }

      if (isCurrent && duration) {
        const durationNode = node.querySelector(".track-row__info span:last-child");
        if (durationNode) {
          durationNode.textContent = formatDuration(duration);
        }
      }
    });
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "/" && !event.metaKey && !event.ctrlKey) {
      const target = event.target;
      const isTyping = target instanceof HTMLElement && ["INPUT", "TEXTAREA"].includes(target.tagName);

      if (!isTyping) {
        event.preventDefault();
        toggleSearch(true);
      }
    }

    if (event.key === "Escape") {
      toggleSearch(false);
    }
  });
}

function bindSearch() {
  const library = APP_STATE.library;
  const searchInput = document.querySelector("[data-search-input]");
  const searchResults = document.querySelector("[data-search-results]");

  const handleSearch = debounce((value) => {
    const results = library.search(value);
    searchResults.innerHTML = renderSearchResults(results);
  }, 120);

  searchInput?.addEventListener("input", () => handleSearch(searchInput.value));
}

function bindRouter() {
  window.addEventListener("popstate", () => {
    renderPage({ scroll: false });
  });
}

function renderPage({ scroll = true } = {}) {
  const library = APP_STATE.library;
  const player = APP_STATE.player;
  const root = document.querySelector("#page-content");
  const viewName = getCurrentViewName();
  const params = getQueryParams();
  const view = renderView(viewName, { library, params, player });

  APP_STATE.currentViewCleanup?.();
  APP_STATE.currentViewCleanup = null;
  player.disconnectAllInlinePanels();
  document.body.dataset.view = viewName;

  const commitRender = () => {
    root.innerHTML = view.html;
    highlightNav(viewName);
    const cleanup = view.mount?.({ root, library, params, player });
    APP_STATE.currentViewCleanup = typeof cleanup === "function" ? cleanup : null;
    player.broadcastState();

    if (scroll) {
      window.scrollTo(0, 0);
    }
  };

  if (document.startViewTransition && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    document.startViewTransition(() => commitRender());
  } else {
    commitRender();
  }

  if (library.warnings?.length > 0 && !APP_STATE.hasShownGenerationWarning) {
    APP_STATE.hasShownGenerationWarning = true;
    showToast(`${library.warnings.length} invalid folder${library.warnings.length > 1 ? "s" : ""} ignored during catalog generation`);
  }
}

function navigateTo(url, { replace = false, scroll = true } = {}) {
  const next = new URL(url, window.location.href);

  if (!isAppRoute(next)) {
    window.location.href = next.toString();
    return;
  }

  const nextRelativeUrl = `${next.pathname}${next.search}${next.hash}`;
  const currentRelativeUrl = `${window.location.pathname}${window.location.search}${window.location.hash}`;

  if (nextRelativeUrl === currentRelativeUrl) {
    return;
  }

  if (replace) {
    window.history.replaceState({}, "", nextRelativeUrl);
  } else {
    window.history.pushState({}, "", nextRelativeUrl);
  }

  renderPage({ scroll });
}

function shouldHandleClientNavigation(anchor, event) {
  if (
    event.defaultPrevented ||
    event.button !== 0 ||
    anchor.target ||
    anchor.hasAttribute("download") ||
    event.metaKey ||
    event.ctrlKey ||
    event.shiftKey ||
    event.altKey
  ) {
    return false;
  }

  return isAppRoute(new URL(anchor.href, window.location.href));
}

function isAppRoute(url) {
  if (url.origin !== window.location.origin) {
    return false;
  }

  const fileName = getRouteFileName(url.pathname);
  return ROUTE_VIEW_MAP.has(fileName);
}

function getCurrentViewName() {
  return ROUTE_VIEW_MAP.get(getRouteFileName(window.location.pathname)) || "home";
}

function getRouteFileName(pathname) {
  if (pathname.endsWith("/")) {
    return "";
  }

  return pathname.split("/").filter(Boolean).pop() || "";
}

function highlightNav(viewName) {
  const aliases = {
    artist: "artists",
    release: "artists",
    playlist: "playlists",
  };
  const activeView = aliases[viewName] || viewName;

  document.querySelectorAll("[data-nav-link]").forEach((link) => {
    link.classList.toggle("is-active", link.dataset.navLink === activeView);
  });
}

function resolveQueue({ library, contextType, contextId, fallbackTrackId }) {
  if (contextType === "release" && contextId) {
    return library.releases.find((release) => release.id === contextId)?.trackIds || [fallbackTrackId];
  }

  if (contextType === "artist" && contextId) {
    return library.getArtistBySlug(contextId)?.trackIds || [fallbackTrackId];
  }

  if (contextType === "playlist" && contextId) {
    return library.playlists.find((playlist) => playlist.id === contextId)?.trackIds || [fallbackTrackId];
  }

  return library.tracks.map((track) => track.id);
}

function toggleSearch(open) {
  const panel = document.querySelector("[data-search-panel]");
  const input = document.querySelector("[data-search-input]");

  if (!panel) {
    return;
  }

  if (open) {
    panel.removeAttribute("hidden");
    window.requestAnimationFrame(() => panel.classList.add("is-open"));
    input?.focus();
  } else {
    panel.classList.remove("is-open");
    window.setTimeout(() => panel.setAttribute("hidden", ""), 180);
  }
}

function renderSearchResults(results) {
  const sections = [
    createResultBlock("Artists", results.artists.slice(0, 4).map((artist) => `
      <a class="search-result" href="artist.html?slug=${encodeURIComponent(artist.slug)}">
        <strong>${escapeHtml(artist.name)}</strong>
        <span>${artist.releaseCount} releases</span>
      </a>
    `)),
    createResultBlock("Releases", results.releases.slice(0, 5).map((release) => `
      <a class="search-result" href="release.html?artist=${encodeURIComponent(release.artistSlug)}&release=${encodeURIComponent(release.slug)}">
        <strong>${escapeHtml(release.title)}</strong>
        <span>${escapeHtml(release.artist)}</span>
      </a>
    `)),
    createResultBlock("Tracks", results.tracks.slice(0, 6).map((track) => `
      <button type="button" class="search-result search-result--button" data-play-track-id="${escapeHtml(track.id)}" data-context-type="all">
        <strong>${escapeHtml(track.title)}</strong>
        <span>${escapeHtml(track.artist)} / ${escapeHtml(track.genre || track.releaseTitle)}</span>
      </button>
    `)),
  ];

  if (!results.artists.length && !results.releases.length && !results.tracks.length) {
    return `<p class="search-empty">No results.</p>`;
  }

  return sections.join("");
}

function createResultBlock(title, items) {
  if (!items.length) {
    return "";
  }

  return `
    <section class="search-group">
      <h3>${escapeHtml(title)}</h3>
      ${items.join("")}
    </section>
  `;
}

function formatDuration(value) {
  const minutes = Math.floor(value / 60);
  const seconds = Math.floor(value % 60);
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function iconPlay() {
  return `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v13l10-6.5z" fill="currentColor"/></svg>`;
}

function iconPause() {
  return `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 5h4v14H7zm6 0h4v14h-4z" fill="currentColor"/></svg>`;
}
