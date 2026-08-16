/* ==========================================================================
   MAIN APP ROUTER & REAL-TIME STATE ENGINE
   Connects Spectator View, Rider Tracker, Admin Control, & Broadcast Sync
   ========================================================================== */

import { generateFullRoutePoints, INITIAL_RIDERS } from './mock-data.js';
import { RacemapEngine } from './map.js';
import { RiderTrackerEngine } from './tracker.js';
import { RaceAdminEngine } from './admin.js';

class RacemapApp {
  constructor() {
    this.routePoints = generateFullRoutePoints();
    this.ridersMap = new Map(); // bib -> rider object
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
  }

  loadSampleRiders() {
    this.ridersMap.clear();
    INITIAL_RIDERS.forEach(r => this.ridersMap.set(r.bib, { ...r }));
  }

  clearAllRiders() {
    this.ridersMap.clear();
    if (this.mapEngine) {
      this.mapEngine.riderMarkers.forEach(m => this.mapEngine.map.removeLayer(m));
      this.mapEngine.riderTrails.forEach(t => this.mapEngine.map.removeLayer(t));
      this.mapEngine.riderMarkers.clear();
      this.mapEngine.riderTrails.clear();
    }
    this.renderLeaderboard();
    this.updateSpectatorStats();
  }

  // Initialize PWA Service Worker
  initPWA() {
    if ('serviceWorker' in navigator) {
      window.addEventListener('load', () => {
        navigator.serviceWorker.register('./sw.js')
          .then(reg => console.log('PWA ServiceWorker registered:', reg.scope))
          .catch(err => console.log('PWA ServiceWorker registration failed:', err));
      });
    }

    // PWA Install Prompt Listener
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

  // Start Application
  start() {
    // 1. Initialize Map
    this.mapEngine = new RacemapEngine('leaflet-map', 'elevation-chart');
    this.mapEngine.renderFixedRoute(this.routePoints);
    
    // Render initial riders on map
    this.ridersMap.forEach(r => this.mapEngine.updateRiderPosition(r));

    // 2. Initialize Tracker & Admin
    this.trackerEngine = new RiderTrackerEngine();
    this.adminEngine = new RaceAdminEngine(this);

    // 3. Setup Navigation & Listeners
    this.setupTabNavigation();
    this.setupModeToggle();
    this.setupLeaderboard();
    this.setupAdminUI();

    // 4. Initial Leaderboard Render
    this.renderLeaderboard();
  }

  // Real-time Broadcast Channel & LocalStorage Listeners
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

    // Also check storage events (fallback across tabs)
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

  // Handle incoming live location update from PWA Tracker or Simulator
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

    // Append to trail
    if (!rider.trail) rider.trail = [];
    rider.trail.push({ lat, lng });
    if (rider.trail.length > 500) rider.trail.shift();

    // Update map marker
    if (this.mapEngine) {
      this.mapEngine.updateRiderPosition(rider);
    }

    // Update Leaderboard & Stats
    this.renderLeaderboard();
    this.updateSpectatorStats();
  }

  // Handle Emergency SOS Alert
  handleSOSAlert(data) {
    const { bib, name, lat, lng } = data;
    this.showToast(`🚨 SOS EMERGENSI! BIB #${bib} (${name}) di [${lat.toFixed(4)}, ${lng.toFixed(4)}]`, 'sos');
    
    // Pan map to SOS location
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

  // Tab Switcher
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

        // Resize Leaflet Map when Spectator View opens
        if (targetViewId === 'view-spectator' && this.mapEngine) {
          setTimeout(() => this.mapEngine.map.invalidateSize(), 200);
        }
      });
    });
  }

  // Mode Switcher: Fixed Route vs Free Tracking Mode
  setupModeToggle() {
    const toggleInput = document.getElementById('toggle-mode-checkbox');
    const modeLabel = document.getElementById('mode-indicator-text');

    if (toggleInput) {
      toggleInput.addEventListener('change', (e) => {
        this.isFreeTrackingMode = e.target.checked;
        
        if (modeLabel) {
          modeLabel.innerText = this.isFreeTrackingMode 
            ? 'FREE TRACKING (Tanpa Jalur)' 
            : 'FIXED GPX ROUTE';
        }

        if (this.mapEngine) {
          this.mapEngine.setTrackingMode(this.isFreeTrackingMode);
        }

        this.renderLeaderboard();
      });
    }

    // Tile Layer Switcher Buttons
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

  // Leaderboard Search, Filters, & Card Interactions
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
      listContainer.innerHTML = `<div style="text-align:center; padding:2rem; color:#64748b; font-size:0.8rem;">Belum ada peserta terdaftar</div>`;
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
          <span style="font-size:0.75rem; font-weight:800; color:var(--primary); font-family:monospace;">${rankBadge}</span>
        </div>
        <div style="display:flex; justify-content:space-between; font-size:0.7rem; color:var(--text-muted);">
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
          <button class="btn-follow" data-bib="${rider.bib}">📍 Follow Camera</button>
        </div>
      `;

      const btnFollow = card.querySelector('.btn-follow');
      btnFollow.addEventListener('click', (e) => {
        e.stopPropagation();
        if (this.mapEngine) this.mapEngine.followRider(rider.bib);
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

  // Setup Rider PWA Tracker UI Controls
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
        if (confirm("🚨 Send Emergency SOS Alert to Race Control?")) {
          this.trackerEngine.triggerSOS();
        }
      });
    }
  }

  // Setup Admin Control UI Controls
  setupAdminUI() {
    this.setupTrackerUI();

    const btnClear = document.getElementById('btn-clear-riders');
    const btnReset = document.getElementById('btn-reset-dummy');
    const btnSim = document.getElementById('btn-toggle-sim');
    const gpxInput = document.getElementById('gpx-file-input');

    if (btnClear) {
      btnClear.addEventListener('click', () => {
        if (confirm("Bersihkan semua data rider dummy?")) {
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
