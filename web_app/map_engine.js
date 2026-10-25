/* RideRise LK — dependency-free slippy map engine.
 *
 * Renders standard raster tiles (OpenStreetMap by default, or any provider the
 * server configures) with pan, zoom, recenter and privacy-radius markers.
 * No API key is embedded in this file; the tile template comes from
 * /api/guilds/:id/live (server-configured, authenticated).
 */
(function () {
  'use strict';

  const TILE = 256;

  function lngToWorldX(lng, z) {
    return ((lng + 180) / 360) * TILE * Math.pow(2, z);
  }
  function latToWorldY(lat, z) {
    const rad = (Math.max(Math.min(lat, 85.05112878), -85.05112878) * Math.PI) / 180;
    return ((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * TILE * Math.pow(2, z);
  }
  function worldXToLng(x, z) {
    return (x / (TILE * Math.pow(2, z))) * 360 - 180;
  }
  function worldYToLat(y, z) {
    const n = Math.PI - (2 * Math.PI * y) / (TILE * Math.pow(2, z));
    return (180 / Math.PI) * Math.atan(Math.sinh(n));
  }
  function metersPerPixel(lat, z) {
    return (156543.03392 * Math.cos((lat * Math.PI) / 180)) / Math.pow(2, z);
  }

  class RRMap {
    constructor(container, options) {
      this.el = container;
      this.tileUrl = (options && options.tileUrl) || 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
      this.attribution = (options && options.attribution) || '© OpenStreetMap contributors';
      this.maxZoom = (options && options.maxZoom) || 19;
      this.minZoom = 3;
      this.zoom = (options && options.zoom) || 14;
      this.center = (options && options.center) || { lat: 6.9271, lng: 79.8612 };
      this.markers = [];
      this.tileFailures = 0;
      this.tileSuccesses = 0;
      this.onMove = options && options.onMove;
      this.onStatus = options && options.onStatus;

      this.el.classList.add('rr-map');
      this.el.innerHTML = `
        <div class="rr-map-pane" aria-hidden="true"></div>
        <div class="rr-map-markers" role="list" aria-label="Riders sharing their location"></div>
        <div class="rr-map-controls">
          <button type="button" class="rr-map-btn" data-map-zoom="in" aria-label="Zoom in">+</button>
          <button type="button" class="rr-map-btn" data-map-zoom="out" aria-label="Zoom out">−</button>
          <button type="button" class="rr-map-btn" data-map-recenter aria-label="Recentre map">◎</button>
        </div>
        <div class="rr-map-attribution">${this.attribution}</div>
        <div class="rr-map-state" role="status" aria-live="polite"></div>`;

      this.pane = this.el.querySelector('.rr-map-pane');
      this.markerLayer = this.el.querySelector('.rr-map-markers');
      this.stateEl = this.el.querySelector('.rr-map-state');
      this.resizeObserver = null;

      this._bind();
      this._measure();
      this.render();
      if (window.ResizeObserver) {
        this.resizeObserver = new ResizeObserver(() => {
          this._measure();
          this.render();
        });
        this.resizeObserver.observe(this.el);
      } else {
        window.addEventListener('resize', this._onResize = () => {
          this._measure();
          this.render();
        });
      }
    }

    _measure() {
      const rect = this.el.getBoundingClientRect();
      this.width = Math.max(240, rect.width || 320);
      this.height = Math.max(240, rect.height || 320);
    }

    _bind() {
      let dragging = false;
      let startX = 0;
      let startY = 0;
      let startCenter = null;

      const onDown = (ev) => {
        if (ev.target.closest('.rr-map-btn')) return;
        dragging = true;
        const point = ev.touches ? ev.touches[0] : ev;
        startX = point.clientX;
        startY = point.clientY;
        startCenter = { ...this.center };
        this.el.classList.add('is-dragging');
      };
      const onMove = (ev) => {
        if (!dragging) return;
        const point = ev.touches ? ev.touches[0] : ev;
        const dx = point.clientX - startX;
        const dy = point.clientY - startY;
        const x = lngToWorldX(startCenter.lng, this.zoom) - dx;
        const y = latToWorldY(startCenter.lat, this.zoom) - dy;
        this.center = { lat: worldYToLat(y, this.zoom), lng: worldXToLng(x, this.zoom) };
        this._positionPane();
        this._positionMarkers();
        if (ev.cancelable) ev.preventDefault();
      };
      const onUp = () => {
        if (!dragging) return;
        dragging = false;
        this.el.classList.remove('is-dragging');
        this._renderTiles();
        if (this.onMove) this.onMove(this.center, this.zoom);
      };

      this.el.addEventListener('mousedown', onDown);
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
      this.el.addEventListener('touchstart', onDown, { passive: true });
      this.el.addEventListener('touchmove', onMove, { passive: false });
      this.el.addEventListener('touchend', onUp);

      this.el.addEventListener(
        'wheel',
        (ev) => {
          ev.preventDefault();
          this.zoomBy(ev.deltaY > 0 ? -1 : 1);
        },
        { passive: false }
      );

      this.el.querySelector('[data-map-zoom="in"]').addEventListener('click', () => this.zoomBy(1));
      this.el.querySelector('[data-map-zoom="out"]').addEventListener('click', () => this.zoomBy(-1));
      this.el.querySelector('[data-map-recenter]').addEventListener('click', () => this.recenter());

      this._cleanup = () => {
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
        if (this._onResize) window.removeEventListener('resize', this._onResize);
        if (this.resizeObserver) this.resizeObserver.disconnect();
      };
    }

    _tileSrc(x, y, z) {
      return this.tileUrl.replace('{z}', z).replace('{x}', x).replace('{y}', y);
    }

    _renderTiles() {
      const z = this.zoom;
      const scale = TILE * Math.pow(2, z);
      const cx = lngToWorldX(this.center.lng, z);
      const cy = latToWorldY(this.center.lat, z);
      const left = cx - this.width / 2;
      const top = cy - this.height / 2;
      const minX = Math.floor(left / TILE);
      const maxX = Math.floor((left + this.width) / TILE);
      const minY = Math.floor(top / TILE);
      const maxY = Math.floor((top + this.height) / TILE);
      const maxTile = Math.pow(2, z);
      const wanted = new Set();

      for (let x = minX; x <= maxX; x++) {
        for (let y = minY; y <= maxY; y++) {
          if (y < 0 || y >= maxTile) continue;
          const wrappedX = ((x % maxTile) + maxTile) % maxTile;
          const key = `${z}/${wrappedX}/${y}`;
          wanted.add(key);
          let tile = this.pane.querySelector(`[data-tile="${key}"]`);
          if (!tile) {
            tile = document.createElement('img');
            tile.className = 'rr-map-tile';
            tile.dataset.tile = key;
            tile.alt = '';
            tile.loading = 'lazy';
            tile.decoding = 'async';
            tile.referrerPolicy = 'no-referrer';
            tile.src = this._tileSrc(wrappedX, y, z);
            tile.style.left = `${x * TILE}px`;
            tile.style.top = `${y * TILE}px`;
            tile.addEventListener('load', () => {
              this.tileSuccesses++;
              this._updateStatus();
            });
            tile.addEventListener('error', () => {
              this.tileFailures++;
              this._updateStatus();
            });
            this.pane.appendChild(tile);
          }
        }
      }
      for (const tile of Array.from(this.pane.children)) {
        if (!wanted.has(tile.dataset.tile)) tile.remove();
      }
      this._positionPane();
      this._positionMarkers();
    }

    _positionPane() {
      const z = this.zoom;
      const cx = lngToWorldX(this.center.lng, z);
      const cy = latToWorldY(this.center.lat, z);
      this.pane.style.transform = `translate(${this.width / 2 - cx}px, ${this.height / 2 - cy}px)`;
    }

    _positionMarkers() {
      const z = this.zoom;
      const cx = lngToWorldX(this.center.lng, z);
      const cy = latToWorldY(this.center.lat, z);
      const mpp = metersPerPixel(this.center.lat, z);
      for (const node of Array.from(this.markerLayer.children)) {
        const id = node.dataset.markerId;
        const marker = this.markers.find((m) => m.id === id);
        if (!marker) continue;
        const x = lngToWorldX(marker.lng, z);
        const y = latToWorldY(marker.lat, z);
        const sx = this.width / 2 + (x - cx);
        const sy = this.height / 2 + (y - cy);
        node.style.transform = `translate(${Math.round(sx)}px, ${Math.round(sy)}px)`;
        const circle = node.querySelector('.rr-map-radius');
        if (circle) {
          const diameter = Math.max(28, Math.min(340, ((marker.radius || 750) * 2) / mpp));
          circle.style.width = `${diameter}px`;
          circle.style.height = `${diameter}px`;
          circle.style.left = `${-diameter / 2}px`;
          circle.style.top = `${-diameter / 2}px`;
        }
        node.classList.toggle('is-offscreen', sx < -60 || sy < -60 || sx > this.width + 60 || sy > this.height + 60);
      }
    }

    _updateStatus() {
      if (!this.stateEl) return;
      if (this.tileSuccesses > 0) {
        this.stateEl.textContent = '';
        this.el.classList.remove('map-offline');
      } else if (this.tileFailures >= 3) {
        this.el.classList.add('map-offline');
        this.stateEl.innerHTML =
          '<strong>Map tiles could not load.</strong> Check your connection or map provider key. The rider list beside the map still works.';
      }
    }

    setMarkers(markers) {
      this.markers = Array.isArray(markers) ? markers : [];
      const seen = new Set();
      for (const marker of this.markers) {
        seen.add(marker.id);
        let node = this.markerLayer.querySelector(`[data-marker-id="${CSS.escape(marker.id)}"]`);
        if (!node) {
          node = document.createElement('div');
          node.className = 'rr-map-marker';
          node.dataset.markerId = marker.id;
          node.setAttribute('role', 'listitem');
          this.markerLayer.appendChild(node);
        }
        node.classList.toggle('is-self', Boolean(marker.isSelf));
        node.innerHTML = `
          <div class="rr-map-radius" aria-hidden="true"></div>
          <div class="rr-map-pin">
            <span class="rr-map-pin-avatar">${marker.avatar ? `<img src="${marker.avatar}" alt="">` : (marker.initials || 'R')}</span>
          </div>
          <div class="rr-map-label">${marker.label || 'Rider'}${marker.subtitle ? `<small>${marker.subtitle}</small>` : ''}</div>`;
      }
      for (const node of Array.from(this.markerLayer.children)) {
        if (!seen.has(node.dataset.markerId)) node.remove();
      }
      this._positionMarkers();
    }

    setCenter(lat, lng, zoom) {
      this.center = { lat, lng };
      if (zoom) this.zoom = Math.max(this.minZoom, Math.min(this.maxZoom, Math.round(zoom)));
      this.render();
    }

    zoomBy(delta) {
      const next = Math.max(this.minZoom, Math.min(this.maxZoom, this.zoom + delta));
      if (next === this.zoom) return;
      this.zoom = next;
      this.render();
    }

    recenter() {
      const self = this.markers.find((m) => m.isSelf);
      if (self) this.setCenter(self.lat, self.lng, Math.max(this.zoom, 15));
      else if (this.markers.length) this.fitMarkers();
      else this.render();
    }

    fitMarkers() {
      if (!this.markers.length) return;
      const lats = this.markers.map((m) => m.lat);
      const lngs = this.markers.map((m) => m.lng);
      const lat = (Math.min(...lats) + Math.max(...lats)) / 2;
      const lng = (Math.min(...lngs) + Math.max(...lngs)) / 2;
      const span = Math.max(Math.max(...lats) - Math.min(...lats), Math.max(...lngs) - Math.min(...lngs));
      let zoom = 15;
      if (span > 0.5) zoom = 9;
      else if (span > 0.2) zoom = 11;
      else if (span > 0.08) zoom = 12;
      else if (span > 0.02) zoom = 14;
      this.setCenter(lat, lng, zoom);
    }

    render() {
      this._renderTiles();
      this._positionMarkers();
    }

    destroy() {
      if (this._cleanup) this._cleanup();
      this.el.innerHTML = '';
      this.el.classList.remove('rr-map');
    }
  }

  window.RRMap = RRMap;
})();
