export const SITE_NAME = "FK Soundcloud";
const TOAST_DURATION = 2200;

export function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function formatDate(value) {
  if (!value) {
    return "Unknown date";
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("fr-FR", {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(parsed);
}

export function formatTime(totalSeconds) {
  if (!Number.isFinite(totalSeconds) || totalSeconds < 0) {
    return "0:00";
  }

  const minutes = Math.floor(totalSeconds / 60);
  const seconds = Math.floor(totalSeconds % 60);
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

export function pluralize(count, singular, plural = `${singular}s`) {
  return `${count} ${count > 1 ? plural : singular}`;
}

export function getQueryParams() {
  return new URLSearchParams(window.location.search);
}

export function getBasePath() {
  const { pathname } = window.location;

  if (pathname.endsWith("/")) {
    return pathname;
  }

  const lastSlashIndex = pathname.lastIndexOf("/");
  return lastSlashIndex >= 0 ? pathname.slice(0, lastSlashIndex + 1) : "/";
}

export function buildAppUrl(relativePath = "") {
  const normalized = String(relativePath || "").replace(/^\//, "");
  return new URL(normalized, `${window.location.origin}${getBasePath()}`).toString();
}

export function createArtworkMarkup(item, options = {}) {
  const title = escapeHtml(item?.title || item?.name || "Artwork");
  const subtitle = escapeHtml(item?.artist || item?.subtitle || "");
  const sizeClass = options.sizeClass ? ` ${options.sizeClass}` : "";
  const shapeClass = options.round ? " artwork--round" : "";
  const coverPath = item?.coverPath ? buildAppUrl(item.coverPath) : "";
  const initials = escapeHtml((item?.artist || item?.name || item?.title || "?").slice(0, 2).toUpperCase());

  if (coverPath) {
    return `
      <div class="artwork${sizeClass}${shapeClass}">
        <img src="${coverPath}" alt="${title}" loading="lazy">
      </div>
    `;
  }

  return `
    <div class="artwork artwork--fallback${sizeClass}${shapeClass}" aria-label="${title}">
      <span>${initials}</span>
      <small>${subtitle}</small>
    </div>
  `;
}

export function setMeta({ title, description, image } = {}) {
  const fullTitle = title ? `${title} | ${SITE_NAME}` : SITE_NAME;
  document.title = fullTitle;

  updateMetaTag("name", "description", description || "Personal audio library built for smooth listening.");
  updateMetaTag("property", "og:title", fullTitle);
  updateMetaTag("property", "og:description", description || "Personal audio library built for smooth listening.");
  updateMetaTag("property", "og:url", window.location.href);
  updateMetaTag("property", "og:image", image ? buildAppUrl(image) : buildAppUrl("assets/icons/favicon.svg"));
}

function updateMetaTag(attribute, name, content) {
  let tag = document.head.querySelector(`meta[${attribute}="${name}"]`);

  if (!tag) {
    tag = document.createElement("meta");
    tag.setAttribute(attribute, name);
    document.head.append(tag);
  }

  tag.setAttribute("content", content);
}

export function unique(items) {
  return [...new Set(items.filter(Boolean))];
}

export function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

export function sortByDateDesc(items, key = "sortDate") {
  return [...items].sort((left, right) => {
    const rightDate = right?.[key] || "";
    const leftDate = left?.[key] || "";
    return rightDate.localeCompare(leftDate) || String(left?.title || left?.name || "").localeCompare(String(right?.title || right?.name || ""), "fr");
  });
}

export function getToastRoot() {
  return document.querySelector("#toast-stack");
}

export function showToast(message) {
  const root = getToastRoot();
  if (!root) {
    return;
  }

  const node = document.createElement("div");
  node.className = "toast";
  node.textContent = message;
  root.append(node);

  window.setTimeout(() => {
    node.classList.add("toast--leaving");
    window.setTimeout(() => node.remove(), 220);
  }, TOAST_DURATION);
}

export async function copyText(value, feedback = "Lien copie") {
  try {
    await navigator.clipboard.writeText(value);
    showToast(feedback);
    return true;
  } catch (error) {
    showToast("Impossible de copier le lien");
    return false;
  }
}

export async function shareLink({ title, text, path }) {
  const url = buildAppUrl(path);

  if (navigator.share) {
    try {
      await navigator.share({ title, text, url });
      return true;
    } catch (error) {
      if (error?.name === "AbortError") {
        return false;
      }
    }
  }

  return copyText(url);
}

export function debounce(callback, delay) {
  let timeoutId = null;

  return (...args) => {
    window.clearTimeout(timeoutId);
    timeoutId = window.setTimeout(() => callback(...args), delay);
  };
}

export function resolveReleasePath(artistSlug, releaseSlug) {
  return `release.html?artist=${encodeURIComponent(artistSlug)}&release=${encodeURIComponent(releaseSlug)}`;
}

export function resolveArtistPath(artistSlug) {
  return `artist.html?slug=${encodeURIComponent(artistSlug)}`;
}

export function resolvePlaylistPath(type, slug = "") {
  const params = new URLSearchParams({ type });

  if (slug) {
    params.set("slug", slug);
  }

  return `playlist.html?${params.toString()}`;
}
