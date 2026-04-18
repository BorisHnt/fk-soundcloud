#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");

const ROOT_DIR = path.resolve(__dirname, "..");
const MUSICS_DIR = path.join(ROOT_DIR, "musics");
const OUTPUT_DIR = path.join(ROOT_DIR, "data");
const OUTPUT_FILE = path.join(OUTPUT_DIR, "library.json");

const AUDIO_EXTENSIONS = new Set([".mp3", ".wav", ".ogg", ".m4a", ".flac", ".aac"]);
const COVER_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp", ".avif"]);

function slugify(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "item";
}

function prettifyName(value) {
  return String(value || "")
    .replace(/\.[^.]+$/, "")
    .replace(/_/g, " ")
    .replace(/\s*-\s*/g, " - ")
    .replace(/\s+/g, " ")
    .trim();
}

function readDirectoryEntries(directoryPath) {
  try {
    return fs.readdirSync(directoryPath, { withFileTypes: true });
  } catch (error) {
    return [];
  }
}

function parseInfoFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return {};
  }

  const content = fs.readFileSync(filePath, "utf8");
  const lines = content.split(/\r?\n/);
  const info = {};

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const separatorIndex = trimmed.indexOf(":");
    if (separatorIndex === -1) {
      continue;
    }

    const key = trimmed.slice(0, separatorIndex).trim().toLowerCase();
    const value = trimmed.slice(separatorIndex + 1).trim();

    if (!key || !value) {
      continue;
    }

    info[key] = value;
  }

  return info;
}

function pickFiles(directoryPath, allowedExtensions) {
  return readDirectoryEntries(directoryPath)
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .filter((fileName) => allowedExtensions.has(path.extname(fileName).toLowerCase()))
    .sort((left, right) => left.localeCompare(right, "en"));
}

function ensureUniqueId(baseId, usedIds) {
  if (!usedIds.has(baseId)) {
    usedIds.add(baseId);
    return baseId;
  }

  let suffix = 2;
  while (usedIds.has(`${baseId}-${suffix}`)) {
    suffix += 1;
  }

  const uniqueId = `${baseId}-${suffix}`;
  usedIds.add(uniqueId);
  return uniqueId;
}

function toWebPath(absolutePath) {
  return path.relative(ROOT_DIR, absolutePath).split(path.sep).join("/");
}

function parseGenres(rawGenre) {
  const source = String(rawGenre || "").trim();
  if (!source) {
    return [];
  }

  return [...new Set(
    source
      .split(/[;,|]/)
      .map((part) => prettifyName(part))
      .filter(Boolean)
  )];
}

function getSortableDate(...candidates) {
  for (const candidate of candidates) {
    if (candidate && /^\d{4}-\d{2}-\d{2}$/.test(candidate)) {
      return candidate;
    }
  }

  return null;
}

function buildLibrary() {
  const artistEntries = readDirectoryEntries(MUSICS_DIR)
    .filter((entry) => entry.isDirectory())
    .sort((left, right) => left.name.localeCompare(right.name, "en"));

  const usedTrackIds = new Set();
  const releases = [];
  const tracks = [];
  const artistMap = new Map();
  const warnings = [];

  for (const artistEntry of artistEntries) {
    const artistFolderName = artistEntry.name;
    const artistName = prettifyName(artistFolderName);
    const artistSlug = slugify(artistFolderName);
    const artistDirectory = path.join(MUSICS_DIR, artistFolderName);

    const releaseEntries = readDirectoryEntries(artistDirectory)
      .filter((entry) => entry.isDirectory())
      .sort((left, right) => left.name.localeCompare(right.name, "en"));

    if (!artistMap.has(artistSlug)) {
      artistMap.set(artistSlug, {
        id: `artist:${artistSlug}`,
        name: artistName,
        slug: artistSlug,
        path: toWebPath(artistDirectory),
        releaseIds: [],
        trackIds: [],
        genres: new Set(),
        coverPath: null,
        latestReleaseDate: null,
      });
    }

    for (const releaseEntry of releaseEntries) {
      const releaseFolderName = releaseEntry.name;
      const releaseDirectory = path.join(artistDirectory, releaseFolderName);
      const audioFiles = pickFiles(releaseDirectory, AUDIO_EXTENSIONS);

      if (audioFiles.length === 0) {
        warnings.push(`Skipped "${artistFolderName}/${releaseFolderName}" because no audio file was found.`);
        continue;
      }

      const coverFiles = pickFiles(releaseDirectory, COVER_EXTENSIONS);
      const info = parseInfoFile(path.join(releaseDirectory, "infos.txt"));
      const releaseSlug = slugify(releaseFolderName);
      const releaseTitle = prettifyName(info.release_title || releaseFolderName);
      const releaseId = `release:${artistSlug}:${releaseSlug}`;
      const genres = parseGenres(info.genre);
      const dateOfCreation = info.date_of_creation || null;
      const dateOfRelease = info.date_of_release || null;
      const sortDate = getSortableDate(dateOfRelease, dateOfCreation);
      const coverPath = coverFiles.length > 0 ? toWebPath(path.join(releaseDirectory, coverFiles[0])) : null;

      const releaseTrackIds = [];

      for (const audioFile of audioFiles) {
        const rawTrackTitle = info.track_title || path.basename(audioFile, path.extname(audioFile));
        const trackTitle = prettifyName(rawTrackTitle);
        const trackSlug = slugify(path.basename(audioFile, path.extname(audioFile)));
        const trackId = ensureUniqueId(`track:${artistSlug}:${releaseSlug}:${trackSlug}`, usedTrackIds);
        const audioPath = toWebPath(path.join(releaseDirectory, audioFile));

        const track = {
          id: trackId,
          slug: trackSlug,
          title: trackTitle,
          artist: artistName,
          artistSlug,
          artistId: `artist:${artistSlug}`,
          releaseId,
          releaseSlug,
          releaseTitle,
          audioPath,
          coverPath,
          dateOfCreation,
          dateOfRelease,
          genre: genres[0] || null,
          genres,
          sortDate,
          duration: null,
          trackNumber: releaseTrackIds.length + 1,
          href: `release.html?artist=${encodeURIComponent(artistSlug)}&release=${encodeURIComponent(releaseSlug)}`,
          shareUrl: `/release.html?artist=${encodeURIComponent(artistSlug)}&release=${encodeURIComponent(releaseSlug)}`,
        };

        tracks.push(track);
        releaseTrackIds.push(trackId);
      }

      const primaryTrack = tracks.find((track) => track.id === releaseTrackIds[0]);

      const release = {
        id: releaseId,
        slug: releaseSlug,
        title: releaseTitle,
        artist: artistName,
        artistSlug,
        artistId: `artist:${artistSlug}`,
        coverPath,
        dateOfCreation,
        dateOfRelease,
        genre: genres[0] || null,
        genres,
        infoPath: fs.existsSync(path.join(releaseDirectory, "infos.txt"))
          ? toWebPath(path.join(releaseDirectory, "infos.txt"))
          : null,
        path: toWebPath(releaseDirectory),
        sortDate,
        trackIds: releaseTrackIds,
        primaryTrackId: primaryTrack ? primaryTrack.id : null,
        href: `release.html?artist=${encodeURIComponent(artistSlug)}&release=${encodeURIComponent(releaseSlug)}`,
      };

      releases.push(release);

      const artist = artistMap.get(artistSlug);
      artist.releaseIds.push(releaseId);
      artist.trackIds.push(...releaseTrackIds);

      for (const genre of genres) {
        artist.genres.add(genre);
      }

      if (!artist.coverPath && coverPath) {
        artist.coverPath = coverPath;
      }

      if (!artist.latestReleaseDate || (sortDate && sortDate > artist.latestReleaseDate)) {
        artist.latestReleaseDate = sortDate;
        if (coverPath) {
          artist.coverPath = coverPath;
        }
      }
    }
  }

  releases.sort((left, right) => {
    const rightDate = right.sortDate || "";
    const leftDate = left.sortDate || "";
    return rightDate.localeCompare(leftDate) || left.title.localeCompare(right.title, "en");
  });

  tracks.sort((left, right) => {
    const rightDate = right.sortDate || "";
    const leftDate = left.sortDate || "";
    return rightDate.localeCompare(leftDate) || left.title.localeCompare(right.title, "en");
  });

  const artists = [...artistMap.values()]
    .map((artist) => ({
      id: artist.id,
      name: artist.name,
      slug: artist.slug,
      path: artist.path,
      coverPath: artist.coverPath,
      genres: [...artist.genres].sort((left, right) => left.localeCompare(right, "en")),
      releaseIds: artist.releaseIds,
      trackIds: artist.trackIds,
      releaseCount: artist.releaseIds.length,
      trackCount: artist.trackIds.length,
      latestReleaseDate: artist.latestReleaseDate,
      href: `artist.html?slug=${encodeURIComponent(artist.slug)}`,
      playlistHref: `playlist.html?type=artist&slug=${encodeURIComponent(artist.slug)}`,
    }))
    .sort((left, right) => left.name.localeCompare(right.name, "en"));

  const playlists = [
    {
      id: "playlist:all-tracks",
      type: "all-tracks",
      title: "All Tracks",
      slug: "all-tracks",
      description: "Complete library across every artist and release.",
      coverPath: releases[0]?.coverPath || null,
      trackIds: tracks.map((track) => track.id),
      href: "playlist.html?type=all",
      shareUrl: "/playlist.html?type=all",
    },
    {
      id: "playlist:latest-releases",
      type: "latest-releases",
      title: "Latest Releases",
      slug: "latest-releases",
      description: "Newest tracks ordered by release date.",
      coverPath: releases[0]?.coverPath || null,
      trackIds: tracks
        .filter((track) => Boolean(track.sortDate))
        .map((track) => track.id),
      href: "playlist.html?type=latest",
      shareUrl: "/playlist.html?type=latest",
    },
    ...artists.map((artist) => ({
      id: `playlist:artist:${artist.slug}`,
      type: "artist",
      title: artist.name,
      slug: artist.slug,
      artistSlug: artist.slug,
      description: `Full playlist for ${artist.name}.`,
      coverPath: artist.coverPath,
      trackIds: artist.trackIds,
      href: `playlist.html?type=artist&slug=${encodeURIComponent(artist.slug)}`,
      shareUrl: `/playlist.html?type=artist&slug=${encodeURIComponent(artist.slug)}`,
    })),
  ];

  return {
    generatedAt: new Date().toISOString(),
    source: "scripts/generate-library.js",
    stats: {
      artistCount: artists.length,
      releaseCount: releases.length,
      trackCount: tracks.length,
      playlistCount: playlists.length,
    },
    artists,
    releases,
    tracks,
    playlists,
    warnings,
  };
}

function main() {
  if (!fs.existsSync(MUSICS_DIR)) {
    console.error(`Missing musics directory: ${MUSICS_DIR}`);
    process.exit(1);
  }

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const library = buildLibrary();
  fs.writeFileSync(OUTPUT_FILE, `${JSON.stringify(library, null, 2)}\n`, "utf8");

  console.log(`Generated ${path.relative(ROOT_DIR, OUTPUT_FILE)}`);
  console.log(
    `Artists: ${library.stats.artistCount}, releases: ${library.stats.releaseCount}, tracks: ${library.stats.trackCount}, playlists: ${library.stats.playlistCount}`
  );

  if (library.warnings.length > 0) {
    console.log(`Warnings: ${library.warnings.length}`);
    for (const warning of library.warnings) {
      console.log(`- ${warning}`);
    }
  }
}

main();
