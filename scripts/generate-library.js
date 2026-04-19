#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");

const ROOT_DIR = path.resolve(__dirname, "..");
const MUSICS_DIR = path.join(ROOT_DIR, "musics");
const OUTPUT_DIR = path.join(ROOT_DIR, "data");
const OUTPUT_FILE = path.join(OUTPUT_DIR, "library.json");

const AUDIO_EXTENSIONS = new Set([".mp3", ".wav", ".ogg", ".m4a", ".flac", ".aac"]);
const COVER_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp", ".avif"]);
const TEXT_EXTENSIONS = new Set([".txt"]);
const RELEASE_INFO_PRIORITY = ["release.txt", "ep.txt", "album.txt", "lp.txt", "infos.txt"];
const CYRILLIC_TO_LATIN = {
  а: "a",
  б: "b",
  в: "v",
  г: "g",
  д: "d",
  е: "e",
  ё: "e",
  ж: "j",
  з: "z",
  и: "i",
  й: "i",
  к: "k",
  л: "l",
  м: "m",
  н: "n",
  о: "o",
  п: "p",
  р: "r",
  с: "s",
  т: "t",
  у: "u",
  ф: "f",
  х: "kh",
  ц: "ts",
  ч: "tch",
  ш: "ch",
  щ: "shch",
  ы: "y",
  э: "e",
  ю: "you",
  я: "ya",
  ь: "",
  ъ: "",
};

function transliterateToLatin(value) {
  return [...String(value || "")]
    .map((character) => CYRILLIC_TO_LATIN[character] ?? character)
    .join("");
}

function slugify(value) {
  return transliterateToLatin(String(value || "").toLowerCase())
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{Letter}\p{Number}]+/gu, "-")
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
  if (!filePath || !fs.existsSync(filePath)) {
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

function toWebPath(absolutePath) {
  return path.relative(ROOT_DIR, absolutePath).split(path.sep).join("/");
}

function parseGenres(...values) {
  const genres = [];

  for (const value of values) {
    const source = String(value || "").trim();
    if (!source) {
      continue;
    }

    genres.push(
      ...source
        .split(/[;,|]/)
        .map((part) => prettifyName(part))
        .filter(Boolean)
    );
  }

  return [...new Set(genres)];
}

function getSortableDate(...candidates) {
  for (const candidate of candidates) {
    if (candidate && /^\d{4}-\d{2}-\d{2}$/.test(candidate)) {
      return candidate;
    }
  }

  return null;
}

function getStem(fileName) {
  return path.basename(fileName, path.extname(fileName));
}

function findCompanionTextFile(audioFile, textFiles) {
  const audioStem = getStem(audioFile).toLowerCase();
  return textFiles.find((textFile) => getStem(textFile).toLowerCase() === audioStem) || null;
}

function pickReleaseInfoFile(textFiles, usedTrackTextFiles) {
  const remaining = textFiles.filter((fileName) => !usedTrackTextFiles.has(fileName));
  if (remaining.length === 0) {
    return null;
  }

  for (const candidate of RELEASE_INFO_PRIORITY) {
    const match = remaining.find((fileName) => fileName.toLowerCase() === candidate);
    if (match) {
      return match;
    }
  }

  if (remaining.length === 1) {
    return remaining[0];
  }

  return null;
}

function getFirstNonEmpty(...values) {
  for (const value of values) {
    if (value !== undefined && value !== null && String(value).trim() !== "") {
      return value;
    }
  }

  return null;
}

function getCommonNonEmpty(items, key) {
  const values = [...new Set(
    items
      .map((item) => item?.[key])
      .filter((value) => value !== undefined && value !== null && String(value).trim() !== "")
  )];

  return values.length === 1 ? values[0] : null;
}

function parseTrackNumber(value, fallback) {
  const parsed = Number.parseInt(String(value || "").trim(), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseBooleanFlag(value) {
  const normalized = String(value || "").trim().toLowerCase();

  if (["yes", "true", "1"].includes(normalized)) {
    return true;
  }

  if (["no", "false", "0"].includes(normalized)) {
    return false;
  }

  return null;
}

function parseDurationToSeconds(value) {
  const source = String(value || "").trim();
  if (!source) {
    return null;
  }

  const parts = source.split(":").map((part) => Number.parseInt(part, 10));
  if (parts.some((part) => !Number.isFinite(part) || part < 0)) {
    return null;
  }

  if (parts.length === 3) {
    return parts[0] * 3600 + parts[1] * 60 + parts[2];
  }

  if (parts.length === 2) {
    return parts[0] * 60 + parts[1];
  }

  if (parts.length === 1) {
    return parts[0];
  }

  return null;
}

function sumDurations(items) {
  const durations = items
    .map((item) => item?.duration)
    .filter((duration) => Number.isFinite(duration) && duration > 0);

  if (durations.length === 0) {
    return null;
  }

  return durations.reduce((total, duration) => total + duration, 0);
}

function compareByDateDesc(left, right) {
  const rightDate = right.sortDate || "";
  const leftDate = left.sortDate || "";

  return (
    rightDate.localeCompare(leftDate) ||
    String(left.title || "").localeCompare(String(right.title || ""), "en")
  );
}

function compareTracks(left, right) {
  const rightDate = right.sortDate || "";
  const leftDate = left.sortDate || "";

  return (
    rightDate.localeCompare(leftDate) ||
    String(left.releaseTitle || "").localeCompare(String(right.releaseTitle || ""), "en") ||
    (left.trackNumber || 0) - (right.trackNumber || 0) ||
    String(left.title || "").localeCompare(String(right.title || ""), "en")
  );
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

function inferReleaseType(explicitValue, trackCount) {
  const normalized = String(explicitValue || "").trim().toLowerCase();

  if (normalized.includes("album")) {
    return "Album";
  }

  if (normalized.endsWith(" ep") || normalized === "ep" || normalized.includes(" ep ")) {
    return "EP";
  }

  if (normalized.endsWith(" lp") || normalized === "lp" || normalized.includes(" lp ")) {
    return "LP";
  }

  if (trackCount === 1) {
    return "Single";
  }

  return "Release";
}

function buildLibrary() {
  const artistEntries = readDirectoryEntries(MUSICS_DIR)
    .filter((entry) => entry.isDirectory())
    .sort((left, right) => left.name.localeCompare(right.name, "en"));

  const artistsBase = [];
  const releases = [];
  const tracks = [];
  const warnings = [];
  const usedTrackIds = new Set();

  for (const artistEntry of artistEntries) {
    const artistFolderName = artistEntry.name;
    const artistName = prettifyName(artistFolderName);
    const artistSlug = slugify(artistFolderName);
    const artistDirectory = path.join(MUSICS_DIR, artistFolderName);

    artistsBase.push({
      id: `artist:${artistSlug}`,
      name: artistName,
      slug: artistSlug,
      path: toWebPath(artistDirectory),
    });

    const releaseEntries = readDirectoryEntries(artistDirectory)
      .filter((entry) => entry.isDirectory())
      .sort((left, right) => left.name.localeCompare(right.name, "en"));

    for (const releaseEntry of releaseEntries) {
      const releaseFolderName = releaseEntry.name;
      const releaseDirectory = path.join(artistDirectory, releaseFolderName);
      const audioFiles = pickFiles(releaseDirectory, AUDIO_EXTENSIONS);

      if (audioFiles.length === 0) {
        warnings.push(`Skipped "${artistFolderName}/${releaseFolderName}" because no audio file was found.`);
        continue;
      }

      const coverFiles = pickFiles(releaseDirectory, COVER_EXTENSIONS);
      const textFiles = pickFiles(releaseDirectory, TEXT_EXTENSIONS);
      const usedTrackTextFiles = new Set();

      const trackDrafts = audioFiles.map((audioFile, index) => {
        const textFile = findCompanionTextFile(audioFile, textFiles);
        if (textFile) {
          usedTrackTextFiles.add(textFile);
        }

        return {
          audioFile,
          audioStem: getStem(audioFile),
          fallbackIndex: index + 1,
          textFile,
          rawInfo: parseInfoFile(textFile ? path.join(releaseDirectory, textFile) : null),
        };
      });

      const releaseInfoFile = pickReleaseInfoFile(textFiles, usedTrackTextFiles);
      const releaseInfo = parseInfoFile(releaseInfoFile ? path.join(releaseDirectory, releaseInfoFile) : null);
      const trackInfos = trackDrafts.map((draft) => ({ ...releaseInfo, ...draft.rawInfo }));
      const releaseSlug = slugify(releaseFolderName);
      const releaseId = `release:${artistSlug}:${releaseSlug}`;
      const releaseArtist = prettifyName(getFirstNonEmpty(releaseInfo.artist, getCommonNonEmpty(trackInfos, "artist"), artistName));
      const rawReleaseTitle = getFirstNonEmpty(
        releaseInfo.release_title,
        releaseInfo["ep-lp"],
        getCommonNonEmpty(trackInfos, "release_title"),
        getCommonNonEmpty(trackInfos, "ep-lp"),
        releaseFolderName
      );
      const releaseTitle = prettifyName(rawReleaseTitle);
      const dateOfCreation = getFirstNonEmpty(releaseInfo.date_of_creation, getCommonNonEmpty(trackInfos, "date_of_creation"));
      const dateOfRelease = getFirstNonEmpty(releaseInfo.date_of_release, getCommonNonEmpty(trackInfos, "date_of_release"));
      const genres = parseGenres(
        releaseInfo.genre,
        ...trackInfos.map((trackInfo) => trackInfo.genre)
      );
      const sortDate = getSortableDate(dateOfRelease, dateOfCreation);
      const coverPath = coverFiles.length > 0 ? toWebPath(path.join(releaseDirectory, coverFiles[0])) : null;
      const releaseType = inferReleaseType(
        getFirstNonEmpty(releaseInfo.release_type, releaseInfo["ep-lp"], getCommonNonEmpty(trackInfos, "ep-lp")),
        audioFiles.length
      );

      const trackRecords = trackDrafts
        .map((draft) => {
          const info = { ...releaseInfo, ...draft.rawInfo };
          const trackArtist = prettifyName(getFirstNonEmpty(info.artist, releaseArtist, artistName));
          const rawTrackTitle = getFirstNonEmpty(info.title, info.track_title, draft.audioStem);
          const trackTitle = prettifyName(rawTrackTitle);
          const fullTitle = prettifyName(getFirstNonEmpty(info.fullname, `${trackArtist} - ${rawTrackTitle}`));
          const originalArtist = prettifyName(getFirstNonEmpty(info.ogartist, info.original_artist, ""));
          const normalizedOriginalArtist = originalArtist && slugify(originalArtist) !== slugify(trackArtist) ? originalArtist : null;
          const trackSlug = slugify(trackTitle || draft.audioStem);
          const trackNumber = parseTrackNumber(
            getFirstNonEmpty(info.nberofthetrack, info.track_number),
            draft.fallbackIndex
          );
          const trackGenres = parseGenres(info.genre, ...genres);
          const trackDateOfCreation = getFirstNonEmpty(info.date_of_creation, dateOfCreation);
          const trackDateOfRelease = getFirstNonEmpty(info.date_of_release, dateOfRelease);
          const trackSortDate = getSortableDate(trackDateOfRelease, trackDateOfCreation, sortDate);
          const trackDuration = parseDurationToSeconds(getFirstNonEmpty(info.duration, info.length));
          const trackId = ensureUniqueId(
            `track:${artistSlug}:${releaseSlug}:${String(trackNumber).padStart(2, "0")}-${trackSlug}`,
            usedTrackIds
          );

          if (!draft.textFile && !releaseInfoFile) {
            warnings.push(`"${artistFolderName}/${releaseFolderName}/${draft.audioFile}" has no companion metadata file.`);
          }

          return {
            id: trackId,
            slug: trackSlug,
            title: trackTitle,
            fullTitle,
            artist: trackArtist,
            artistSlug,
            artistId: `artist:${artistSlug}`,
            originalArtist: normalizedOriginalArtist,
            isRemix: parseBooleanFlag(info.remix),
            releaseId,
            releaseSlug,
            releaseTitle,
            releaseType,
            audioPath: toWebPath(path.join(releaseDirectory, draft.audioFile)),
            coverPath,
            infoPath: draft.textFile ? toWebPath(path.join(releaseDirectory, draft.textFile)) : null,
            dateOfCreation: trackDateOfCreation || null,
            dateOfRelease: trackDateOfRelease || null,
            genre: trackGenres[0] || null,
            genres: trackGenres,
            sortDate: trackSortDate,
            duration: trackDuration,
            trackNumber,
            href: `release.html?artist=${encodeURIComponent(artistSlug)}&release=${encodeURIComponent(releaseSlug)}`,
            shareUrl: `/release.html?artist=${encodeURIComponent(artistSlug)}&release=${encodeURIComponent(releaseSlug)}`,
          };
        })
        .sort((left, right) => {
          return (
            (left.trackNumber || 0) - (right.trackNumber || 0) ||
            String(left.title || "").localeCompare(String(right.title || ""), "en")
          );
        });

      const releaseTrackIds = trackRecords.map((track) => track.id);
      const originalArtists = [...new Set(trackRecords.map((track) => track.originalArtist).filter(Boolean))];

      tracks.push(...trackRecords);
      releases.push({
        id: releaseId,
        slug: releaseSlug,
        title: releaseTitle,
        artist: releaseArtist,
        artistSlug,
        artistId: `artist:${artistSlug}`,
        coverPath,
        dateOfCreation: dateOfCreation || null,
        dateOfRelease: dateOfRelease || null,
        genre: genres[0] || null,
        genres,
        releaseType,
        trackCount: releaseTrackIds.length,
        duration: sumDurations(trackRecords),
        originalArtists,
        infoPath: releaseInfoFile ? toWebPath(path.join(releaseDirectory, releaseInfoFile)) : null,
        path: toWebPath(releaseDirectory),
        sortDate,
        trackIds: releaseTrackIds,
        primaryTrackId: releaseTrackIds[0] || null,
        href: `release.html?artist=${encodeURIComponent(artistSlug)}&release=${encodeURIComponent(releaseSlug)}`,
      });
    }
  }

  releases.sort(compareByDateDesc);
  tracks.sort(compareTracks);

  const artists = artistsBase
    .map((artistBase) => {
      const releasesForArtist = releases.filter((release) => release.artistSlug === artistBase.slug);
      const trackIds = releasesForArtist.flatMap((release) => release.trackIds);
      const genres = [...new Set(releasesForArtist.flatMap((release) => release.genres))].sort((left, right) => left.localeCompare(right, "en"));
      const latestReleaseWithCover = releasesForArtist.find((release) => Boolean(release.coverPath));

      return {
        ...artistBase,
        coverPath: latestReleaseWithCover?.coverPath || null,
        genres,
        releaseIds: releasesForArtist.map((release) => release.id),
        trackIds,
        releaseCount: releasesForArtist.length,
        trackCount: trackIds.length,
        latestReleaseDate: releasesForArtist[0]?.sortDate || null,
        href: `artist.html?slug=${encodeURIComponent(artistBase.slug)}`,
        playlistHref: `playlist.html?type=artist&slug=${encodeURIComponent(artistBase.slug)}`,
      };
    })
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
      duration: sumDurations(tracks),
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
      duration: sumDurations(tracks.filter((track) => Boolean(track.sortDate))),
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
      duration: sumDurations(artist.trackIds.map((trackId) => tracks.find((track) => track.id === trackId))),
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
