/* ==========================================================================
   MAIN APP ROUTER & REAL-TIME STATE ENGINE
   Connects Spectator View, Rider Tracker, Admin Control, Server SSE, & Mobile Drawers
   ========================================================================== */

import { generateFullRoutePoints, INITIAL_RIDERS } from './mock-data.js';
import { RacemapEngine } from './map.js';
import { RiderTrackerEngine } from './tracker.js';
import { RaceAdminEngine } from './admin.js';

class RacemapApp {
  constructor() {
    this.routePoints = generateFullRoutePoints();
    this.ridersMap = new Map();
    this.currentCategoryFilter = 'ALL';
    this.searchQuery = '';
    
    this.isFreeTrackingMode = false;

    // Load initial mock riders
    this.loadSampleRiders();

    // Engines
    this.mapEngine = null;
    this.trackerEngine = null;
    this.adminEngine = null;

    this.initPWA();
    this.initBroadcastListeners();
    this.initSSEStream();
  }

  loadSampleRiders() {
    this.ridersMap.clear();
    INITIAL_RIDERS.forEach(r => this.ridersMap.set(r.bib, { ...r }));
  }

  async clearAllRiders() {
    this.ridersMap.clear();
    if (this.mapEngine) {
      this.mapEngine.riderMarkers.forEach(m => this.mapEngine.map.removeLayer(m));
      this.mapEngine.riderTrails.forEach(t => this.mapEngine.map.removeLayer(t));
      this.mapEngine.riderMarkers.clear();
      this.mapEngine.riderTrails.clear();
    }
    this.renderLeaderboard();
    this.updateSpectatorStats();

    try {
      await fetch('/api/clear', { method: 'POST' });
    } catch (e) {}
  }

  initPWA() {
    if ('serviceWorker' in navigator) {
      window.addEventListener('load', () => {
        navigator.serviceWorker.register('./sw.js')
          .then(reg => console.log('PWA ServiceWorker registered:', reg.scope))
          .catch(err => console.log('PWA ServiceWorker registration failed:', err));
      });
    }

    let deferredPrompt;
    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      deferredPrompt = e;
      const installCard = document.getElementById('pwa-install-card');
      const btnInstall = document.getElementById('btn-pwa-install');
      
      if (installCard) installCard.style.display = 'flex';
      
      if (btnInstall) {
        btnInstall.addEventListener('click', () => {
          if (deferredPrompt) {
            deferredPrompt.prompt();
            deferredPrompt.userChoice.then((choiceResult) => {
              if (choiceResult.outcome === 'accepted') {
                console.log('User accepted PWA install');
              }
              deferredPrompt = null;
              if (installCard) installCard.style.display = 'none';
            });
          }
        });
      }
    });
  }

  // Connect to Public Backend Server-Sent Events (SSE) stream for internet spectators
  initSSEStream() {
    if ('EventSource' in window) {
      const evtSource = new EventSource('/api/events');
      
      evtSource.addEventListener('INITIAL_RIDERS', (e) => {
        try {
          const list = JSON.parse(e.data);
          if (list && list.length > 0) {
            list.forEach(r => this.handleLiveLocationUpdate(r));
          }
        } catch (err) {}
      });

      evtSource.addEventListener('LOCATION_UPDATE', (e) => {
        try {
          const data = JSON.parse(e.data);
          this.handleLiveLocationUpdate(data);
        } catch (err) {}
      });

      evtSource.addEventListener('SOS_ALERT', (e) => {
        try {
          const data = JSON.parse(e.data);
          this.handleSOSAlert(data);
        } catch (err) {}
      });

      evtSource.addEventListener('CLEAR_RIDERS', () => {
        this.clearAllRiders();
      });
    }
  }

  start() {
    this.mapEngine = new RacemapEngine('leaflet-map', 'elevation-chart');
    this.mapEngine.renderFixedRoute(this.routePoints);
    
    this.ridersMap.forEach(r => this.mapEngine.updateRiderPosition(r));

    this.trackerEngine = new RiderTrackerEngine();
    this.adminEngine = new RaceAdminEngine(this);

    this.setupTabNavigation();
    this.setupModeToggle();
    this.setupLeaderboard();
    this.setupAdminUI();
    this.setupMobileDrawers();

    this.renderLeaderboard();
  }

  initBroadcastListeners() {
    const channel = new BroadcastChannel('racemap_live_stream');

    channel.onmessage = (event) => {
      const data = event.data;
      if (data.type === 'LOCATION_UPDATE') {
        this.handleLiveLocationUpdate(data);
      } else if (data.type === 'SOS_ALERT') {
        this.handleSOSAlert(data);
      }
    };

    window.addEventListener('storage', (e) => {
      if (e.key === 'racemap_last_rider_update' && e.newValue) {
        try {
          const data = JSON.parse(e.newValue);
          this.handleLiveLocationUpdate(data);
        } catch (err) {}
      } else if (e.key === 'racemap_sos_alert' && e.newValue) {
        try {
          const data = JSON.parse(e.newValue);
          this.handleSOSAlert(data);
        } catch (err) {}
      }
    });
  }

  handleLiveLocationUpdate(data) {
    const { bib, name, category, lat, lng, speed, distanceKm, battery, status, lastUpdate } = data;

    let rider = this.ridersMap.get(bib);
    if (!rider) {
      rider = {
        id: `rider-${bib}`,
        bib,
        name: name || `Rider #${bib}`,
        category: category || 'Solo Unsupported',
        status: status || 'moving',
        speed: speed || 0,
        distanceKm: distanceKm || 0,
        eleGain: 1200,
        lat,
        lng,
        battery: battery || 100,
        lastUpdate: lastUpdate || 'Just now',
        trail: []
      };
      this.ridersMap.set(bib, rider);
    } else {
      rider.lat = lat;
      rider.lng = lng;
      rider.speed = speed;
      rider.distanceKm = distanceKm;
      rider.battery = battery;
      rider.status = status;
      rider.lastUpdate = lastUpdate;
    }

    if (!rider.trail) rider.trail = [];
    rider.trail.push({ lat, lng });
    if (rider.trail.length > 500) rider.trail.shift();

    if (this.mapEngine) {
      this.mapEngine.updateRiderPosition(rider);
    }

    this.renderLeaderboard();
    this.updateSpectatorStats();
  }

  handleSOSAlert(data) {
    const { bib, name, lat, lng } = data;
    this.showToast(`🚨 SOS EMERGENSI! BIB #${bib} (${name}) di [${lat.toFixed(4)}, ${lng.toFixed(4)}]`, 'sos');
    
    if (this.mapEngine) {
      this.mapEngine.map.setView([lat, lng], 14, { animate: true });
    }
  }

  showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerHTML = `<span>${message}</span>`;
    container.appendChild(toast);

    setTimeout(() => {
      toast.remove();
    }, 6000);
  }

  setupTabNavigation() {
    const tabs = document.querySelectorAll('.tab-btn');
    const views = document.querySelectorAll('.view-container');

    tabs.forEach(tab => {
      tab.addEventListener('click', () => {
        const targetViewId = tab.dataset.view;

        tabs.forEach(t => t.classList.remove('active'));
        views.forEach(v => v.classList.remove('active'));

        tab.classList.add('active');
        const activeView = document.getElementById(targetViewId);
        if (activeView) activeView.classList.add('active');

        if (targetViewId === 'view-spectator' && this.mapEngine) {
          setTimeout(() => this.mapEngine.map.invalidateSize(), 200);
        }
      });
    });
  }

  setupModeToggle() {
    const toggleInput = document.getElementById('toggle-mode-checkbox');
    const modeLabel = document.getElementById('mode-indicator-text');

    if (toggleInput) {
      toggleInput.addEventListener('change', (e) => {
        this.isFreeTrackingMode = e.target.checked;
        
        if (modeLabel) {
          modeLabel.innerText = this.isFreeTrackingMode 
            ? 'FREE TRACKING' 
            : 'FIXED GPX';
        }

        if (this.mapEngine) {
          this.mapEngine.setTrackingMode(this.isFreeTrackingMode);
        }

        this.renderLeaderboard();
      });
    }

    const tileBtns = document.querySelectorAll('.tile-btn');
    tileBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        tileBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const tileName = btn.dataset.tile;
        if (this.mapEngine) this.mapEngine.setTileLayer(tileName);
      });
    });
  }

  setupLeaderboard() {
    const searchInput = document.getElementById('search-rider');
    if (searchInput) {
      searchInput.addEventListener('input', (e) => {
        this.searchQuery = e.target.value.toLowerCase();
        this.renderLeaderboard();
      });
    }

    const catChips = document.querySelectorAll('.cat-chip');
    catChips.forEach(chip => {
      chip.addEventListener('click', () => {
        catChips.forEach(c => c.classList.remove('active'));
        chip.classList.add('active');
        this.currentCategoryFilter = chip.dataset.cat;
        this.renderLeaderboard();
      });
    });
  }

  // Mobile Drawers Triggers (Slide-up Leaderboard & Elevation on Mobile Phones)
  setupMobileDrawers() {
    const btnMobileLeaderboard = document.getElementById('btn-mobile-leaderboard');
    const btnMobileElevation = document.getElementById('btn-mobile-elevation');
    const drawerLeaderboard = document.getElementById('leaderboard-drawer');
    const drawerElevation = document.getElementById('elevation-profile-bar');

    if (btnMobileLeaderboard && drawerLeaderboard) {
      btnMobileLeaderboard.addEventListener('click', () => {
        drawerLeaderboard.classList.toggle('mobile-open');
      });
    }

    if (btnMobileElevation && drawerElevation) {
      btnMobileElevation.addEventListener('click', () => {
        drawerElevation.classList.toggle('mobile-open');
      });
    }
  }

  renderLeaderboard() {
    const listContainer = document.getElementById('rider-leaderboard-list');
    if (!listContainer) return;

    let riders = Array.from(this.ridersMap.values());
    riders.sort((a, b) => b.distanceKm - a.distanceKm);

    if (this.currentCategoryFilter !== 'ALL') {
      riders = riders.filter(r => r.category.toUpperCase().includes(this.currentCategoryFilter));
    }

    if (this.searchQuery) {
      riders = riders.filter(r => 
        r.name.toLowerCase().includes(this.searchQuery) || 
        r.bib.toString().includes(this.searchQuery)
      );
    }

    listContainer.innerHTML = '';

    if (riders.length === 0) {
      listContainer.innerHTML = `<div style="text-align:center; padding:1.5rem; color:#64748b; font-size:0.75rem;">Belum ada peserta terdaftar</div>`;
      return;
    }

    riders.forEach((rider, index) => {
      const card = document.createElement('div');
      card.className = `rider-card ${this.mapEngine && this.mapEngine.selectedRiderBib === rider.bib ? 'selected' : ''}`;
      
      let rankBadge = `#${index + 1}`;
      if (index === 0) rankBadge = '🥇 #1';
      if (index === 1) rankBadge = '🥈 #2';
      if (index === 2) rankBadge = '🥉 #3';

      card.innerHTML = `
        <div class="rider-card-top">
          <div class="rider-info">
            <span class="rider-bib">BIB ${rider.bib}</span>
            <span class="rider-name">${rider.name}</span>
          </div>
          <span style="font-size:0.7rem; font-weight:800; color:var(--primary); font-family:monospace;">${rankBadge}</span>
        </div>
        <div style="display:flex; justify-content:space-between; font-size:0.65rem; color:var(--text-muted);">
          <span>${rider.category}</span>
          <span><span class="rider-status-dot ${rider.status}"></span> ${rider.status.toUpperCase()}</span>
        </div>
        <div class="rider-metrics">
          <div class="metric-item">
            <div class="m-val">${rider.distanceKm} KM</div>
            <div class="m-lbl">Distance</div>
          </div>
          <div class="metric-item">
            <div class="m-val">${rider.speed} km/h</div>
            <div class="m-lbl">Speed</div>
          </div>
          <div class="metric-item">
            <div class="m-val">${rider.battery}%</div>
            <div class="m-lbl">Battery</div>
          </div>
        </div>
        <div style="display:flex; justify-content:flex-end;">
          <button class="btn-follow" data-bib="${rider.bib}">📍 Follow</button>
        </div>
      `;

      const btnFollow = card.querySelector('.btn-follow');
      btnFollow.addEventListener('click', (e) => {
        e.stopPropagation();
        if (this.mapEngine) this.mapEngine.followRider(rider.bib);
        
        // On mobile, close drawer after selecting rider
        const drawer = document.getElementById('leaderboard-drawer');
        if (drawer) drawer.classList.remove('mobile-open');
      });

      card.addEventListener('click', () => {
        if (this.mapEngine) this.mapEngine.followRider(rider.bib);
      });

      listContainer.appendChild(card);
    });
  }

  updateSpectatorStats() {
    const countEl = document.getElementById('stat-active-riders');
    const kmEl = document.getElementById('stat-leader-km');
    const speedEl = document.getElementById('stat-avg-speed');

    const riders = Array.from(this.ridersMap.values());
    const activeCount = riders.filter(r => r.status === 'moving').length;
    
    let maxKm = 0;
    let totalSpeed = 0;
    let movingRidersCount = 0;

    riders.forEach(r => {
      if (r.distanceKm > maxKm) maxKm = r.distanceKm;
      if (r.status === 'moving') {
        totalSpeed += r.speed;
        movingRidersCount++;
      }
    });

    const avgSpeed = movingRidersCount > 0 ? (totalSpeed / movingRidersCount).toFixed(1) : 0;

    if (countEl) countEl.innerText = `${activeCount} / ${riders.length}`;
    if (kmEl) kmEl.innerText = `${maxKm.toFixed(1)} KM`;
    if (speedEl) speedEl.innerText = `${avgSpeed} km/h`;
  }

  setupTrackerUI() {
    const btnToggle = document.getElementById('btn-toggle-tracker');
    const btnSos = document.getElementById('btn-pwa-sos');
    const inputBib = document.getElementById('pwa-rider-bib');
    const inputName = document.getElementById('pwa-rider-name');

    if (btnToggle) {
      btnToggle.addEventListener('click', () => {
        if (!this.trackerEngine.isTracking) {
          const bib = inputBib ? inputBib.value : "777";
          const name = inputName ? inputName.value : "Saya (Rider HP)";
          this.trackerEngine.startTracking(bib, name);
        } else {
          this.trackerEngine.stopTracking();
        }
      });
    }

    if (btnSos) {
      btnSos.addEventListener('click', () => {
        if (confirm("🚨 Send Emergency SOS Alert to Race Control & Public Server?")) {
          this.trackerEngine.triggerSOS();
        }
      });
    }
  }

  setupAdminUI() {
    this.setupTrackerUI();

    const btnClear = document.getElementById('btn-clear-riders');
    const btnReset = document.getElementById('btn-reset-dummy');
    const btnSim = document.getElementById('btn-toggle-sim');
    const gpxInput = document.getElementById('gpx-file-input');

    if (btnClear) {
      btnClear.addEventListener('click', () => {
        if (confirm("Bersihkan semua data rider?")) {
          this.clearAllRiders();
          this.showToast("🧹 Data rider berhasil dibersihkan.");
        }
      });
    }

    if (btnReset) {
      btnReset.addEventListener('click', () => {
        this.loadSampleRiders();
        if (this.mapEngine) {
          this.ridersMap.forEach(r => this.mapEngine.updateRiderPosition(r));
        }
        this.renderLeaderboard();
        this.updateSpectatorStats();
        this.showToast("🔄 Sample data rider berhasil dimuat ulang.");
      });
    }

    if (btnSim) {
      btnSim.addEventListener('click', () => {
        if (this.adminEngine.isSimulating) {
          this.adminEngine.stopSimulation();
        } else {
          this.adminEngine.startSimulation(2);
        }
      });
    }

    if (gpxInput) {
      gpxInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (file) {
          const reader = new FileReader();
          reader.onload = (event) => {
            this.adminEngine.parseGPXFile(event.target.result);
          };
          reader.readAsText(file);
        }
      });
    }

    const btnExportGpx = document.getElementById('btn-export-gpx');
    if (btnExportGpx) {
      btnExportGpx.addEventListener('click', () => {
        const firstRider = Array.from(this.ridersMap.values())[0];
        if (firstRider) {
          this.adminEngine.exportRiderGPX(firstRider);
        } else {
          alert("Tidak ada data rider untuk di-export.");
        }
      });
    }
  }

  updateCustomRoute(newPoints) {
    this.routePoints = newPoints;
    if (this.mapEngine) {
      this.mapEngine.renderFixedRoute(newPoints);
    }
  }
}

document.addEventListener('DOMContentLoaded', () => {
  const app = new RacemapApp();
  app.start();
});
