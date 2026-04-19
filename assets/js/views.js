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
  const latestReleases = sortByDateDesc(library.releases).slice(0, 6);
  const recentTracks = sortByDateDesc(library.tracks).slice(0, 8);
  const featuredArtists = library.artists.slice(0, 6);
  const corePlaylists = library.playlists.filter((playlist) => playlist.type !== "artist").slice(0, 3);
  const allTracks = library.playlists.find((playlist) => playlist.type === "all-tracks");

  setMeta({
    title: "Home",
    description: "Personal music library with direct access to releases, artists, playlists and persistent playback.",
    image: latestReleases[0]?.coverPath || corePlaylists[0]?.coverPath || null,
  });

  return {
    html: `
      <section class="home-overview card">
        <div class="home-overview__head">
          <div>
            <h1>Library</h1>
            <div class="meta-row meta-row--tight">
              <span>${pluralize(library.stats.releaseCount, "release")}</span>
              <span>${pluralize(library.stats.trackCount, "track")}</span>
              <span>${pluralize(library.stats.artistCount, "artist")}</span>
            </div>
          </div>
          <div class="toolbar toolbar--dense">
            <button type="button" class="button button--primary button--small" data-play-playlist-id="${escapeHtml(allTracks?.id || "")}">Play all</button>
            <a class="button button--ghost button--small" href="playlist.html?type=all">All tracks</a>
            <a class="button button--ghost button--small" href="playlists.html">Playlists</a>
            <button type="button" class="button button--ghost button--small" data-open-search>Search</button>
          </div>
        </div>
      </section>

      <section class="home-grid">
        <div class="home-grid__main">
          <section class="section section--flush">
            ${createSectionHeader("Latest releases", null, "artists.html", "Artists")}
            <div class="${escapeHtml(getReleaseGridClassName(latestReleases))}">
              ${latestReleases.map((release) => createReleaseCard(release)).join("")}
            </div>
          </section>

          <section class="section section--flush">
            ${createSectionHeader("Recently added", null, "playlist.html?type=all", "All tracks")}
            <div class="track-list card">
              ${recentTracks.map((track) => createTrackRow(track, { contextType: "all" })).join("")}
            </div>
          </section>
        </div>

        <aside class="home-grid__side">
          <section class="section section--flush">
            ${createSectionHeader("Playlists", null, "playlists.html", "Open")}
            <div class="playlist-stack">
              ${corePlaylists.map((playlist) => createPlaylistCard(playlist, library)).join("")}
            </div>
          </section>

          <section class="section section--flush">
            ${createSectionHeader("Artists", null, "artists.html", "All")}
            <div class="card-grid card-grid--artists-compact">
              ${featuredArtists.map((artist) => createArtistCard(artist)).join("")}
            </div>
          </section>
        </aside>
      </section>
    `,
  };
}

function renderArtists({ library }) {
  setMeta({
    title: "Artists",
    description: "Artists, release counts and direct artist playback.",
    image: library.artists[0]?.coverPath || null,
  });

  return {
    html: `
      <section class="page-header page-header--compact">
        <div>
          <h1>Artists</h1>
          <div class="meta-row meta-row--tight">
            <span>${pluralize(library.stats.artistCount, "artist")}</span>
            <span>${pluralize(library.stats.releaseCount, "release")}</span>
          </div>
        </div>
        <div class="toolbar toolbar--dense">
          <label class="field">
            <span>Sort</span>
            <select data-artist-sort>
              <option value="name">Name</option>
              <option value="releases">Releases</option>
              <option value="latest">Latest</option>
            </select>
          </label>
        </div>
      </section>

      <div class="card-grid card-grid--artists-page" data-artist-grid>
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
      <section class="artist-panel card">
        <div class="artist-panel__art">${createArtworkMarkup(artist, { sizeClass: "artwork--artist-panel" })}</div>
        <div class="artist-panel__copy">
          <div class="artist-panel__head">
            <h1>${escapeHtml(artist.name)}</h1>
            <div class="meta-row meta-row--tight">
              <span>${pluralize(artist.releaseCount, "release")}</span>
              <span>${pluralize(artist.trackCount, "track")}</span>
            </div>
          </div>
          <div class="tag-row">${artist.genres.length ? artist.genres.map(createTag).join("") : ""}</div>
          <div class="toolbar toolbar--dense">
            <button type="button" class="button button--primary button--small" data-play-artist-slug="${escapeHtml(artist.slug)}">Play now</button>
            <a class="button button--ghost button--small" href="${escapeHtml(resolvePlaylistPath("artist", artist.slug))}">Playlist</a>
            <button type="button" class="button button--ghost button--small" data-share-path="${escapeHtml(resolveArtistPath(artist.slug))}" data-share-title="${escapeHtml(artist.name)}" data-share-text="Artist">Share</button>
          </div>
        </div>
      </section>

      <section class="section">
        ${createSectionHeader("Releases", null, null, null)}
        <div class="${escapeHtml(getReleaseGridClassName(releases))}">
          ${releases.map((release) => createReleaseCard(release)).join("")}
        </div>
      </section>

      <section class="section">
        ${createSectionHeader("Tracks", null, null, null)}
        <div class="track-list card">
          ${tracks.map((track) => createTrackRow(track, { contextType: "artist", contextId: artist.slug })).join("")}
        </div>
      </section>
    `,
  };
}

function renderRelease({ library, params }) {
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
      <section class="release-panel card">
        <div class="release-panel__art">
          ${createArtworkMarkup(release, { sizeClass: "artwork--release-panel" })}
        </div>

        <div class="release-panel__copy">
          <div class="release-panel__head">
            <h1>${escapeHtml(release.title)}</h1>
            <p class="lead">
              <a href="${escapeHtml(resolveArtistPath(release.artistSlug))}">${escapeHtml(release.artist)}</a>
              ${release.genre ? ` <span>&middot;</span> ${escapeHtml(release.genre)}` : ""}
            </p>
          </div>

          <div class="meta-row meta-row--tight">
            ${release.releaseType ? `<span>${escapeHtml(release.releaseType)}</span>` : ""}
            <span>${pluralize(tracks.length, "track")}</span>
            ${release.duration ? `<span>${escapeHtml(formatTime(release.duration))}</span>` : ""}
            ${release.originalArtists?.length ? `<span>orig. ${escapeHtml(release.originalArtists.join(", "))}</span>` : ""}
            ${release.dateOfCreation ? `<span>${escapeHtml(formatDate(release.dateOfCreation))}</span>` : ""}
            ${release.dateOfRelease ? `<span>${escapeHtml(formatDate(release.dateOfRelease))}</span>` : ""}
          </div>

          <div class="toolbar toolbar--dense">
            <button type="button" class="button button--primary button--small" data-play-release-id="${escapeHtml(release.id)}">Play now</button>
            <button type="button" class="button button--ghost button--small" data-copy-path="${escapeHtml(resolveReleasePath(release.artistSlug, release.slug))}">Copy link</button>
            <button type="button" class="button button--ghost button--small" data-share-path="${escapeHtml(resolveReleasePath(release.artistSlug, release.slug))}" data-share-title="${escapeHtml(release.title)}" data-share-text="${escapeHtml(release.artist)}">Share</button>
            <a class="button button--ghost button--small" href="${escapeHtml(resolveArtistPath(release.artistSlug))}">Artist</a>
          </div>

          <section class="inline-player card" data-inline-player data-track-id="${escapeHtml(primaryTrack?.id || "")}">
            <div class="inline-player__top">
              <strong>Main player</strong>
            </div>
            <div class="inline-player__controls">
              <button type="button" class="icon-button icon-button--accent" data-inline-action="toggle" aria-label="Play or pause">${primaryTrack ? "" : "?"}</button>
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
        ${createSectionHeader("Tracklist", null, null, null)}
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

      const onClick = (event) => {
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
      };

      const seek = panel.querySelector("[data-inline-seek]");
      const volume = panel.querySelector("[data-inline-volume]");

      const onSeek = () => {
        if (!currentPlayer.audio.duration) {
          return;
        }

        currentPlayer.audio.currentTime = (Number(seek.value) / 1000) * currentPlayer.audio.duration;
        currentPlayer.syncUI();
      };

      const onVolume = () => {
        currentPlayer.setVolume(Number(volume.value) / 100);
      };

      panel.addEventListener("click", onClick);
      seek?.addEventListener("input", onSeek);
      volume?.addEventListener("input", onVolume);

      return () => {
        panel.removeEventListener("click", onClick);
        seek?.removeEventListener("input", onSeek);
        volume?.removeEventListener("input", onVolume);
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
      <section class="page-header page-header--compact">
        <div>
          <h1>Playlists</h1>
          <div class="meta-row meta-row--tight">
            <span>${pluralize(library.playlists.length, "playlist")}</span>
          </div>
        </div>
      </section>

      <section class="section">
        ${createSectionHeader("Core", null, null, null)}
        <div class="playlist-stack">
          ${mainPlaylists.map((playlist) => createPlaylistCard(playlist, library)).join("")}
        </div>
      </section>

      <section class="section">
        ${createSectionHeader("By artist", null, null, null)}
        <div class="card-grid card-grid--artists-page">
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
      <section class="playlist-panel card">
        <div class="playlist-panel__art">
          ${createArtworkMarkup({ title: playlist.title, artist: artist?.name || playlist.description, coverPath: playlist.coverPath }, { sizeClass: "artwork--playlist-panel" })}
        </div>
        <div class="playlist-panel__copy">
          <h1>${escapeHtml(playlist.title)}</h1>
          <div class="meta-row meta-row--tight">
            <span>${pluralize(tracks.length, "track")}</span>
            ${playlist.duration ? `<span>${escapeHtml(formatTime(playlist.duration))}</span>` : ""}
            ${artist ? `<span>${escapeHtml(artist.name)}</span>` : ""}
          </div>
          <div class="toolbar toolbar--dense">
            <button type="button" class="button button--primary button--small" data-play-playlist-id="${escapeHtml(playlist.id)}">Play now</button>
            <button type="button" class="button button--ghost button--small" data-copy-path="${escapeHtml(playlist.href)}">Copy link</button>
            <button type="button" class="button button--ghost button--small" data-share-path="${escapeHtml(playlist.href)}" data-share-title="${escapeHtml(playlist.title)}" data-share-text="Playlist">Share</button>
          </div>
        </div>
      </section>

      <section class="section">
        ${createSectionHeader("Tracks", null, null, null)}
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
        <h1>${escapeHtml(title)}</h1>
        <p>${escapeHtml(description)}</p>
        <div class="toolbar toolbar--dense">
          <a class="button button--primary button--small" href="index.html">Home</a>
          <a class="button button--ghost button--small" href="artists.html">Artists</a>
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
        ${description ? `<p>${escapeHtml(description)}</p>` : ""}
      </div>
      ${href && label ? `<a class="inline-link" href="${escapeHtml(href)}">${escapeHtml(label)}</a>` : ""}
    </div>
  `;
}

function getReleaseGridClassName(releases) {
  return `card-grid card-grid--releases${(releases?.length || 0) > 3 ? " card-grid--release-rail" : ""}`;
}

function createReleaseCard(release) {
  const primaryMetaParts = [
    release.releaseType ? escapeHtml(release.releaseType) : "",
    release.trackCount ? escapeHtml(pluralize(release.trackCount, "track")) : "",
  ].filter(Boolean);
  const primaryMeta = release.duration
    ? `${primaryMetaParts.join(" ")}${primaryMetaParts.length ? " - " : ""}${escapeHtml(formatTime(release.duration))}`
    : primaryMetaParts.join(" ");
  const secondaryMeta = release.dateOfRelease ? escapeHtml(formatDate(release.dateOfRelease)) : "";
  const tertiaryMeta = release.genre ? escapeHtml(release.genre) : "";

  return `
    <article class="card release-card">
      <a class="release-card__cover" href="${escapeHtml(resolveReleasePath(release.artistSlug, release.slug))}">
        ${createArtworkMarkup(release, { sizeClass: "artwork--card" })}
      </a>
      <div class="release-card__copy">
        <div class="release-card__head">
          <h3><a href="${escapeHtml(resolveReleasePath(release.artistSlug, release.slug))}">${escapeHtml(release.title)}</a></h3>
          <p><a href="${escapeHtml(resolveArtistPath(release.artistSlug))}">${escapeHtml(release.artist)}</a></p>
        </div>
        <div class="release-card__meta">
          ${primaryMeta ? `<span>${primaryMeta}</span>` : ""}
          ${secondaryMeta ? `<span>${secondaryMeta}</span>` : ""}
          ${tertiaryMeta ? `<span>${tertiaryMeta}</span>` : ""}
        </div>
        <div class="card-actions card-actions--compact">
          <button type="button" class="button button--primary button--small" data-play-release-id="${escapeHtml(release.id)}">Play</button>
          <button type="button" class="button button--ghost button--small" data-copy-path="${escapeHtml(resolveReleasePath(release.artistSlug, release.slug))}">Link</button>
        </div>
      </div>
    </article>
  `;
}

function createArtistCard(artist) {
  return `
    <article class="card artist-card" data-artist-card data-latest="${escapeHtml(artist.latestReleaseDate || "")}" data-releases="${artist.releaseCount}" data-name="${escapeHtml(artist.name)}">
      <a href="${escapeHtml(resolveArtistPath(artist.slug))}" class="artist-card__art">
        ${createArtworkMarkup(artist, { sizeClass: "artwork--artist-compact" })}
      </a>
      <div class="artist-card__copy">
        <div class="artist-card__head">
          <h3><a href="${escapeHtml(resolveArtistPath(artist.slug))}">${escapeHtml(artist.name)}</a></h3>
          <p>${pluralize(artist.releaseCount, "release")}</p>
        </div>
        <div class="tag-row">${artist.genres.slice(0, 2).map(createTag).join("")}</div>
        <div class="card-actions card-actions--compact">
          <a class="button button--ghost button--small" href="${escapeHtml(resolveArtistPath(artist.slug))}">Open</a>
          <button type="button" class="button button--primary button--small" data-play-artist-slug="${escapeHtml(artist.slug)}">Play</button>
        </div>
      </div>
    </article>
  `;
}

function createPlaylistCard(playlist, library) {
  const tracks = library.getTracksForPlaylist(playlist);
  const subtitle = playlist.artistSlug ? library.getArtistBySlug(playlist.artistSlug)?.name : playlist.title;

  return `
    <article class="card playlist-card">
      <a href="${escapeHtml(playlist.href)}" class="playlist-card__art">
        ${createArtworkMarkup({ title: playlist.title, artist: subtitle, coverPath: playlist.coverPath }, { sizeClass: "artwork--playlist-compact" })}
      </a>
      <div class="playlist-card__copy">
        <div class="playlist-card__head">
          <h3><a href="${escapeHtml(playlist.href)}">${escapeHtml(playlist.title)}</a></h3>
          <p>${pluralize(tracks.length, "track")}</p>
        </div>
        <div class="card-actions card-actions--compact">
          <button type="button" class="button button--primary button--small" data-play-playlist-id="${escapeHtml(playlist.id)}">Play</button>
          ${playlist.duration ? `<span class="meta-pill">${escapeHtml(formatTime(playlist.duration))}</span>` : ""}
          <button type="button" class="button button--ghost button--small" data-share-path="${escapeHtml(playlist.href)}" data-share-title="${escapeHtml(playlist.title)}" data-share-text="Playlist">Share</button>
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
          ${track.originalArtist ? `&middot; orig. ${escapeHtml(track.originalArtist)}` : ""}
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

function createControlIcon(paths) {
  return `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true" xmlns="http://www.w3.org/2000/svg">${paths}</svg>`;
}

function iconPlay() {
  return createControlIcon(
    `<path d="M16.6582 9.28638C18.098 10.1862 18.8178 10.6361 19.0647 11.2122C19.2803 11.7152 19.2803 12.2847 19.0647 12.7878C18.8178 13.3638 18.098 13.8137 16.6582 14.7136L9.896 18.94C8.29805 19.9387 7.49907 20.4381 6.83973 20.385C6.26501 20.3388 5.73818 20.0469 5.3944 19.584C5 19.053 5 18.1108 5 16.2264V7.77357C5 5.88919 5 4.94701 5.3944 4.41598C5.73818 3.9531 6.26501 3.66111 6.83973 3.6149C7.49907 3.5619 8.29805 4.06126 9.896 5.05998L16.6582 9.28638Z" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>`
  );
}

function iconPrevious() {
  return createControlIcon(
    `<path d="M7 5V19M17 7.329V16.671C17 17.7367 17 18.2695 16.7815 18.5432C16.5916 18.7812 16.3035 18.9197 15.9989 18.9194C15.6487 18.919 15.2327 18.5861 14.4005 17.9204L10.1235 14.4988C9.05578 13.6446 8.52194 13.2176 8.32866 12.7016C8.1592 12.2492 8.1592 11.7508 8.32866 11.2984C8.52194 10.7824 9.05578 10.3554 10.1235 9.50122L14.4005 6.07961C15.2327 5.41387 15.6487 5.081 15.9989 5.08063C16.3035 5.0803 16.5916 5.21876 16.7815 5.45677C17 5.73045 17 6.2633 17 7.329Z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`
  );
}

function iconNext() {
  return createControlIcon(
    `<path d="M17 5V19M7 7.329V16.671C7 17.7367 7 18.2695 7.21846 18.5432C7.40845 18.7812 7.69654 18.9197 8.00108 18.9194C8.35125 18.919 8.76734 18.5861 9.59951 17.9204L13.8765 14.4988C14.9442 13.6446 15.4781 13.2176 15.6713 12.7016C15.8408 12.2492 15.8408 11.7508 15.6713 11.2984C15.4781 10.7824 14.9442 10.3554 13.8765 9.50122L9.59951 6.07961C8.76734 5.41387 8.35125 5.081 8.00108 5.08063C7.69654 5.0803 7.40845 5.21876 7.21846 5.45677C7 5.73045 7 6.2633 7 7.329Z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`
  );
}
