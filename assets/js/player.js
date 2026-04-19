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
              <span data-player-mute-icon>${getVolumeIcon(this.muted, this.volume)}</span>
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
    const effectiveDuration = (isCurrent && this.audio.duration) || (isCurrent && track?.duration) || 0;
    const progress = isCurrent && effectiveDuration ? this.audio.currentTime / effectiveDuration : 0;

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
      duration.textContent = isCurrent ? formatTime(this.audio.duration || track?.duration || 0) : "0:00";
    }

    if (volume) {
      volume.value = String(Math.round(this.audio.volume * 100));
    }

    panel.classList.toggle("is-active", Boolean(isCurrent));
  }

  syncUI() {
    const track = this.currentTrack;
    const isPlaying = Boolean(track && !this.audio.paused);
    const duration = this.audio.duration || track?.duration || 0;
    const currentTime = this.audio.currentTime || 0;
    const progress = duration ? Math.round((currentTime / duration) * 1000) : 0;
    const trackMarkupKey = `${track?.id || ""}::${isPlaying}`;

    this.elements.currentTime.textContent = formatTime(currentTime);
    this.elements.duration.textContent = formatTime(duration);
    this.elements.seek.value = String(progress);
    this.elements.volume.value = String(Math.round(this.audio.volume * 100));
    this.elements.toggleIcon.innerHTML = isPlaying ? iconPause() : iconPlay();
    this.elements.muteIcon.innerHTML = getVolumeIcon(this.audio.muted, this.audio.volume);
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

function getVolumeIcon(isMuted, volume) {
  if (isMuted || volume <= 0) {
    return iconMuted();
  }

  if (volume < 0.55) {
    return iconVolumeLow();
  }

  return iconVolumeHigh();
}

function createPlayerIcon(paths) {
  return `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true" xmlns="http://www.w3.org/2000/svg">${paths}</svg>`;
}

function iconPlay() {
  return createPlayerIcon(
    `<path d="M16.6582 9.28638C18.098 10.1862 18.8178 10.6361 19.0647 11.2122C19.2803 11.7152 19.2803 12.2847 19.0647 12.7878C18.8178 13.3638 18.098 13.8137 16.6582 14.7136L9.896 18.94C8.29805 19.9387 7.49907 20.4381 6.83973 20.385C6.26501 20.3388 5.73818 20.0469 5.3944 19.584C5 19.053 5 18.1108 5 16.2264V7.77357C5 5.88919 5 4.94701 5.3944 4.41598C5.73818 3.9531 6.26501 3.66111 6.83973 3.6149C7.49907 3.5619 8.29805 4.06126 9.896 5.05998L16.6582 9.28638Z" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>`
  );
}

function iconPause() {
  return createPlayerIcon(
    `<path d="M8 5V19M16 5V19" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`
  );
}

function iconPrevious() {
  return createPlayerIcon(
    `<path d="M7 5V19M17 7.329V16.671C17 17.7367 17 18.2695 16.7815 18.5432C16.5916 18.7812 16.3035 18.9197 15.9989 18.9194C15.6487 18.919 15.2327 18.5861 14.4005 17.9204L10.1235 14.4988C9.05578 13.6446 8.52194 13.2176 8.32866 12.7016C8.1592 12.2492 8.1592 11.7508 8.32866 11.2984C8.52194 10.7824 9.05578 10.3554 10.1235 9.50122L14.4005 6.07961C15.2327 5.41387 15.6487 5.081 15.9989 5.08063C16.3035 5.0803 16.5916 5.21876 16.7815 5.45677C17 5.73045 17 6.2633 17 7.329Z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`
  );
}

function iconNext() {
  return createPlayerIcon(
    `<path d="M17 5V19M7 7.329V16.671C7 17.7367 7 18.2695 7.21846 18.5432C7.40845 18.7812 7.69654 18.9197 8.00108 18.9194C8.35125 18.919 8.76734 18.5861 9.59951 17.9204L13.8765 14.4988C14.9442 13.6446 15.4781 13.2176 15.6713 12.7016C15.8408 12.2492 15.8408 11.7508 15.6713 11.2984C15.4781 10.7824 14.9442 10.3554 13.8765 9.50122L9.59951 6.07961C8.76734 5.41387 8.35125 5.081 8.00108 5.08063C7.69654 5.0803 7.40845 5.21876 7.21846 5.45677C7 5.73045 7 6.2633 7 7.329Z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`
  );
}

function iconShuffle() {
  return createPlayerIcon(
    `<path d="M18 4L21 7M21 7L18 10M21 7H17C16.0707 7 15.606 7 15.2196 7.07686C13.6329 7.39249 12.3925 8.63288 12.0769 10.2196C12 10.606 12 11.0707 12 12C12 12.9293 12 13.394 11.9231 13.7804C11.6075 15.3671 10.3671 16.6075 8.78036 16.9231C8.39397 17 7.92931 17 7 17H3M18 20L21 17M21 17L18 14M21 17H17C16.0707 17 15.606 17 15.2196 16.9231C15.1457 16.9084 15.0724 16.8917 15 16.873M3 7H7C7.92931 7 8.39397 7 8.78036 7.07686C8.85435 7.09158 8.92758 7.1083 9 7.12698" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`
  );
}

function iconRepeat() {
  return createPlayerIcon(
    `<path d="M18 4L21 7M21 7L18 10M21 7H7C4.79086 7 3 8.79086 3 11M6 20L3 17M3 17L6 14M3 17H17C19.2091 17 21 15.2091 21 13" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`
  );
}

function iconRepeatOne() {
  return createPlayerIcon(
    `<path d="M18 4L21 7M21 7L18 10M21 7H7C4.79086 7 3 8.79086 3 11M6 20L3 17M3 17L6 14M3 17H17C19.2091 17 21 15.2091 21 13" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M12.5 9.75V14.25M12.5 9.75L11.1 10.9" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`
  );
}

function iconVolumeLow() {
  return createPlayerIcon(
    `<path d="M18 9.00009C18.6277 9.83575 18.9996 10.8745 18.9996 12.0001C18.9996 13.1257 18.6277 14.1644 18 15.0001M6.6 9.00009H7.5012C8.05213 9.00009 8.32759 9.00009 8.58285 8.93141C8.80903 8.87056 9.02275 8.77046 9.21429 8.63566C9.43047 8.48353 9.60681 8.27191 9.95951 7.84868L12.5854 4.69758C13.0211 4.17476 13.2389 3.91335 13.4292 3.88614C13.594 3.86258 13.7597 3.92258 13.8712 4.04617C14 4.18889 14 4.52917 14 5.20973V18.7904C14 19.471 14 19.8113 13.8712 19.954C13.7597 20.0776 13.594 20.1376 13.4292 20.114C13.239 20.0868 13.0211 19.8254 12.5854 19.3026L9.95951 16.1515C9.60681 15.7283 9.43047 15.5166 9.21429 15.3645C9.02275 15.2297 8.80903 15.1296 8.58285 15.0688C8.32759 15.0001 8.05213 15.0001 7.5012 15.0001H6.6C6.03995 15.0001 5.75992 15.0001 5.54601 14.8911C5.35785 14.7952 5.20487 14.6422 5.10899 14.4541C5 14.2402 5 13.9601 5 13.4001V10.6001C5 10.04 5 9.76001 5.10899 9.54609C5.20487 9.35793 5.35785 9.20495 5.54601 9.10908C5.75992 9.00009 6.03995 9.00009 6.6 9.00009Z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`
  );
}

function iconVolumeHigh() {
  return createPlayerIcon(
    `<path d="M16.0004 9.00009C16.6281 9.83575 17 10.8745 17 12.0001C17 13.1257 16.6281 14.1644 16.0004 15.0001M18 5.29177C19.8412 6.93973 21 9.33459 21 12.0001C21 14.6656 19.8412 17.0604 18 18.7084M4.6 9.00009H5.5012C6.05213 9.00009 6.32759 9.00009 6.58285 8.93141C6.80903 8.87056 7.02275 8.77046 7.21429 8.63566C7.43047 8.48353 7.60681 8.27191 7.95951 7.84868L10.5854 4.69758C11.0211 4.17476 11.2389 3.91335 11.4292 3.88614C11.594 3.86258 11.7597 3.92258 11.8712 4.04617C12 4.18889 12 4.52917 12 5.20973V18.7904C12 19.471 12 19.8113 11.8712 19.954C11.7597 20.0776 11.594 20.1376 11.4292 20.114C11.239 20.0868 11.0211 19.8254 10.5854 19.3026L7.95951 16.1515C7.60681 15.7283 7.43047 15.5166 7.21429 15.3645C7.02275 15.2297 6.80903 15.1296 6.58285 15.0688C6.32759 15.0001 6.05213 15.0001 5.5012 15.0001H4.6C4.03995 15.0001 3.75992 15.0001 3.54601 14.8911C3.35785 14.7952 3.20487 14.6422 3.10899 14.4541C3 14.2402 3 13.9601 3 13.4001V10.6001C3 10.04 3 9.76001 3.10899 9.54609C3.20487 9.35793 3.35785 9.20495 3.54601 9.10908C3.75992 9.00009 4.03995 9.00009 4.6 9.00009Z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`
  );
}

function iconMuted() {
  return createPlayerIcon(
    `<path d="M16 9.50009L21 14.5001M21 9.50009L16 14.5001M4.6 9.00009H5.5012C6.05213 9.00009 6.32759 9.00009 6.58285 8.93141C6.80903 8.87056 7.02275 8.77046 7.21429 8.63566C7.43047 8.48353 7.60681 8.27191 7.95951 7.84868L10.5854 4.69758C11.0211 4.17476 11.2389 3.91335 11.4292 3.88614C11.594 3.86258 11.7597 3.92258 11.8712 4.04617C12 4.18889 12 4.52917 12 5.20973V18.7904C12 19.471 12 19.8113 11.8712 19.954C11.7597 20.0776 11.594 20.1376 11.4292 20.114C11.239 20.0868 11.0211 19.8254 10.5854 19.3026L7.95951 16.1515C7.60681 15.7283 7.43047 15.5166 7.21429 15.3645C7.02275 15.2297 6.80903 15.1296 6.58285 15.0688C6.32759 15.0001 6.05213 15.0001 5.5012 15.0001H4.6C4.03995 15.0001 3.75992 15.0001 3.54601 14.8911C3.35785 14.7952 3.20487 14.6422 3.10899 14.4541C3 14.2402 3 13.9601 3 13.4001V10.6001C3 10.04 3 9.76001 3.10899 9.54609C3.20487 9.35793 3.35785 9.20495 3.54601 9.10908C3.75992 9.00009 4.03995 9.00009 4.6 9.00009Z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`
  );
}

function iconQueue() {
  return createPlayerIcon(
    `<path d="M16 5V18M16 18C16 19.1046 14.6569 20 13 20C11.3431 20 10 19.1046 10 18C10 16.8954 11.3431 16 13 16C14.6569 16 16 16.8954 16 18ZM4 5H12M4 9H12M4 13H8M16 4L20 3V7L16 8V4Z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`
  );
}
