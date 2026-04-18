import { buildAppUrl, unique } from "./utils.js";

let cachedLibraryPromise = null;

export async function loadLibrary() {
  if (!cachedLibraryPromise) {
    cachedLibraryPromise = fetch(buildAppUrl("data/library.json"), { cache: "no-cache" })
      .then((response) => {
        if (!response.ok) {
          throw new Error(`Failed to load library.json (${response.status})`);
        }

        return response.json();
      })
      .then((library) => enhanceLibrary(library));
  }

  return cachedLibraryPromise;
}

function enhanceLibrary(library) {
  const artistMap = new Map(library.artists.map((artist) => [artist.slug, artist]));
  const releaseMap = new Map(library.releases.map((release) => [`${release.artistSlug}:${release.slug}`, release]));
  const trackMap = new Map(library.tracks.map((track) => [track.id, track]));
  const playlistMap = new Map(library.playlists.map((playlist) => [playlist.id, playlist]));

  return {
    ...library,
    artistMap,
    releaseMap,
    trackMap,
    playlistMap,
    getArtistBySlug(slug) {
      return artistMap.get(slug) || null;
    },
    getReleaseBySlug(artistSlug, releaseSlug) {
      return releaseMap.get(`${artistSlug}:${releaseSlug}`) || null;
    },
    getTrackById(id) {
      return trackMap.get(id) || null;
    },
    getPlaylistByParams(type, slug) {
      if (type === "artist" && slug) {
        return library.playlists.find((playlist) => playlist.type === "artist" && playlist.slug === slug) || null;
      }

      if (type === "all") {
        return library.playlists.find((playlist) => playlist.type === "all-tracks") || null;
      }

      if (type === "latest") {
        return library.playlists.find((playlist) => playlist.type === "latest-releases") || null;
      }

      return null;
    },
    getTracksForRelease(release) {
      return (release?.trackIds || []).map((trackId) => trackMap.get(trackId)).filter(Boolean);
    },
    getReleasesForArtist(artist) {
      return (artist?.releaseIds || [])
        .map((releaseId) => library.releases.find((release) => release.id === releaseId))
        .filter(Boolean)
        .sort((left, right) => (right.sortDate || "").localeCompare(left.sortDate || ""));
    },
    getTracksForArtist(artist) {
      return (artist?.trackIds || []).map((trackId) => trackMap.get(trackId)).filter(Boolean);
    },
    getTracksForPlaylist(playlist) {
      return unique(playlist?.trackIds || []).map((trackId) => trackMap.get(trackId)).filter(Boolean);
    },
    search(query) {
      const normalized = String(query || "").trim().toLowerCase();

      if (!normalized) {
        return { artists: [], releases: [], tracks: [] };
      }

      const matcher = (value) => String(value || "").toLowerCase().includes(normalized);

      return {
        artists: library.artists.filter(
          (artist) => matcher(artist.name) || artist.genres.some((genre) => matcher(genre))
        ),
        releases: library.releases.filter(
          (release) =>
            matcher(release.title) ||
            matcher(release.artist) ||
            release.genres.some((genre) => matcher(genre))
        ),
        tracks: library.tracks.filter(
          (track) =>
            matcher(track.title) ||
            matcher(track.artist) ||
            matcher(track.releaseTitle) ||
            track.genres.some((genre) => matcher(genre))
        ),
      };
    },
  };
}
