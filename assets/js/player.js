import { buildAppUrl, clamp, createArtworkMarkup, escapeHtml, formatTime } from "./utils.js";

const STORAGE_KEY = "fk-soundcloud-player";

export class AudioPlayer {
  constructor({ root, library, onToast }) {
    this.root = root;
    this.library = library;
    this.onToast = onToast;
    this.audio = new Audio();
    this.audio.preload = "metadata";
    this.queue = [];
    this.currentIndex = -1;
    this.currentTrack = null;
    this.repeatMode = "off";
    this.shuffle = false;
    this.volume = 0.86;
    this.muted = false;
    this.lastSavedAt = 0;
    this.inlinePanels = new Set();
    this.lastTrackMarkupKey = "";
    this.lastQueueRenderKey = "";

    this.render();
    this.bindEvents();
    this.restoreState();
    this.syncUI();
  }

  render() {
    this.root.innerHTML = `
      <section class="player" aria-label="Global audio player">
        <div class="player__surface">
          <div class="player__track" data-player-track>
            ${createArtworkMarkup({ title: "No track selected", artist: "", coverPath: null }, { sizeClass: "artwork--player" })}
            <div class="player__copy">
              <strong>No track selected</strong>
              <span>Choose a release to start listening.</span>
            </div>
          </div>

          <div class="player__center">
            <div class="player__controls">
              <button type="button" class="icon-button" data-player-action="shuffle" aria-label="Shuffle">
                ${iconShuffle()}
              </button>
              <button type="button" class="icon-button icon-button--lg" data-player-action="previous" aria-label="Previous track">
                ${iconPrevious()}
              </button>
              <button type="button" class="icon-button icon-button--accent icon-button--xl" data-player-action="toggle" aria-label="Play or pause">
                <span data-player-toggle-icon>${iconPlay()}</span>
              </button>
              <button type="button" class="icon-button icon-button--lg" data-player-action="next" aria-label="Next track">
                ${iconNext()}
              </button>
              <button type="button" class="icon-button" data-player-action="repeat" aria-label="Repeat mode">
                <span data-player-repeat-icon>${iconRepeat()}</span>
              </button>
            </div>

            <div class="player__progress">
              <span data-player-current-time>0:00</span>
              <input type="range" min="0" max="1000" value="0" step="1" data-player-seek aria-label="Seek">
              <span data-player-duration>0:00</span>
            </div>
          </div>

          <div class="player__side">
            <button type="button" class="icon-button" data-player-action="mute" aria-label="Mute">
              <span data-player-mute-icon>${iconVolume()}</span>
            </button>
            <input type="range" min="0" max="100" step="1" value="${Math.round(this.volume * 100)}" data-player-volume aria-label="Volume">
            <button type="button" class="icon-button" data-player-action="queue" aria-label="Open queue">
              ${iconQueue()}
            </button>
          </div>
        </div>

        <div class="player__queue" data-player-queue hidden></div>
      </section>
    `;

    this.elements = {
      seek: this.root.querySelector("[data-player-seek]"),
      currentTime: this.root.querySelector("[data-player-current-time]"),
      duration: this.root.querySelector("[data-player-duration]"),
      volume: this.root.querySelector("[data-player-volume]"),
      toggleIcon: this.root.querySelector("[data-player-toggle-icon]"),
      muteIcon: this.root.querySelector("[data-player-mute-icon]"),
      repeatIcon: this.root.querySelector("[data-player-repeat-icon]"),
      queue: this.root.querySelector("[data-player-queue]"),
      trackWrap: this.root.querySelector("[data-player-track]"),
    };
  }

  bindEvents() {
    this.root.addEventListener("click", (event) => {
      const button = event.target.closest("[data-player-action]");
      const queueTrack = event.target.closest("[data-queue-track-id]");

      if (queueTrack) {
        this.playTrack(queueTrack.dataset.queueTrackId, { autoplay: true });
        return;
      }

      if (!button) {
        return;
      }

      switch (button.dataset.playerAction) {
        case "toggle":
          this.togglePlayback();
          break;
        case "previous":
          this.previous();
          break;
        case "next":
          this.next();
          break;
        case "shuffle":
          this.toggleShuffle();
          break;
        case "repeat":
          this.cycleRepeatMode();
          break;
        case "mute":
          this.toggleMute();
          break;
        case "queue":
          this.toggleQueue();
          break;
        default:
          break;
      }
    });

    this.elements.seek.addEventListener("input", () => {
      if (!this.audio.duration) {
        return;
      }

      const value = Number(this.elements.seek.value) / 1000;
      this.audio.currentTime = value * this.audio.duration;
      this.syncUI();
      this.updateMediaPositionState();
    });

    this.elements.volume.addEventListener("input", () => {
      this.setVolume(Number(this.elements.volume.value) / 100);
    });

    this.audio.addEventListener("timeupdate", () => {
      this.syncUI();
      this.updateMediaPositionState();
      this.saveStateThrottled();
    });

    this.audio.addEventListener("loadedmetadata", () => {
      this.syncUI();
      this.updateMediaPositionState();
      this.broadcastState();
    });

    this.audio.addEventListener("play", () => {
      this.syncUI();
      this.updateMediaSession();
      this.broadcastState();
      this.saveState();
    });

    this.audio.addEventListener("pause", () => {
      this.syncUI();
      this.updateMediaSession();
      this.broadcastState();
      this.saveState();
    });

    this.audio.addEventListener("ended", () => {
      if (this.repeatMode === "one" && this.currentTrack) {
        this.audio.currentTime = 0;
        void this.play();
        return;
      }

      if (this.shuffle) {
        this.playRandomTrack();
        return;
      }

      if (this.currentIndex < this.queue.length - 1) {
        this.currentIndex += 1;
        void this.loadCurrent({ autoplay: true });
        return;
      }

      if (this.repeatMode === "all" && this.queue.length > 0) {
        this.currentIndex = 0;
        void this.loadCurrent({ autoplay: true });
      } else {
        this.updateMediaSession();
        this.broadcastState();
        this.saveState();
      }
    });

    document.addEventListener("keydown", (event) => {
      const target = event.target;
      const isTyping = target instanceof HTMLElement && ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);

      if (isTyping) {
        return;
      }

      if (event.code === "Space" || event.code === "MediaPlayPause") {
        event.preventDefault();
        this.togglePlayback();
      }

      if (event.code === "ArrowRight") {
        event.preventDefault();
        this.seekBy(5);
      }

      if (event.code === "ArrowLeft") {
        event.preventDefault();
        this.seekBy(-5);
      }

      if (event.code === "MediaTrackNext") {
        event.preventDefault();
        this.next();
      }

      if (event.code === "MediaTrackPrevious") {
        event.preventDefault();
        this.previous();
      }
    });

    window.addEventListener("beforeunload", () => this.saveState());
    window.addEventListener("pagehide", () => this.saveState());
  }

  restoreState() {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) {
        this.audio.volume = this.volume;
        return;
      }

      const state = JSON.parse(raw);
      this.queue = (state.queue || []).filter((trackId) => this.library.trackMap.has(trackId));
      this.currentIndex = this.queue.findIndex((trackId) => trackId === state.currentTrackId);
      this.repeatMode = ["off", "all", "one"].includes(state.repeatMode) ? state.repeatMode : "off";
      this.shuffle = Boolean(state.shuffle);
      this.volume = clamp(Number(state.volume) || this.volume, 0, 1);
      this.muted = Boolean(state.muted);
      this.audio.volume = this.volume;
      this.audio.muted = this.muted;

      if (this.currentIndex >= 0) {
        void this.loadCurrent({
          announce: false,
          autoplay: Boolean(state.isPlaying),
          broadcast: false,
          restoreTime: Number(state.currentTime) || 0,
        });
      }
    } catch (error) {
      console.warn("Unable to restore player state.", error);
    }
  }

  saveStateThrottled() {
    const now = Date.now();
    if (now - this.lastSavedAt < 1200) {
      return;
    }

    this.lastSavedAt = now;
    this.saveState();
  }

  saveState() {
    const snapshot = {
      queue: this.queue,
      currentTrackId: this.currentTrack?.id || null,
      currentTime: this.audio.currentTime || 0,
      volume: this.audio.volume,
      muted: this.audio.muted,
      repeatMode: this.repeatMode,
      shuffle: this.shuffle,
      isPlaying: Boolean(this.currentTrack && !this.audio.paused),
    };

    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
  }

  setQueue(trackIds, startTrackId, options = {}) {
    const validTrackIds = (trackIds || []).filter((trackId) => this.library.trackMap.has(trackId));
    if (validTrackIds.length === 0) {
      return;
    }

    this.queue = validTrackIds;
    this.currentIndex = Math.max(0, validTrackIds.findIndex((trackId) => trackId === startTrackId));
    this.lastQueueRenderKey = "";
    void this.loadCurrent({
      autoplay: options.autoplay !== false,
      announce: options.announce !== false,
    });
  }

  playTrack(trackId, options = {}) {
    if (!trackId || !this.library.trackMap.has(trackId)) {
      return;
    }

    const queue = options.queue && options.queue.length > 0 ? options.queue : this.queue;

    if (!queue.includes(trackId)) {
      this.queue = [trackId];
      this.currentIndex = 0;
    } else {
      this.queue = queue;
      this.currentIndex = queue.findIndex((id) => id === trackId);
    }

    this.lastQueueRenderKey = "";
    void this.loadCurrent({
      autoplay: options.autoplay !== false,
      announce: options.announce !== false,
      restoreTime: options.restoreTime || 0,
    });
  }

  async loadCurrent({ autoplay = false, announce = true, restoreTime = 0, broadcast = true } = {}) {
    const trackId = this.queue[this.currentIndex];
    const track = this.library.getTrackById(trackId);

    if (!track) {
      return;
    }

    this.currentTrack = track;
    const nextSource = buildAppUrl(track.audioPath);

    if (this.audio.src !== nextSource) {
      this.audio.src = nextSource;
      this.audio.load();
    }

    if (restoreTime > 0) {
      const applyRestoreTime = () => {
        this.audio.currentTime = restoreTime;
      };

      if (this.audio.readyState >= 1) {
        applyRestoreTime();
      } else {
        this.audio.addEventListener("loadedmetadata", applyRestoreTime, { once: true });
      }
    } else {
      this.audio.currentTime = 0;
    }

    this.audio.volume = this.volume;
    this.audio.muted = this.muted;
    this.updateMediaSession();
    this.syncUI();

    if (announce) {
      this.onToast?.(`${track.title} - ${track.artist}`);
    }

    if (autoplay) {
      await this.play();
    }

    if (broadcast) {
      this.broadcastState();
    }

    this.saveState();
  }

  async play() {
    try {
      await this.audio.play();
    } catch (error) {
      console.warn("Playback start prevented by the browser.", error);
      this.onToast?.("Playback needs a user interaction on this device");
    }
  }

  pause() {
    this.audio.pause();
  }

  togglePlayback() {
    if (!this.currentTrack && this.library.tracks.length > 0) {
      this.setQueue(this.library.tracks.map((track) => track.id), this.library.tracks[0].id, { autoplay: true });
      return;
    }

    if (this.audio.paused) {
      void this.play();
    } else {
      this.pause();
    }
  }

  next() {
    if (this.queue.length === 0) {
      return;
    }

    if (this.shuffle) {
      this.playRandomTrack();
      return;
    }

    if (this.currentIndex < this.queue.length - 1) {
      this.currentIndex += 1;
    } else if (this.repeatMode === "all") {
      this.currentIndex = 0;
    } else {
      return;
    }

    this.lastQueueRenderKey = "";
    void this.loadCurrent({ autoplay: true });
  }

  previous() {
    if (this.audio.currentTime > 3) {
      this.audio.currentTime = 0;
      this.syncUI();
      this.updateMediaPositionState();
      return;
    }

    if (this.queue.length === 0) {
      return;
    }

    if (this.currentIndex > 0) {
      this.currentIndex -= 1;
    } else if (this.repeatMode === "all") {
      this.currentIndex = this.queue.length - 1;
    } else {
      this.audio.currentTime = 0;
      this.syncUI();
      this.updateMediaPositionState();
      return;
    }

    this.lastQueueRenderKey = "";
    void this.loadCurrent({ autoplay: true });
  }

  seekBy(delta) {
    if (!this.audio.duration) {
      return;
    }

    this.audio.currentTime = clamp(this.audio.currentTime + delta, 0, this.audio.duration);
    this.syncUI();
    this.updateMediaPositionState();
    this.saveState();
  }

  setVolume(value) {
    this.volume = clamp(value, 0, 1);
    this.audio.volume = this.volume;
    this.muted = this.volume === 0 ? true : this.audio.muted;

    if (this.volume > 0 && this.audio.muted) {
      this.audio.muted = false;
      this.muted = false;
    }

    this.syncUI();
    this.broadcastState();
    this.saveState();
  }

  toggleMute() {
    this.audio.muted = !this.audio.muted;
    this.muted = this.audio.muted;
    this.syncUI();
    this.broadcastState();
    this.saveState();
  }

  toggleShuffle() {
    this.shuffle = !this.shuffle;
    this.syncUI();
    this.broadcastState();
    this.saveState();
  }

  cycleRepeatMode() {
    const order = ["off", "all", "one"];
    const nextIndex = (order.indexOf(this.repeatMode) + 1) % order.length;
    this.repeatMode = order[nextIndex];
    this.syncUI();
    this.broadcastState();
    this.saveState();
  }

  playRandomTrack() {
    if (this.queue.length === 0) {
      return;
    }

    if (this.queue.length === 1) {
      void this.loadCurrent({ autoplay: true });
      return;
    }

    let nextIndex = this.currentIndex;
    while (nextIndex === this.currentIndex) {
      nextIndex = Math.floor(Math.random() * this.queue.length);
    }

    this.currentIndex = nextIndex;
    this.lastQueueRenderKey = "";
    void this.loadCurrent({ autoplay: true });
  }

  toggleQueue() {
    const isHidden = this.elements.queue.hasAttribute("hidden");
    if (isHidden) {
      this.elements.queue.removeAttribute("hidden");
      this.renderQueue(true);
    } else {
      this.elements.queue.setAttribute("hidden", "");
    }
  }

  renderQueue(force = false) {
    const renderKey = `${this.queue.join("|")}::${this.currentTrack?.id || ""}::${this.currentIndex}`;

    if (!force && renderKey === this.lastQueueRenderKey) {
      return;
    }

    this.lastQueueRenderKey = renderKey;

    if (this.queue.length === 0) {
      this.elements.queue.innerHTML = `<p class="queue__empty">Queue is empty.</p>`;
      return;
    }

    this.elements.queue.innerHTML = this.queue
      .map((trackId, index) => {
        const track = this.library.getTrackById(trackId);
        if (!track) {
          return "";
        }

        return `
          <button type="button" class="queue__item${track.id === this.currentTrack?.id ? " is-active" : ""}" data-queue-track-id="${track.id}">
            ${createArtworkMarkup(track, { sizeClass: "artwork--queue" })}
            <span>
              <strong>${escapeHtml(track.title)}</strong>
              <small>${escapeHtml(track.artist)}${index === this.currentIndex ? " - Playing" : ""}</small>
            </span>
          </button>
        `;
      })
      .join("");
  }

  connectInlinePanel(panel) {
    this.inlinePanels.add(panel);
    this.syncInlinePanel(panel);
  }

  disconnectInlinePanel(panel) {
    this.inlinePanels.delete(panel);
  }

  disconnectAllInlinePanels() {
    this.inlinePanels.clear();
  }

  syncInlinePanels() {
    for (const panel of this.inlinePanels) {
      this.syncInlinePanel(panel);
    }
  }

  syncInlinePanel(panel) {
    const track = this.currentTrack;
    const trackId = panel.dataset.trackId;
    const isCurrent = track?.id === trackId;
    const progress = isCurrent && this.audio.duration ? this.audio.currentTime / this.audio.duration : 0;

    const toggle = panel.querySelector("[data-inline-action='toggle']");
    const seek = panel.querySelector("[data-inline-seek]");
    const currentTime = panel.querySelector("[data-inline-current-time]");
    const duration = panel.querySelector("[data-inline-duration]");
    const volume = panel.querySelector("[data-inline-volume]");

    if (toggle) {
      toggle.innerHTML = isCurrent && !this.audio.paused ? iconPause() : iconPlay();
    }

    if (seek) {
      seek.value = String(Math.round(progress * 1000));
    }

    if (currentTime) {
      currentTime.textContent = isCurrent ? formatTime(this.audio.currentTime) : "0:00";
    }

    if (duration) {
      duration.textContent = isCurrent ? formatTime(this.audio.duration) : "0:00";
    }

    if (volume) {
      volume.value = String(Math.round(this.audio.volume * 100));
    }

    panel.classList.toggle("is-active", Boolean(isCurrent));
  }

  syncUI() {
    const track = this.currentTrack;
    const isPlaying = Boolean(track && !this.audio.paused);
    const duration = this.audio.duration || 0;
    const currentTime = this.audio.currentTime || 0;
    const progress = duration ? Math.round((currentTime / duration) * 1000) : 0;
    const trackMarkupKey = `${track?.id || ""}::${isPlaying}`;

    this.elements.currentTime.textContent = formatTime(currentTime);
    this.elements.duration.textContent = formatTime(duration);
    this.elements.seek.value = String(progress);
    this.elements.volume.value = String(Math.round(this.audio.volume * 100));
    this.elements.toggleIcon.innerHTML = isPlaying ? iconPause() : iconPlay();
    this.elements.muteIcon.innerHTML = this.audio.muted || this.audio.volume === 0 ? iconMuted() : iconVolume();
    this.elements.repeatIcon.innerHTML = this.repeatMode === "one" ? iconRepeatOne() : iconRepeat();
    this.root.querySelector("[data-player-action='shuffle']").classList.toggle("is-active", this.shuffle);
    this.root.querySelector("[data-player-action='repeat']").classList.toggle("is-active", this.repeatMode !== "off");

    if (trackMarkupKey !== this.lastTrackMarkupKey) {
      this.lastTrackMarkupKey = trackMarkupKey;
      this.elements.trackWrap.innerHTML = `
        ${createArtworkMarkup(track || { title: "No track selected", artist: "", coverPath: null }, { sizeClass: "artwork--player" })}
        <div class="player__copy">
          <strong>${escapeHtml(track?.title || "No track selected")}</strong>
          <span>${escapeHtml(track ? `${track.artist} / ${track.releaseTitle}` : "Choose a release to start listening.")}</span>
        </div>
      `;
    }

    if (!this.elements.queue.hasAttribute("hidden")) {
      this.renderQueue();
    }

    this.syncInlinePanels();
  }

  broadcastState() {
    window.dispatchEvent(
      new CustomEvent("fk:player-state", {
        detail: {
          currentTrack: this.currentTrack,
          queue: this.queue,
          index: this.currentIndex,
          isPlaying: Boolean(this.currentTrack && !this.audio.paused),
          currentTime: this.audio.currentTime || 0,
          duration: this.audio.duration || 0,
          volume: this.audio.volume,
          muted: this.audio.muted,
          shuffle: this.shuffle,
          repeatMode: this.repeatMode,
        },
      })
    );
  }

  updateMediaSession() {
    if (!("mediaSession" in navigator) || !this.currentTrack) {
      return;
    }

    navigator.mediaSession.metadata = new MediaMetadata({
      title: this.currentTrack.title,
      artist: this.currentTrack.artist,
      album: this.currentTrack.releaseTitle,
      artwork: buildArtworkDescriptors(this.currentTrack.coverPath),
    });

    navigator.mediaSession.playbackState = this.audio.paused ? "paused" : "playing";
    this.updateMediaPositionState();

    setActionHandler("play", () => this.play());
    setActionHandler("pause", () => this.pause());
    setActionHandler("previoustrack", () => this.previous());
    setActionHandler("nexttrack", () => this.next());
    setActionHandler("seekbackward", (details) => this.seekBy(-(details?.seekOffset || 10)));
    setActionHandler("seekforward", (details) => this.seekBy(details?.seekOffset || 10));
    setActionHandler("seekto", (details) => {
      if (!Number.isFinite(this.audio.duration) || typeof details?.seekTime !== "number") {
        return;
      }

      this.audio.currentTime = clamp(details.seekTime, 0, this.audio.duration);
      this.syncUI();
      this.updateMediaPositionState();
      this.saveState();
    });
  }

  updateMediaPositionState() {
    if (!("mediaSession" in navigator) || typeof navigator.mediaSession.setPositionState !== "function") {
      return;
    }

    if (!Number.isFinite(this.audio.duration) || this.audio.duration <= 0) {
      return;
    }

    try {
      navigator.mediaSession.setPositionState({
        duration: this.audio.duration,
        playbackRate: this.audio.playbackRate || 1,
        position: clamp(this.audio.currentTime || 0, 0, this.audio.duration),
      });
    } catch (error) {
      console.warn("Unable to update media session position state.", error);
    }
  }
}

function setActionHandler(name, handler) {
  try {
    navigator.mediaSession.setActionHandler(name, handler);
  } catch (error) {
    // Some browsers expose Media Session partially and reject unsupported handlers.
  }
}

function buildArtworkDescriptors(coverPath) {
  if (!coverPath) {
    return [];
  }

  const src = buildAppUrl(coverPath);
  const extension = coverPath.split(".").pop()?.toLowerCase();
  const typeMap = {
    avif: "image/avif",
    jpeg: "image/jpeg",
    jpg: "image/jpeg",
    png: "image/png",
    webp: "image/webp",
  };

  return [
    {
      src,
      sizes: "512x512",
      type: typeMap[extension] || "image/png",
    },
  ];
}

function iconPlay() {
  return `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v13l10-6.5z" fill="currentColor"/></svg>`;
}

function iconPause() {
  return `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 5h4v14H7zm6 0h4v14h-4z" fill="currentColor"/></svg>`;
}

function iconPrevious() {
  return `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 5h2v14H7zm3 7 10 7V5z" fill="currentColor"/></svg>`;
}

function iconNext() {
  return `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5h2v14h-2zM5 19l10-7L5 5z" fill="currentColor"/></svg>`;
}

function iconShuffle() {
  return `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M16 4h4v4h-2V6.6l-4.4 4.4-1.4-1.4L16.6 5H16zM4 7h3.6l5.2 5.2-1.4 1.4L7 9H4zm8.8 5.8 1.4 1.4L7.6 21H4v-2h2.8zM16 16h.6l-4.4-4.4 1.4-1.4 4.4 4.4V14h2v4h-4z" fill="currentColor"/></svg>`;
}

function iconRepeat() {
  return `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 7h10.2l-1.6-1.6L16 4l4 4-4 4-1.4-1.4L16.2 9H8v4H6zm12 10H7.8l1.6 1.6L8 20l-4-4 4-4 1.4 1.4L7.8 15H16v-4h2z" fill="currentColor"/></svg>`;
}

function iconRepeatOne() {
  return `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 7h10.2l-1.6-1.6L16 4l4 4-4 4-1.4-1.4L16.2 9H8v4H6zm12 10H7.8l1.6 1.6L8 20l-4-4 4-4 1.4 1.4L7.8 15H16v-4h2zM12 8h2v8h-2l-2-1.6 1.2-1.4.8.6z" fill="currentColor"/></svg>`;
}

function iconVolume() {
  return `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 9h4l5-4v14l-5-4H5zm12.5 3a3.5 3.5 0 0 0-2-3.15v6.3A3.5 3.5 0 0 0 17.5 12zm0-7a10.5 10.5 0 0 1 0 14.9l-1.4-1.4a8.5 8.5 0 0 0 0-12.1z" fill="currentColor"/></svg>`;
}

function iconMuted() {
  return `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 9h4l5-4v5.6l-2-2V9l-1.8 1.4H7v3h3.2l1.8 1.4v.2L10 14H5zm10.6 3 2.4 2.4-1.4 1.4-2.4-2.4-2.4 2.4-1.4-1.4 2.4-2.4-2.4-2.4 1.4-1.4 2.4 2.4 2.4-2.4 1.4 1.4z" fill="currentColor"/></svg>`;
}

function iconQueue() {
  return `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h16v2H4zm0 5h10v2H4zm0 5h10v2H4zm12-3 4 3-4 3z" fill="currentColor"/></svg>`;
}
