/* ==========================================================================
   PUBLIC LIVE SPECTATOR MAP ENGINE (index.html)
   Handles Public Leaflet Map, Public Leaderboard, Elevation Profile, Collapsible Sidebar & SSE Stream
   ========================================================================== */

import { RacemapEngine } from './map.js';

class SpectatorApp {
  constructor() {
    this.mapEngine = null;
    this.ridersMap = new Map();
    this.currentCategoryFilter = 'ALL';
    this.searchQuery = '';

    this.initMap();
    this.initSSE();
    this.setupUI();
  }

  initMap() {
    this.mapEngine = new RacemapEngine('leaflet-map', 'elevation-chart');
  }

  initSSE() {
    if ('EventSource' in window) {
      const evtSource = new EventSource('/api/events');

      evtSource.addEventListener('INITIAL_STATE', (e) => {
        try {
          const state = JSON.parse(e.data);
          if (state.route) {
            this.mapEngine.renderFixedRoute(state.route);
          }
          if (state.mode) {
            this.mapEngine.setTrackingMode(state.mode === 'free');
          }
          if (state.riders) {
            state.riders.forEach(r => this.handleRiderUpdate(r));
          }
        } catch (err) {}
      });

      evtSource.addEventListener('LOCATION_UPDATE', (e) => {
        try {
          const rider = JSON.parse(e.data);
          this.handleRiderUpdate(rider);
        } catch (err) {}
      });

      evtSource.addEventListener('ROUTE_UPDATED', (e) => {
        try {
          const data = JSON.parse(e.data);
          if (data.route) this.mapEngine.renderFixedRoute(data.route);
        } catch (err) {}
      });

      evtSource.addEventListener('MODE_UPDATED', (e) => {
        try {
          const data = JSON.parse(e.data);
          this.mapEngine.setTrackingMode(data.mode === 'free');
        } catch (err) {}
      });

      evtSource.addEventListener('SOS_ALERT', (e) => {
        try {
          const data = JSON.parse(e.data);
          this.showToast(`🚨 SOS EMERGENSI! BIB #${data.bib} (${data.name})`, 'sos');
        } catch (err) {}
      });

      evtSource.addEventListener('CLEAR_EVENT', () => {
        this.ridersMap.clear();
        this.mapEngine.riderMarkers.forEach(m => this.mapEngine.map.removeLayer(m));
        this.mapEngine.riderTrails.forEach(t => this.mapEngine.map.removeLayer(t));
        this.mapEngine.riderMarkers.clear();
        this.mapEngine.riderTrails.clear();
        this.renderLeaderboard();
        this.updateStats();
      });
    }
  }

  handleRiderUpdate(rider) {
    this.ridersMap.set(rider.bib, rider);
    if (this.mapEngine) {
      this.mapEngine.updateRiderPosition(rider);
    }
    this.renderLeaderboard();
    this.updateStats();
  }

  setupUI() {
    // Tile Layer Switchers
    const tileBtns = document.querySelectorAll('.tile-btn[data-tile]');
    tileBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        tileBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.mapEngine.setTileLayer(btn.dataset.tile);
      });
    });

    // Sidebar Toggle Controls
    const btnToggleSidebar = document.getElementById('btn-toggle-sidebar');
    const btnCloseSidebarX = document.getElementById('btn-close-sidebar-x');
    const drawerLeaderboard = document.getElementById('leaderboard-drawer');

    if (btnToggleSidebar && drawerLeaderboard) {
      btnToggleSidebar.addEventListener('click', () => {
        drawerLeaderboard.classList.toggle('collapsed');
        if (btnToggleSidebar) {
          btnToggleSidebar.innerText = drawerLeaderboard.classList.contains('collapsed') 
            ? '▶ Sidebar' 
            : '◀ Sidebar';
        }
        setTimeout(() => this.mapEngine.map.invalidateSize(), 300);
      });
    }

    if (btnCloseSidebarX && drawerLeaderboard) {
      btnCloseSidebarX.addEventListener('click', () => {
        drawerLeaderboard.classList.add('collapsed');
        if (btnToggleSidebar) btnToggleSidebar.innerText = '▶ Sidebar';
        setTimeout(() => this.mapEngine.map.invalidateSize(), 300);
      });
    }

    // Search Box
    const searchInput = document.getElementById('search-rider');
    if (searchInput) {
      searchInput.addEventListener('input', (e) => {
        this.searchQuery = e.target.value.toLowerCase();
        this.renderLeaderboard();
      });
    }

    // Category Chips
    const catChips = document.querySelectorAll('.cat-chip');
    catChips.forEach(chip => {
      chip.addEventListener('click', () => {
        catChips.forEach(c => c.classList.remove('active'));
        chip.classList.add('active');
        this.currentCategoryFilter = chip.dataset.cat;
        this.renderLeaderboard();
      });
    });

    // Mobile Floating Triggers
    const btnMobileLeaderboard = document.getElementById('btn-mobile-leaderboard');
    const btnMobileElevation = document.getElementById('btn-mobile-elevation');
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
    riders.sort((a, b) => (b.distanceKm || 0) - (a.distanceKm || 0));

    if (this.currentCategoryFilter !== 'ALL') {
      riders = riders.filter(r => r.category && r.category.toUpperCase().includes(this.currentCategoryFilter));
    }

    if (this.searchQuery) {
      riders = riders.filter(r => 
        (r.name && r.name.toLowerCase().includes(this.searchQuery)) || 
        (r.bib && r.bib.toString().includes(this.searchQuery))
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

      let statusDotClass = rider.status || 'stopped';
      let statusLabel = (rider.status || 'stopped').toUpperCase();

      if (rider.lat === null || rider.lng === null || rider.status === 'registered') {
        statusDotClass = 'registered';
        statusLabel = 'BELUM START';
      }

      card.innerHTML = `
        <div class="rider-card-top">
          <div class="rider-info">
            <span class="rider-bib">BIB ${rider.bib}</span>
            <span class="rider-name">${rider.name}</span>
          </div>
          <span style="font-size:0.7rem; font-weight:800; color:var(--primary); font-family:monospace;">${rankBadge}</span>
        </div>
        <div style="display:flex; justify-content:space-between; font-size:0.65rem; color:var(--text-muted);">
          <span>${rider.category || 'Solo'}</span>
          <span><span class="rider-status-dot ${statusDotClass}"></span> ${statusLabel}</span>
        </div>
        <div class="rider-metrics">
          <div class="metric-item">
            <div class="m-val">${rider.distanceKm || 0} KM</div>
            <div class="m-lbl">Distance</div>
          </div>
          <div class="metric-item">
            <div class="m-val">${rider.speed || 0} km/h</div>
            <div class="m-lbl">Speed</div>
          </div>
          <div class="metric-item">
            <div class="m-val">${rider.battery || 100}%</div>
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
        if (rider.lat !== null && rider.lng !== null) {
          if (this.mapEngine) this.mapEngine.followRider(rider.bib);
        } else {
          alert(`Peserta BIB #${rider.bib} (${rider.name}) belum mengaktifkan lokasi/start tracking di HP.`);
        }
        const drawer = document.getElementById('leaderboard-drawer');
        if (drawer) drawer.classList.remove('mobile-open');
      });

      card.addEventListener('click', () => {
        if (rider.lat !== null && rider.lng !== null && this.mapEngine) {
          this.mapEngine.followRider(rider.bib);
        }
      });

      listContainer.appendChild(card);
    });
  }

  updateStats() {
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

  showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    if (!container) return;
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerHTML = `<span>${message}</span>`;
    container.appendChild(toast);
    setTimeout(() => toast.remove(), 6000);
  }
}

document.addEventListener('DOMContentLoaded', () => {
  new SpectatorApp();
});
