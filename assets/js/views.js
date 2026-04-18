import {
  createArtworkMarkup,
  escapeHtml,
  formatDate,
  formatTime,
  pluralize,
  resolveArtistPath,
  resolvePlaylistPath,
  resolveReleasePath,
  setMeta,
  sortByDateDesc,
} from "./utils.js";

export function renderView(viewName, context) {
  const views = {
    home: renderHome,
    artists: renderArtists,
    artist: renderArtist,
    release: renderRelease,
    playlists: renderPlaylists,
    playlist: renderPlaylist,
  };

  const renderer = views[viewName] || renderHome;
  return renderer(context);
}

function renderHome({ library }) {
  const latestReleases = sortByDateDesc(library.releases).slice(0, 4);
  const featuredTracks = sortByDateDesc(library.tracks).slice(0, 6);
  const featuredArtists = library.artists.slice(0, 6);
  const heroRelease = latestReleases[0];
  const allTracks = library.playlists.find((playlist) => playlist.type === "all-tracks");
  const latestPlaylist = library.playlists.find((playlist) => playlist.type === "latest-releases");

  setMeta({
    title: "Home",
    description: "Dark, minimal personal music platform for listening to releases, artists and playlists.",
    image: heroRelease?.coverPath || latestPlaylist?.coverPath || null,
  });

  return {
    html: `
      <section class="hero">
        <div class="hero__copy">
          <span class="eyebrow">Personal Audio Platform</span>
          <h1>Own the stream, keep the music close.</h1>
          <p>A minimal dark interface for listening to every release in one place, without the noise of external platforms.</p>
          <div class="hero__actions">
            <button type="button" class="button button--primary" data-play-playlist-id="${escapeHtml(allTracks?.id || "")}">Play all tracks</button>
            <a class="button button--ghost" href="playlists.html">Browse playlists</a>
            <button type="button" class="button button--ghost" data-open-search>Quick search</button>
          </div>
          <div class="hero__stats">
            ${createMetricCard(library.stats.artistCount, "artists")}
            ${createMetricCard(library.stats.releaseCount, "releases")}
            ${createMetricCard(library.stats.trackCount, "tracks")}
          </div>
        </div>
        <aside class="hero__highlight card card--hero">
          ${heroRelease ? createReleaseFeature(heroRelease) : createEmptyCard("No release detected yet", "Run the library generator after dropping music into musics/.")}
        </aside>
      </section>

      <section class="section">
        ${createSectionHeader("Latest releases", "Newest uploads surfaced directly from the repo.", "artists.html", "Explore artists")}
        <div class="card-grid card-grid--releases">
          ${latestReleases.map((release) => createReleaseCard(release)).join("")}
        </div>
      </section>

      <section class="section">
        ${createSectionHeader("Featured tracks", "Fast access to the most recent additions.", "playlist.html?type=all", "Open all tracks")}
        <div class="track-list card">
          ${featuredTracks.map((track) => createTrackRow(track, { contextType: "all" })).join("")}
        </div>
      </section>

      <section class="section section--split">
        <div>
          ${createSectionHeader("Artists", "Every artist currently available in the catalog.", "artists.html", "See all")}
          <div class="card-grid card-grid--artists">
            ${featuredArtists.map((artist) => createArtistCard(artist)).join("")}
          </div>
        </div>
        <div>
          ${createSectionHeader("Quick playlists", "Auto-generated listening flows.", "playlists.html", "All playlists")}
          <div class="playlist-stack">
            ${[allTracks, latestPlaylist].filter(Boolean).map((playlist) => createPlaylistCard(playlist, library)).join("")}
          </div>
        </div>
      </section>
    `,
  };
}

function renderArtists({ library }) {
  setMeta({
    title: "Artists",
    description: "Browse every artist, release count and direct artist playlists from the library.",
    image: library.artists[0]?.coverPath || null,
  });

  return {
    html: `
      <section class="page-header">
        <div>
          <span class="eyebrow">Artists</span>
          <h1>Every artist, one clean index.</h1>
          <p>Open a dedicated page, launch the full artist playlist, or jump directly to the latest release.</p>
        </div>
        <div class="toolbar">
          <label class="field">
            <span>Sort</span>
            <select data-artist-sort>
              <option value="name">Name</option>
              <option value="releases">Release count</option>
              <option value="latest">Latest release</option>
            </select>
          </label>
        </div>
      </section>

      <div class="card-grid card-grid--artists" data-artist-grid>
        ${library.artists.map((artist) => createArtistCard(artist)).join("")}
      </div>
    `,
    mount({ root, library: currentLibrary }) {
      const grid = root.querySelector("[data-artist-grid]");
      const sortSelect = root.querySelector("[data-artist-sort]");

      if (!grid || !sortSelect) {
        return;
      }

      const renderArtistsGrid = (mode) => {
        let items = [...currentLibrary.artists];

        if (mode === "releases") {
          items.sort((left, right) => right.releaseCount - left.releaseCount || left.name.localeCompare(right.name, "fr"));
        } else if (mode === "latest") {
          items.sort((left, right) => (right.latestReleaseDate || "").localeCompare(left.latestReleaseDate || ""));
        } else {
          items.sort((left, right) => left.name.localeCompare(right.name, "fr"));
        }

        grid.innerHTML = items.map((artist) => createArtistCard(artist)).join("");
      };

      sortSelect.addEventListener("change", () => renderArtistsGrid(sortSelect.value));
    },
  };
}

function renderArtist({ library, params }) {
  const artist = library.getArtistBySlug(params.get("slug"));

  if (!artist) {
    return renderNotFound({
      title: "Artist not found",
      description: "The requested artist slug does not exist in library.json.",
    });
  }

  const releases = library.getReleasesForArtist(artist);
  const tracks = library.getTracksForArtist(artist);
  const latestRelease = releases[0] || null;

  setMeta({
    title: artist.name,
    description: `${artist.name} - ${pluralize(artist.releaseCount, "release")} and ${pluralize(artist.trackCount, "track")}.`,
    image: artist.coverPath || latestRelease?.coverPath || null,
  });

  return {
    html: `
      <section class="artist-hero">
        <div class="artist-hero__backdrop">${createArtworkMarkup(artist, { sizeClass: "artwork--hero" })}</div>
        <div class="artist-hero__copy">
          <span class="eyebrow">Artist</span>
          <h1>${escapeHtml(artist.name)}</h1>
          <p>${pluralize(artist.releaseCount, "release")} &middot; ${pluralize(artist.trackCount, "track")}</p>
          <div class="tag-row">${artist.genres.length ? artist.genres.map(createTag).join("") : createTag("Independent catalog")}</div>
          <div class="hero__actions">
            <button type="button" class="button button--primary" data-play-artist-slug="${escapeHtml(artist.slug)}">Play artist playlist</button>
            <a class="button button--ghost" href="${escapeHtml(resolvePlaylistPath("artist", artist.slug))}">Open playlist</a>
            <button type="button" class="button button--ghost" data-share-path="${escapeHtml(resolveArtistPath(artist.slug))}" data-share-title="${escapeHtml(artist.name)}" data-share-text="Artist page">Share</button>
          </div>
        </div>
      </section>

      <section class="section">
        ${createSectionHeader("Releases", "Sorted by release date.", null, null)}
        <div class="card-grid card-grid--releases">
          ${releases.map((release) => createReleaseCard(release)).join("")}
        </div>
      </section>

      <section class="section">
        ${createSectionHeader("Artist playlist", "Direct playback across every track in this artist catalog.", null, null)}
        <div class="track-list card">
          ${tracks.map((track) => createTrackRow(track, { contextType: "artist", contextId: artist.slug })).join("")}
        </div>
      </section>
    `,
  };
}

function renderRelease({ library, params, player }) {
  const artistSlug = params.get("artist");
  const releaseSlug = params.get("release");
  const release = library.getReleaseBySlug(artistSlug, releaseSlug);

  if (!release) {
    return renderNotFound({
      title: "Release not found",
      description: "The requested release slug does not exist in library.json.",
    });
  }

  const artist = library.getArtistBySlug(release.artistSlug);
  const tracks = library.getTracksForRelease(release);
  const primaryTrack = tracks[0] || null;

  setMeta({
    title: `${release.title} - ${release.artist}`,
    description: `${release.artist} - ${release.title}${release.genre ? ` - ${release.genre}` : ""}`,
    image: release.coverPath || artist?.coverPath || null,
  });

  return {
    html: `
      <section class="release-layout">
        <div class="release-layout__cover card">
          ${createArtworkMarkup(release, { sizeClass: "artwork--release" })}
        </div>

        <div class="release-layout__content">
          <span class="eyebrow">Release</span>
          <h1>${escapeHtml(release.title)}</h1>
          <p class="lead">
            <a href="${escapeHtml(resolveArtistPath(release.artistSlug))}">${escapeHtml(release.artist)}</a>
            ${release.genre ? ` &middot; ${escapeHtml(release.genre)}` : ""}
          </p>

          <div class="meta-row">
            <span>${pluralize(tracks.length, "track")}</span>
            ${release.dateOfCreation ? `<span>Created ${escapeHtml(formatDate(release.dateOfCreation))}</span>` : ""}
            ${release.dateOfRelease ? `<span>Released ${escapeHtml(formatDate(release.dateOfRelease))}</span>` : ""}
          </div>

          <div class="hero__actions">
            <button type="button" class="button button--primary" data-play-release-id="${escapeHtml(release.id)}">Play release</button>
            <button type="button" class="button button--ghost" data-copy-path="${escapeHtml(resolveReleasePath(release.artistSlug, release.slug))}">Copy link</button>
            <button type="button" class="button button--ghost" data-share-path="${escapeHtml(resolveReleasePath(release.artistSlug, release.slug))}" data-share-title="${escapeHtml(release.title)}" data-share-text="${escapeHtml(release.artist)}">Share</button>
            <a class="button button--ghost" href="${escapeHtml(resolveArtistPath(release.artistSlug))}">Open artist</a>
          </div>

          <section class="inline-player card" data-inline-player data-track-id="${escapeHtml(primaryTrack?.id || "")}">
            <div class="inline-player__top">
              <strong>Main player</strong>
              <span>Sticky playback stays available across the entire site.</span>
            </div>
            <div class="inline-player__controls">
              <button type="button" class="icon-button icon-button--accent icon-button--xl" data-inline-action="toggle" aria-label="Play or pause">${primaryTrack ? "" : "?"}</button>
              <button type="button" class="icon-button" data-inline-action="previous" aria-label="Previous track">${iconPrevious()}</button>
              <button type="button" class="icon-button" data-inline-action="next" aria-label="Next track">${iconNext()}</button>
            </div>
            <div class="inline-player__progress">
              <span data-inline-current-time>0:00</span>
              <input type="range" min="0" max="1000" step="1" value="0" data-inline-seek aria-label="Seek">
              <span data-inline-duration>0:00</span>
            </div>
            <div class="inline-player__volume">
              <span>Volume</span>
              <input type="range" min="0" max="100" step="1" value="86" data-inline-volume aria-label="Volume">
            </div>
          </section>
        </div>
      </section>

      <section class="section">
        ${createSectionHeader("Tracklist", "Ready for multi-track releases later without changing the structure.", null, null)}
        <div class="track-list card">
          ${tracks.map((track) => createTrackRow(track, { contextType: "release", contextId: release.id })).join("")}
        </div>
      </section>
    `,
    mount({ root, player: currentPlayer }) {
      const panel = root.querySelector("[data-inline-player]");
      if (!panel || !primaryTrack) {
        return;
      }

      currentPlayer.connectInlinePanel(panel);

      panel.addEventListener("click", (event) => {
        const action = event.target.closest("[data-inline-action]")?.dataset.inlineAction;
        if (!action) {
          return;
        }

        if (action === "toggle") {
          const isCurrent = currentPlayer.currentTrack?.id === primaryTrack.id;
          if (!isCurrent) {
            currentPlayer.setQueue(release.trackIds, primaryTrack.id, { autoplay: true });
          } else {
            currentPlayer.togglePlayback();
          }
        }

        if (action === "previous") {
          currentPlayer.previous();
        }

        if (action === "next") {
          currentPlayer.next();
        }
      });

      const seek = panel.querySelector("[data-inline-seek]");
      const volume = panel.querySelector("[data-inline-volume]");

      seek?.addEventListener("input", () => {
        if (!currentPlayer.audio.duration) {
          return;
        }

        currentPlayer.audio.currentTime = (Number(seek.value) / 1000) * currentPlayer.audio.duration;
        currentPlayer.syncUI();
      });

      volume?.addEventListener("input", () => {
        currentPlayer.setVolume(Number(volume.value) / 100);
      });

      return () => {
        currentPlayer.disconnectInlinePanel(panel);
      };
    },
  };
}

function renderPlaylists({ library }) {
  const mainPlaylists = library.playlists.filter((playlist) => playlist.type !== "artist");
  const artistPlaylists = library.playlists.filter((playlist) => playlist.type === "artist");

  setMeta({
    title: "Playlists",
    description: "Global playlists, latest releases and one playlist per artist.",
    image: mainPlaylists[0]?.coverPath || artistPlaylists[0]?.coverPath || null,
  });

  return {
    html: `
      <section class="page-header">
        <div>
          <span class="eyebrow">Playlists</span>
          <h1>Auto-generated listening routes.</h1>
          <p>Every playlist is derived from the repository itself: global catalog, latest drops, and one playlist per artist.</p>
        </div>
      </section>

      <section class="section">
        ${createSectionHeader("Core playlists", "Start broad, then narrow down by artist.", null, null)}
        <div class="playlist-stack">
          ${mainPlaylists.map((playlist) => createPlaylistCard(playlist, library)).join("")}
        </div>
      </section>

      <section class="section">
        ${createSectionHeader("Artist playlists", "One full queue per artist.", null, null)}
        <div class="card-grid card-grid--artists">
          ${artistPlaylists.map((playlist) => createPlaylistCard(playlist, library)).join("")}
        </div>
      </section>
    `,
  };
}

function renderPlaylist({ library, params }) {
  const playlist = library.getPlaylistByParams(params.get("type"), params.get("slug"));

  if (!playlist) {
    return renderNotFound({
      title: "Playlist not found",
      description: "The requested playlist parameters do not exist in library.json.",
    });
  }

  const tracks = library.getTracksForPlaylist(playlist);
  const artist = playlist.artistSlug ? library.getArtistBySlug(playlist.artistSlug) : null;

  setMeta({
    title: playlist.title,
    description: `${playlist.title} - ${pluralize(tracks.length, "track")}.`,
    image: playlist.coverPath || artist?.coverPath || null,
  });

  return {
    html: `
      <section class="playlist-hero card">
        <div class="playlist-hero__art">
          ${createArtworkMarkup({ title: playlist.title, artist: artist?.name || playlist.description, coverPath: playlist.coverPath }, { sizeClass: "artwork--release" })}
        </div>
        <div class="playlist-hero__copy">
          <span class="eyebrow">Playlist</span>
          <h1>${escapeHtml(playlist.title)}</h1>
          <p>${escapeHtml(playlist.description || "Auto-generated playlist.")}</p>
          <div class="meta-row">
            <span>${pluralize(tracks.length, "track")}</span>
            ${artist ? `<span>${escapeHtml(artist.name)}</span>` : ""}
          </div>
          <div class="hero__actions">
            <button type="button" class="button button--primary" data-play-playlist-id="${escapeHtml(playlist.id)}">Play playlist</button>
            <button type="button" class="button button--ghost" data-copy-path="${escapeHtml(playlist.href)}">Copy link</button>
            <button type="button" class="button button--ghost" data-share-path="${escapeHtml(playlist.href)}" data-share-title="${escapeHtml(playlist.title)}" data-share-text="Playlist">Share</button>
          </div>
        </div>
      </section>

      <section class="section">
        ${createSectionHeader("Tracks", "Playable without leaving the interface.", null, null)}
        <div class="track-list card">
          ${tracks.map((track) => createTrackRow(track, { contextType: "playlist", contextId: playlist.id })).join("")}
        </div>
      </section>
    `,
  };
}

function renderNotFound({ title, description }) {
  setMeta({ title, description });

  return {
    html: `
      <section class="empty-state card">
        <span class="eyebrow">Missing content</span>
        <h1>${escapeHtml(title)}</h1>
        <p>${escapeHtml(description)}</p>
        <div class="hero__actions">
          <a class="button button--primary" href="index.html">Back home</a>
          <a class="button button--ghost" href="artists.html">Artists</a>
        </div>
      </section>
    `,
  };
}

function createSectionHeader(title, description, href, label) {
  return `
    <div class="section__header">
      <div>
        <h2>${escapeHtml(title)}</h2>
        <p>${escapeHtml(description)}</p>
      </div>
      ${href && label ? `<a class="inline-link" href="${escapeHtml(href)}">${escapeHtml(label)}</a>` : ""}
    </div>
  `;
}

function createMetricCard(value, label) {
  return `
    <div class="metric-card">
      <strong>${value}</strong>
      <span>${escapeHtml(label)}</span>
    </div>
  `;
}

function createReleaseFeature(release) {
  return `
    <div class="feature-card">
      <div class="feature-card__art">
        ${createArtworkMarkup(release, { sizeClass: "artwork--feature" })}
      </div>
      <div class="feature-card__copy">
        <span class="eyebrow">Latest drop</span>
        <h2>${escapeHtml(release.title)}</h2>
        <p>${escapeHtml(release.artist)}${release.genre ? ` &middot; ${escapeHtml(release.genre)}` : ""}</p>
        <div class="feature-card__meta">
          ${release.dateOfRelease ? `<span>${escapeHtml(formatDate(release.dateOfRelease))}</span>` : ""}
          <span>${pluralize(release.trackIds.length, "track")}</span>
        </div>
        <div class="hero__actions">
          <button type="button" class="button button--primary" data-play-release-id="${escapeHtml(release.id)}">Play release</button>
          <a class="button button--ghost" href="${escapeHtml(resolveReleasePath(release.artistSlug, release.slug))}">Open page</a>
        </div>
      </div>
    </div>
  `;
}

function createReleaseCard(release) {
  return `
    <article class="card release-card">
      <a class="release-card__cover" href="${escapeHtml(resolveReleasePath(release.artistSlug, release.slug))}">
        ${createArtworkMarkup(release, { sizeClass: "artwork--card" })}
      </a>
      <div class="release-card__copy">
        <div>
          <h3><a href="${escapeHtml(resolveReleasePath(release.artistSlug, release.slug))}">${escapeHtml(release.title)}</a></h3>
          <p><a href="${escapeHtml(resolveArtistPath(release.artistSlug))}">${escapeHtml(release.artist)}</a></p>
        </div>
        <div class="meta-row">
          ${release.dateOfRelease ? `<span>${escapeHtml(formatDate(release.dateOfRelease))}</span>` : ""}
          ${release.genre ? `<span>${escapeHtml(release.genre)}</span>` : ""}
        </div>
        <div class="card-actions">
          <button type="button" class="button button--small button--primary" data-play-release-id="${escapeHtml(release.id)}">Play</button>
          <button type="button" class="button button--small button--ghost" data-copy-path="${escapeHtml(resolveReleasePath(release.artistSlug, release.slug))}">Copy link</button>
        </div>
      </div>
    </article>
  `;
}

function createArtistCard(artist) {
  const latestReleaseHref = artist.releaseIds[0] ? resolveArtistPath(artist.slug) : resolveArtistPath(artist.slug);

  return `
    <article class="card artist-card" data-artist-card data-latest="${escapeHtml(artist.latestReleaseDate || "")}" data-releases="${artist.releaseCount}" data-name="${escapeHtml(artist.name)}">
      <a href="${escapeHtml(resolveArtistPath(artist.slug))}" class="artist-card__art">
        ${createArtworkMarkup(artist, { sizeClass: "artwork--artist", round: true })}
      </a>
      <div class="artist-card__copy">
        <h3><a href="${escapeHtml(resolveArtistPath(artist.slug))}">${escapeHtml(artist.name)}</a></h3>
        <p>${pluralize(artist.releaseCount, "release")} &middot; ${pluralize(artist.trackCount, "track")}</p>
        <div class="tag-row">${artist.genres.slice(0, 3).map(createTag).join("")}</div>
        <div class="card-actions">
          <a class="button button--small button--primary" href="${escapeHtml(latestReleaseHref)}">Open artist</a>
          <button type="button" class="button button--small button--ghost" data-play-artist-slug="${escapeHtml(artist.slug)}">Play playlist</button>
        </div>
      </div>
    </article>
  `;
}

function createPlaylistCard(playlist, library) {
  const tracks = library.getTracksForPlaylist(playlist);
  const subtitle = playlist.artistSlug ? library.getArtistBySlug(playlist.artistSlug)?.name : playlist.description;

  return `
    <article class="card playlist-card">
      <a href="${escapeHtml(playlist.href)}" class="playlist-card__art">
        ${createArtworkMarkup({ title: playlist.title, artist: subtitle, coverPath: playlist.coverPath }, { sizeClass: "artwork--card" })}
      </a>
      <div class="playlist-card__copy">
        <h3><a href="${escapeHtml(playlist.href)}">${escapeHtml(playlist.title)}</a></h3>
        <p>${escapeHtml(playlist.description || "")}</p>
        <div class="meta-row">
          <span>${pluralize(tracks.length, "track")}</span>
          ${playlist.artistSlug ? `<span>${escapeHtml(subtitle || "")}</span>` : ""}
        </div>
        <div class="card-actions">
          <button type="button" class="button button--small button--primary" data-play-playlist-id="${escapeHtml(playlist.id)}">Play</button>
          <button type="button" class="button button--small button--ghost" data-share-path="${escapeHtml(playlist.href)}" data-share-title="${escapeHtml(playlist.title)}" data-share-text="Playlist">Share</button>
        </div>
      </div>
    </article>
  `;
}

function createTrackRow(track, options = {}) {
  const releaseHref = resolveReleasePath(track.artistSlug, track.releaseSlug);

  return `
    <div class="track-row">
      <button type="button" class="track-row__play" data-play-track-id="${escapeHtml(track.id)}" data-context-type="${escapeHtml(options.contextType || "all")}" data-context-id="${escapeHtml(options.contextId || "")}" aria-label="Play ${escapeHtml(track.title)}">
        ${iconPlay()}
      </button>
      <div class="track-row__meta">
        <strong>${escapeHtml(track.title)}</strong>
        <span>
          <a href="${escapeHtml(resolveArtistPath(track.artistSlug))}">${escapeHtml(track.artist)}</a>
          &middot;
          <a href="${escapeHtml(releaseHref)}">${escapeHtml(track.releaseTitle)}</a>
          ${track.genre ? `&middot; ${escapeHtml(track.genre)}` : ""}
        </span>
      </div>
      <div class="track-row__info">
        <span>${track.dateOfRelease ? escapeHtml(formatDate(track.dateOfRelease)) : "Undated"}</span>
        <span>${escapeHtml(formatTime(track.duration || 0))}</span>
      </div>
    </div>
  `;
}

function createTag(value) {
  return `<span class="tag">${escapeHtml(value)}</span>`;
}

function createEmptyCard(title, description) {
  return `
    <div class="empty-state empty-state--small">
      <h2>${escapeHtml(title)}</h2>
      <p>${escapeHtml(description)}</p>
    </div>
  `;
}

function iconPlay() {
  return `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v13l10-6.5z" fill="currentColor"/></svg>`;
}

function iconPrevious() {
  return `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 5h2v14H7zm3 7 10 7V5z" fill="currentColor"/></svg>`;
}

function iconNext() {
  return `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5h2v14h-2zM5 19l10-7L5 5z" fill="currentColor"/></svg>`;
}
